#!/usr/bin/env bash
# QUALITY #48 / GAP-019: Go coverage ratchet.
#
# Runs `go test -race -coverprofile` against the project-owned packages
# and fails if the total statement-coverage ratio falls below the
# committed floor. Today's measured floor (2026-05-16, cmd + internal):
#   total: 80.1% statements
# Floor: total - 1 pp = 79%
#
# Per-package coverage is reported but not gated; the total ratio is
# the load-bearing metric. Refresh the floor in a follow-up commit
# when a deliberate coverage push lands.
#
# Override the floor with `GO_COVERAGE_FLOOR=<percentage>` if needed.

set -euo pipefail

FLOOR="${GO_COVERAGE_FLOOR:-79}"
PROFILE="${GO_COVERAGE_PROFILE:-coverage.out}"
PKGS="${GO_COVERAGE_PKGS:-./cmd/... ./internal/...}"

# Run go test with the coverprofile flag. Exclude gen/ from the gate
# (genapi output; mostly untested by convention) but still produce a
# combined profile so cmd/ + internal/ ratios are accurate.
GOEXPERIMENT="${GOEXPERIMENT:-jsonv2}" \
GOTOOLCHAIN="${GOTOOLCHAIN:-go1.26.3}" \
  go test -race -coverprofile="${PROFILE}" -covermode=atomic ${PKGS} > /dev/null

# `go tool cover -func` emits a "total: (statements)  XX.X%" line at the
# end of its output; grep + awk it.
TOTAL=$(go tool cover -func="${PROFILE}" | awk '/^total:/ {print $3}' | tr -d '%')

if [ -z "${TOTAL}" ]; then
  echo "FAIL: could not read total coverage from ${PROFILE}" >&2
  exit 1
fi

# Compare against the floor using awk (bash can't do floats natively).
ABOVE=$(awk -v a="${TOTAL}" -v b="${FLOOR}" 'BEGIN { print (a >= b) ? "1" : "0" }')

if [ "${ABOVE}" = "1" ]; then
  echo "OK: go total coverage ${TOTAL}% >= floor ${FLOOR}%"
  exit 0
fi

echo "FAIL: go total coverage ${TOTAL}% < floor ${FLOOR}%" >&2
echo "Run \`go tool cover -html=${PROFILE}\` to inspect uncovered lines." >&2
exit 1
