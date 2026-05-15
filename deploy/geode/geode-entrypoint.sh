#!/usr/bin/env bash
# Geode test-stack entrypoint. Splits the v0.5.15 first-start flow into
# three deterministic phases:
#
#   1. (first run only) `geode auth init --data-dir /data` — creates the
#      admin user and HMAC chain offline. Captures the random
#      "Generated password: <hex>" line from stdout. A marker file
#      /data/.bootstrap-extracted prevents re-running on subsequent
#      starts (auth init refuses to run twice anyway, but the marker
#      keeps the parsing logic from being entered when not needed).
#
#   2. (first run only) `geode user reset-password` — rotates the admin
#      from the random bootstrap value to ${GEODE_BOOTSTRAP_PASSWORD}
#      (default: "Geode E2E Bootstrap Password 2024"). This is required
#      because v0.5.15's wire-level auth enforces a passphrase policy
#      (min 20 chars, ≥3 words, mixed case) and the bootstrap hex
#      password fails that policy on the FIRST wire-login attempt,
#      bouncing the operator into error.PasswordResetRequired with no
#      session — meaning they cannot run ALTER USER over the wire to
#      escape. The offline `user reset-password` path clears
#      password_reset_required and accepts the relaxed (min 8 char)
#      CLI policy, so the geode-init container can authenticate over
#      the wire on its first attempt. The final password is written
#      to /data/admin-password.txt for geode-init to consume.
#
#   3. `exec geode serve` with the original CMD args — server starts up
#      against the already-initialized auth records.
#
# The geode-init container mounts the same /data volume read-only at
# /shared-data, so it can read the rotated password from
# /shared-data/admin-password.txt and proceed directly with the seed.
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
ADMIN_USER="${GEODE_ADMIN_USER:-geode}"
TARGET_PW="${GEODE_BOOTSTRAP_PASSWORD:-Geode E2E Bootstrap Password 2024}"

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
    echo "[entrypoint] auth init produced bootstrap password (${#pw} chars)" >&2

    # Rotate offline to a policy-compliant target. The wire-level passphrase
    # policy (geode_auth_lib.zig::geodeSecure) rejects the bootstrap hex
    # password as too weak, blocking any wire-side ALTER USER attempt.
    # Offline `user reset-password` clears password_reset_required and
    # enforces only the relaxed CLI policy.
    echo "[entrypoint] rotating admin offline to target password (${#TARGET_PW} chars)" >&2
    if ! GEODE_DATA_DIR="$DATA_DIR" geode user reset-password "$ADMIN_USER" \
            --new-password "$TARGET_PW" >&2; then
        echo "[entrypoint] FATAL: offline reset-password failed" >&2
        exit 1
    fi

    # Atomic write so geode-init never sees a half-written file.
    umask 077
    printf '%s' "$TARGET_PW" > "${PWFILE}.tmp"
    mv "${PWFILE}.tmp" "$PWFILE"
    : > "$MARKER"
    echo "[entrypoint] rotated admin password written to ${PWFILE}" >&2
fi

echo "[entrypoint] starting 'geode serve $*'" >&2
exec geode serve "$@"
