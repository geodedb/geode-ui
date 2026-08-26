#!/usr/bin/env bash
# Pre-commit / CI guard: every Go toolchain reference in this repo must
# point at the same version. Closes QUALITY-rank-1 / SEC-GO-2026-4918 /
# #148 + #212.
#
# Single source of truth: scripts/check-go-toolchain.sh:GOTOOLCHAIN_PIN.
# If you bump the toolchain, bump it here AND in every grep-matched line
# below — the script will fail loudly otherwise.
#
# Files audited:
#   - go.mod                          `go <version>`
#   - .goreleaser.yaml                `GOTOOLCHAIN=go<version>`
#   - Makefile                        `GOTOOLCHAIN ?= go<version>`
#   - .gitlab-ci.yml                  `GOTOOLCHAIN: go<version>`
#   - README.md                       Badge + quick-start
#
# Stale-pin scan: if any file mentions a *different* Go 1.26.x version
# than the pin, fail. This catches forgotten updates after CVE bumps
# (the original GO-2026-4918 + #148 footgun where the README still said
# "1.26.2" weeks after the patched release shipped).
set -euo pipefail

# Single source of truth — bump this when bumping Go.
GOTOOLCHAIN_PIN="1.27.0"

ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT"

fail=0

# Check 1: every audited file pins exactly $GOTOOLCHAIN_PIN.
check_pin() {
  local file="$1" pattern="$2" label="$3"
  if [ ! -f "$file" ]; then
    echo "check-go-toolchain: $file not found (skipped)" >&2
    return 0
  fi
  if ! grep -qE "$pattern" "$file"; then
    echo "check-go-toolchain: $file is missing the expected Go $GOTOOLCHAIN_PIN pin ($label)" >&2
    fail=1
  fi
}

check_pin "go.mod"           "^go ${GOTOOLCHAIN_PIN}\$"                              "go.mod 'go <version>'"
check_pin ".goreleaser.yaml" "GOTOOLCHAIN=go${GOTOOLCHAIN_PIN}\$"                    ".goreleaser.yaml GOTOOLCHAIN env"
check_pin "Makefile"         "^GOTOOLCHAIN \\?= go${GOTOOLCHAIN_PIN}\$"              "Makefile GOTOOLCHAIN ?="
check_pin ".gitlab-ci.yml"   "GOTOOLCHAIN: go${GOTOOLCHAIN_PIN}"                     ".gitlab-ci.yml GOTOOLCHAIN var"
check_pin "README.md"        "Go-${GOTOOLCHAIN_PIN}-00ADD8"                          "README.md Go badge"
check_pin "README.md"        "Build \\(Go ${GOTOOLCHAIN_PIN} \\+ Node"               "README.md quick-start hint"

# Check 2: stale-pin grep — any 1.26.x !== $GOTOOLCHAIN_PIN is a leftover.
# We grep across the audited files only (NOT the full tree — generated
# code, vendored deps, etc. can legitimately mention older versions).
audit_files=(go.mod .goreleaser.yaml Makefile .gitlab-ci.yml README.md)
for f in "${audit_files[@]}"; do
  [ -f "$f" ] || continue
  # Strip any pre-existing pin to $GOTOOLCHAIN_PIN, then grep for any
  # remaining "1.26.<digit>" — those are stale and must be bumped.
  if leftover=$(grep -nE 'go ?1\.26\.[0-9]+' "$f" | grep -vE "1\.26\.${GOTOOLCHAIN_PIN##*.}([^0-9]|\$)" || true); [ -n "$leftover" ]; then
    while IFS= read -r line; do
      echo "check-go-toolchain: stale Go-1.26.x pin in $f (want 1.26.${GOTOOLCHAIN_PIN##*.}):" >&2
      echo "  $line" >&2
      fail=1
    done <<< "$leftover"
  fi
done

if [ "$fail" -ne 0 ]; then
  echo >&2
  echo "Bump every audited file to Go $GOTOOLCHAIN_PIN, then re-run this script." >&2
  echo "If a new file needs to be audited, add it to scripts/check-go-toolchain.sh." >&2
  exit 1
fi

echo "check-go-toolchain: all Go toolchain pins agree on $GOTOOLCHAIN_PIN."
