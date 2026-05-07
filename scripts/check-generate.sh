#!/usr/bin/env bash
# Pre-push hook: ensure `make generate` produces no diff.
#
# Regenerates gen/ from geode.json and fails if any file changed. A clean
# pre-push state means the committed generated code reflects the current
# spec; otherwise reviewers can't trust the gen/ diff in PRs.
set -euo pipefail

make generate

if ! git diff --exit-code -- gen/ go.mod go.sum; then
  echo
  echo "make generate produced changes that aren't committed."
  echo "Commit the regenerated gen/ tree (and any go.mod/go.sum updates)."
  exit 1
fi
