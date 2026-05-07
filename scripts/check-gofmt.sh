#!/usr/bin/env bash
# Pre-commit hook: gofmt check.
#
# Lists every Go file in the working tree that gofmt would change. Excludes
# the generated `gen/` tree and any tooling-vendored directories. Fails non-
# zero with the offending file list when anything is unformatted, so the
# commit aborts and the developer can fix in place with `gofmt -s -w .`.
set -euo pipefail

unformatted=$(gofmt -l . 2>/dev/null \
  | grep -v -E '^gen/' \
  | grep -v -E '^node_modules/' \
  || true)

if [ -n "$unformatted" ]; then
  echo "gofmt: the following files are not formatted:"
  printf '  %s\n' "$unformatted"
  echo
  echo "Fix with: gofmt -s -w ."
  exit 1
fi
