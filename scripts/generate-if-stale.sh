#!/usr/bin/env bash
# QUALITY #177: sentinel-aware genapi runner.
#
# Hashes geode.json (the genapi input contract). If the hash matches
# the value recorded in gen/.sentinel from the last successful regen,
# short-circuit — the gen/ tree is already up-to-date with the contract.
# Otherwise re-run `genapi generate` + `go mod tidy` and record the
# new hash.
#
# Force a re-run with `make generate-force` (deletes the sentinel)
# or by setting `FORCE_REGEN=1` in the environment.

set -euo pipefail

INPUT="${INPUT:-geode.json}"
SENTINEL="${SENTINEL:-gen/.sentinel}"
CURRENT_SHA=$(sha256sum "${INPUT}" | cut -d' ' -f1)

if [ "${FORCE_REGEN:-0}" != "1" ] \
  && [ -f "${SENTINEL}" ] \
  && [ "$(cat "${SENTINEL}")" = "${CURRENT_SHA}" ]; then
  echo "==> generate: skipped (${INPUT} unchanged since last regen)"
  exit 0
fi

echo "==> generate: regenerating from ${INPUT}"
genapi generate --config "${INPUT}" --out gen/ --with-tests
go mod tidy
mkdir -p gen
echo "${CURRENT_SHA}" > "${SENTINEL}"
