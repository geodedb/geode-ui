#!/usr/bin/env sh
set -eu
exec python3 scripts/golangci-lint.py fmt --diff
