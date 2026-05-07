#!/usr/bin/env bash
# Wrapper that pins GOEXPERIMENT=jsonv2 and GOTOOLCHAIN=go1.26.2 for every
# Go invocation in the pre-commit pipeline. Special verb `tool-golangci`
# runs golangci-lint with the same env so results match what `make go-lint`
# produces locally.
set -euo pipefail

export GOEXPERIMENT=jsonv2
export GOTOOLCHAIN=go1.26.2

verb="${1:-}"
shift || true

case "$verb" in
  tool-golangci)
    exec golangci-lint run "$@"
    ;;
  '')
    echo "run-go.sh: missing verb (vet, build, test, mod, tool-golangci, ...)" >&2
    exit 2
    ;;
  *)
    exec go "$verb" "$@"
    ;;
esac
