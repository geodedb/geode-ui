#!/usr/bin/env bash
# Pre-push hook: ensure `go mod tidy` produces no diff.
#
# Runs `go mod tidy` and fails if go.mod or go.sum changed. A clean
# pre-push state means dependencies match imports — no unused requires,
# no missing declarations.
set -euo pipefail

export GOEXPERIMENT=jsonv2
export GOTOOLCHAIN=go1.27.0

go mod tidy

if ! git diff --exit-code -- go.mod go.sum; then
  echo
  echo "go.mod or go.sum was modified by 'go mod tidy'."
  echo "Commit the updated module files."
  exit 1
fi
