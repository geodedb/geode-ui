#!/usr/bin/env bash
# Geode test-stack entrypoint. Splits the v0.5.11 first-start flow into
# two deterministic phases:
#
#   1. (first run only) `geode auth init --data-dir /data` — creates the
#      admin user and HMAC chain offline. Captures the random
#      "Generated password: <hex>" line from stdout and writes it to
#      /data/admin-password.txt (atomic via tmp+mv). A marker file
#      /data/.bootstrap-extracted prevents re-running on subsequent
#      starts (auth init refuses to run twice anyway, but the marker
#      keeps the parsing logic from being entered when not needed).
#
#   2. `exec geode serve` with the original CMD args — server starts up
#      against the already-initialized auth records.
#
# The geode-init container mounts the same /data volume read-only at
# /shared-data, so it can read the password from
# /shared-data/admin-password.txt and rotate it via ALTER USER.
#
# Why a wrapper instead of letting `geode serve` first-start auto-init?
#   `geode serve` does run auth init on a fresh data dir, but it prints
#   the password to its OWN stdout and never persists it to disk.
#   Capturing that line from `tee | grep` while keeping geode as PID 1
#   (so signals propagate cleanly) is fragile. Splitting init out is
#   simpler, deterministic, and matches the offline init flow that the
#   geode CLI already supports.
set -euo pipefail

DATA_DIR="${GEODE_DATA_DIR:-/data}"
PWFILE="${DATA_DIR}/admin-password.txt"
MARKER="${DATA_DIR}/.bootstrap-extracted"

if [[ ! -f "$MARKER" ]]; then
    echo "[entrypoint] first start: running 'geode auth init' offline" >&2
    init_out=$(geode auth init --data-dir "$DATA_DIR" 2>&1 || true)
    echo "$init_out" >&2

    # Extract the generated password. Format from auth_init_cli.zig is
    #   "Generated password: <32-hex>"
    pw=$(printf '%s\n' "$init_out" \
        | grep -oE 'Generated password: [a-f0-9]+' \
        | head -1 \
        | awk '{print $3}')

    if [[ -z "$pw" ]]; then
        echo "[entrypoint] FATAL: auth init produced no admin password" >&2
        echo "[entrypoint] auth init output was:" >&2
        echo "$init_out" >&2
        exit 1
    fi

    # Atomic write so geode-init never sees a half-written file.
    umask 077
    printf '%s' "$pw" > "${PWFILE}.tmp"
    mv "${PWFILE}.tmp" "$PWFILE"
    : > "$MARKER"
    echo "[entrypoint] bootstrap password written to ${PWFILE}" >&2
fi

echo "[entrypoint] starting 'geode serve $*'" >&2
exec geode serve "$@"
