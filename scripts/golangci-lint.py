#!/usr/bin/env python3
"""Run the maintained Go/linter pair, reusing a versioned user cache."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

GO_VERSION = "1.27.3"
GOLANGCI_LINT_VERSION = "v2.14.0"


def main():
    env = dict(os.environ)
    # Git exports these to hooks; dependency downloads must not inherit the
    # parent repository's location when Go initializes module-cache clones.
    for key in (
        "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR",
        "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX",
        "GIT_NAMESPACE", "GIT_IMPLICIT_WORK_TREE", "GIT_GRAFT_FILE",
        "GIT_SHALLOW_FILE", "GIT_QUARANTINE_PATH",
    ):
        env.pop(key, None)
    env["GOTOOLCHAIN"] = "go" + GO_VERSION
    host = json.loads(subprocess.check_output(
        ["go", "env", "-json", "GOVERSION", "GOHOSTOS", "GOHOSTARCH"], env=env,
    ))
    cache = Path(env.get("XDG_CACHE_HOME", str(Path.home() / ".cache")))
    cache = (cache / "devnw" / "golangci-lint" / GOLANGCI_LINT_VERSION
             / host["GOVERSION"] / (host["GOHOSTOS"] + "_" + host["GOHOSTARCH"]))
    binary = cache / ("golangci-lint.exe" if host["GOHOSTOS"] == "windows" else "golangci-lint")
    expected = ("version " + GOLANGCI_LINT_VERSION.removeprefix("v")
                + " built with " + host["GOVERSION"] + " ")
    version = subprocess.run([str(binary), "version"], env=env, capture_output=True,
                             text=True) if binary.is_file() else None
    if version is None or version.returncode or expected not in version.stdout:
        cache.mkdir(parents=True, exist_ok=True)
        # Atomic publication permits concurrent worktrees to share this cache.
        with tempfile.TemporaryDirectory(prefix="install-", dir=cache) as temporary:
            build_env = dict(env, GOBIN=temporary, GOOS=host["GOHOSTOS"],
                             GOARCH=host["GOHOSTARCH"], GOFLAGS="-p=4")
            subprocess.run([
                "go", "install", "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@"
                + GOLANGCI_LINT_VERSION,
            ], env=build_env, check=True)
            installed = Path(temporary) / binary.name
            installed_version = subprocess.check_output([str(installed), "version"],
                                                        env=env, text=True)
            if expected not in installed_version:
                raise RuntimeError("installed linter does not match the requested Go/linter pair")
            os.replace(installed, binary)
    args = sys.argv[1:]
    # golangci-lint's default lock is host-wide, even across unrelated repos.
    # The caches support concurrent runners; retain explicit caller overrides.
    if args and args[0] == "run" and not any(a.startswith("--allow-parallel-runners") for a in args):
        args = [args[0], "--allow-parallel-runners", *args[1:]]
    return subprocess.run([str(binary), *args], env=env).returncode


if __name__ == "__main__":
    sys.exit(main())
