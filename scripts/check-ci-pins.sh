#!/usr/bin/env bash
# Pre-commit / CI guard: every CI tool install and ci-catalog component
# reference in .gitlab-ci.yml — AND every `go install` line in helper
# scripts that CI invokes — must be pinned to an immutable ref.
#
# Closes Q32 / #127 (and SEC F-SUP-3 / #153): a future edit that
# (re)introduces `@latest` or `@~latest` on a `go install` line or a
# `component:` ci-catalog include is caught here instead of silently
# shipping an unpinned, supply-chain-attackable dependency.
#
# Q rank 17 / #230: the guard was previously scoped to .gitlab-ci.yml
# only, which let scripts/bench-gate.sh install benchstat@latest
# unchecked. The check now also walks any extra file paths passed on
# the command line — pre-commit + CI both pass the helper scripts as
# additional args. The default behaviour (no args) still only scans
# .gitlab-ci.yml to preserve existing pre-commit invocations.
#
# Escape hatch: a line carrying a trailing `# ci-pins-allow:` marker is
# tolerated (used today only for `codesign-windows-ssl@~latest`, which
# has no tagged ci-catalog release yet — see the TODO in .gitlab-ci.yml
# and #127). Keep that list as short as physically possible.
set -euo pipefail

# Resolve the list of files to scan. With no args, default to the
# canonical pre-PERF-#230 surface (.gitlab-ci.yml) so existing hooks
# keep working. Additional paths can be passed by the caller (CI and
# the pre-commit config both pass scripts/bench-gate.sh).
if [ "$#" -eq 0 ]; then
  set -- ".gitlab-ci.yml"
fi

scan_file() {
  local CI_FILE="$1"
  local fail=0

  if [ ! -f "$CI_FILE" ]; then
    echo "check-ci-pins: $CI_FILE not found" >&2
    return 1
  fi

  # 1. `go install ...@latest` (or @~latest) — any tool the file installs.
  while IFS= read -r line; do
    case "$line" in
      *"# ci-pins-allow:"*) continue ;;
    esac
    echo "check-ci-pins: unpinned 'go install' ref in $CI_FILE:" >&2
    echo "  ${line#"${line%%[![:space:]]*}"}" >&2
    fail=1
  done < <(grep -nE 'go install [^[:space:]]+@~?latest' "$CI_FILE" || true)

  # 2. ci-catalog `component:` includes pinned to @latest / @~latest.
  while IFS= read -r line; do
    case "$line" in
      *"# ci-pins-allow:"*) continue ;;
    esac
    echo "check-ci-pins: unpinned ci-catalog component in $CI_FILE:" >&2
    echo "  ${line#"${line%%[![:space:]]*}"}" >&2
    fail=1
  done < <(grep -nE 'component:[[:space:]]*[^[:space:]]+@~?latest' "$CI_FILE" || true)

  return "$fail"
}

overall=0
for f in "$@"; do
  if ! scan_file "$f"; then
    overall=1
  fi
done

if [ "$overall" -ne 0 ]; then
  echo >&2
  echo "Pin the ref to an immutable tag (or pseudo-version) before committing." >&2
  echo "If a pin is genuinely impossible right now, add a trailing" >&2
  echo "'# ci-pins-allow: <reason / issue>' marker AND a TODO." >&2
  exit 1
fi

echo "check-ci-pins: all CI tool & catalog refs are pinned ($*)."
