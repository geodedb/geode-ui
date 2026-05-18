#!/usr/bin/env bash
# Geode v0.5.18 test-stack entrypoint. Splits the first-start flow into
# two deterministic phases:
#
#   1. (first run only) `geode auth init --data-dir /data` — creates the
#      admin user and HMAC chain offline. v0.5.18 (security fix #819,
#      auth_init_cli.zig:110-191) NEVER prints the bootstrap password
#      to stdout. Instead it either (a) sources the password from
#      ${GEODE_ADMIN_PASSWORD} when set, or (b) writes a random value
#      to ${DATA_DIR}/.geode_admin_password (mode 0600). This entrypoint
#      takes path (a): we set GEODE_ADMIN_PASSWORD to ${TARGET_PW} so
#      the password is known up-front, password_reset_required is false
#      (auth_graph_manager.zig:688), and the admin can authenticate
#      over the wire on its first attempt without an offline rotation.
#      A marker file /data/.bootstrap-extracted prevents re-running.
#
#   2. `exec geode serve` with the original CMD args — the server
#      starts up against the already-initialized auth records.
#
# The geode-init container mounts the same /data volume read-only at
# /shared-data and reads /shared-data/admin-password.txt for the
# wire-level seeding handshake.
set -euo pipefail

DATA_DIR="${GEODE_DATA_DIR:-/data}"
PWFILE="${DATA_DIR}/admin-password.txt"
MARKER="${DATA_DIR}/.bootstrap-extracted"
ADMIN_USER="${GEODE_ADMIN_USER:-geode}"
TARGET_PW="${GEODE_BOOTSTRAP_PASSWORD:-Geode E2E Bootstrap Password 2024}"

if [[ ! -f "$MARKER" ]]; then
    echo "[entrypoint] first start: running 'geode auth init' offline" >&2

    # v0.5.18 reads the admin password from GEODE_ADMIN_PASSWORD when set
    # (bootstrapDefaultAdmin at auth_graph_manager.zig:631-660). Pass
    # ${TARGET_PW} so the password is policy-compliant and no offline
    # reset is needed.
    if ! GEODE_ADMIN_USER="$ADMIN_USER" \
            GEODE_ADMIN_PASSWORD="$TARGET_PW" \
            geode auth init --data-dir "$DATA_DIR" >&2; then
        echo "[entrypoint] FATAL: auth init failed" >&2
        exit 1
    fi

    # Atomic write so geode-init never sees a half-written file.
    umask 077
    printf '%s' "$TARGET_PW" > "${PWFILE}.tmp"
    mv "${PWFILE}.tmp" "$PWFILE"
    : > "$MARKER"
    echo "[entrypoint] admin password persisted to ${PWFILE}" >&2
fi

echo "[entrypoint] starting 'geode serve $*'" >&2
exec geode serve "$@"
