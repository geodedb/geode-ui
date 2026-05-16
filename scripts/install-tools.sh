#!/usr/bin/env bash
# QUALITY #46 / GAP-018: bootstrap pinned Go developer tools.
#
# Run from a fresh checkout to install the toolchain `make go-lint`,
# `make generate`, and the bench-gate scripts expect. Versions are
# pinned to keep local-vs-CI parity: a regression in the linter or
# genapi schema generator fails the same on every developer's machine
# as it does in the pipeline.
#
# Bump the versions deliberately (and in lockstep with the matching
# `go install` line in `.gitlab-ci.yml`'s `go:lint` / `go:generate-verify`
# jobs). The CI side carries the same pin so a one-side bump fails CI
# loudly instead of drifting silently.

set -euo pipefail

GOLANGCI_LINT_VERSION="${GOLANGCI_LINT_VERSION:-v2.12.2}"
GENAPI_VERSION="${GENAPI_VERSION:-v0.3.2}"
GOIMPORTS_VERSION="${GOIMPORTS_VERSION:-latest}"

echo "==> installing golangci-lint@${GOLANGCI_LINT_VERSION}"
go install "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@${GOLANGCI_LINT_VERSION}"

echo "==> installing genapi@${GENAPI_VERSION}"
go install "devnw.dev/genapi/cmd/genapi@${GENAPI_VERSION}"

echo "==> installing goimports@${GOIMPORTS_VERSION}"
go install "golang.org/x/tools/cmd/goimports@${GOIMPORTS_VERSION}"

echo "==> tool versions:"
"${GOPATH:-$HOME/go}/bin/golangci-lint" version 2>&1 | head -1 || true
"${GOPATH:-$HOME/go}/bin/genapi" --version 2>&1 | head -1 || true

echo
echo "Tools installed under ${GOPATH:-$HOME/go}/bin."
echo "Ensure that directory is on your PATH before running make targets."
