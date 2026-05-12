#!/usr/bin/env bash
# Pre-commit / CI guard: every CI tool install and ci-catalog component
# reference in .gitlab-ci.yml must be pinned to an immutable ref.
#
# Closes Q32 / #127 (and SEC F-SUP-3 / #153): a future edit that
# (re)introduces `@latest` or `@~latest` on a `go install` line or a
# `component:` ci-catalog include is caught here instead of silently
# shipping an unpinned, supply-chain-attackable dependency.
#
# Escape hatch: a line carrying a trailing `# ci-pins-allow:` marker is
# tolerated (used today only for `codesign-windows-ssl@~latest`, which
# has no tagged ci-catalog release yet — see the TODO in .gitlab-ci.yml
# and #127). Keep that list as short as physically possible.
set -euo pipefail

CI_FILE="${1:-.gitlab-ci.yml}"

if [ ! -f "$CI_FILE" ]; then
  echo "check-ci-pins: $CI_FILE not found" >&2
  exit 1
fi

fail=0

# 1. `go install ...@latest` (or @~latest) — any tool the pipeline installs.
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

if [ "$fail" -ne 0 ]; then
  echo >&2
  echo "Pin the ref to an immutable tag (or pseudo-version) before committing." >&2
  echo "If a pin is genuinely impossible right now, add a trailing" >&2
  echo "'# ci-pins-allow: <reason / issue>' marker AND a TODO in .gitlab-ci.yml." >&2
  exit 1
fi

echo "check-ci-pins: all CI tool & catalog refs are pinned."
