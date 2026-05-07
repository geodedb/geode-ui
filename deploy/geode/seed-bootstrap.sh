#!/usr/bin/env bash
# Geode test-stack bootstrap. Runs once per `docker compose up` lifecycle
# inside the geode-init container, then exits 0. Idempotent: safe to
# rerun against an already-populated data dir (skips rotation and seed).
#
# Required env (with sensible defaults):
#   GEODE_HOST                hostname of the geode service     (default: geode)
#   GEODE_PORT                Geode QUIC port                   (default: 3141)
#   GEODE_ADMIN_USER          admin username                    (default: geode)
#   GEODE_ADMIN_PASSWORD      target admin password
#                             (default: 'Geode E2E Bootstrap Password 2024')
#   E2E_USER                  playwright fixture username       (default: e2e_admin)
#   E2E_PASSWORD              playwright fixture password
#                             (default: 'E2E Admin User Password 2024')
#   GEODE_BOOTSTRAP_PASSWORD  optional override for the random bootstrap
#                             password (compose can pre-populate from logs)
#   GEODE_INIT_GQL            path to the seed file             (default: /seed/init.gql)
#   GEODE_WAIT_SECS           seconds to wait for the wire      (default: 60)
#
# Geode v0.5.11 dialect/auth quirks discovered via E2/E3:
#   1. First-login admin password rotation is mandatory. The server
#      generates a random hex token on first start and prints
#         *** Generated admin password: <hex> ***
#      to stdout. Until rotated, every wire query rejects with
#         status_class=08P01  "Password reset required..."
#   2. Password policy: "passphrase with at least 3 words" (lower bound
#      enforced by the auth subsystem, not a length/character mix).
#   3. `ALTER USER ... SET PASSWORD '...'` succeeds even though the
#      `geode query` client prints `Error: query execution failed` on
#      stdout for the trailing empty result set. We confirm rotation by
#      re-authenticating with the new password, NOT by exit code.
#   4. `CREATE USER` over the wire raises status_class=42000
#      ("expected token 'l_paren' ..."). The DDL surface for users is
#      not on the wire in v0.5.11, so we fall back to the rotated admin
#      for the e2e fixture login (per the plan's documented behavior).
#   5. `USE GRAPH foo;` does NOT persist across statements within a
#      single `geode query` invocation; init.gql repeats USE GRAPH
#      before every data statement.
#   6. `USE GRAPH movies` AUTO-CREATES an empty `movies` graph if it
#      doesn't exist, which then collides with `CREATE GRAPH movies`
#      in init.gql (status_class=42P07 "Duplicate graph name") and
#      halts the rest of the multi-statement run, leaving 0 nodes.
#      The bootstrap therefore uses `SHOW GRAPHS` (read-only) for the
#      idempotency check, never `USE GRAPH` as a probe, and DROPs an
#      incomplete graph before reseeding.
#   7. `geode query -f <file>` halts on the first statement-level
#      error and emits a misleading nonzero exit code on the trailing
#      empty result of some DDL statements. We therefore swallow the
#      client's exit code and verify the seed via a node-count probe.

set -euo pipefail

GEODE_HOST="${GEODE_HOST:-geode}"
GEODE_PORT="${GEODE_PORT:-3141}"
GEODE_ADMIN_USER="${GEODE_ADMIN_USER:-geode}"

# Geode v0.5.11's `geode query --server` does NOT resolve hostnames; it
# expects host:port where host is an IP literal (otherwise the client
# bails with `InvalidAddress`/`query execution failed`). Resolve the
# compose service name to an IP up-front so subsequent queries reach
# the server. Block until DNS yields an answer (depends_on guarantees
# the geode container is up but not that the embedded resolver has the
# service entry yet on first start).
resolve_host() {
    local host="$1" ip i
    for ((i = 1; i <= 30; i++)); do
        ip=$(getent hosts "$host" 2>/dev/null | awk '{print $1; exit}')
        if [[ -n "${ip:-}" ]]; then
            printf '%s' "$ip"
            return 0
        fi
        sleep 1
    done
    return 1
}

if [[ "$GEODE_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    GEODE_ADDR="${GEODE_HOST}:${GEODE_PORT}"
else
    GEODE_IP=$(resolve_host "$GEODE_HOST") || {
        printf '[seed] could not resolve %s to an IP\n' "$GEODE_HOST" >&2
        exit 1
    }
    GEODE_ADDR="${GEODE_IP}:${GEODE_PORT}"
fi
GEODE_ADMIN_PASSWORD="${GEODE_ADMIN_PASSWORD:-Geode E2E Bootstrap Password 2024}"
E2E_USER="${E2E_USER:-e2e_admin}"
E2E_PASSWORD="${E2E_PASSWORD:-E2E Admin User Password 2024}"
GEODE_INIT_GQL="${GEODE_INIT_GQL:-/seed/init.gql}"
GEODE_WAIT_SECS="${GEODE_WAIT_SECS:-60}"

log() { printf '[seed] %s\n' "$*"; }
err() { printf '[seed] %s\n' "$*" >&2; }

# Run a query as the (rotated) admin. Reads stdin if no positional arg.
query_admin() {
    geode query \
        --insecure-tls-skip-verify \
        --server "${GEODE_ADDR}" \
        -U "${GEODE_ADMIN_USER}" \
        -P "${GEODE_ADMIN_PASSWORD}" \
        "$@"
}

# Run a query as admin with an explicit password (used during rotation).
query_with_pw() {
    local pw="$1"
    shift
    geode query \
        --insecure-tls-skip-verify \
        --server "${GEODE_ADDR}" \
        -U "${GEODE_ADMIN_USER}" \
        -P "${pw}" \
        "$@"
}

# Step 1: wait for the QUIC wire to come up. Any auth-rejected reply
# proves the wire is up; we only care about reachability here.
wait_for_wire() {
    log "waiting for ${GEODE_HOST}:${GEODE_PORT} (resolved ${GEODE_ADDR}, timeout ${GEODE_WAIT_SECS}s)..."
    local i out
    for ((i = 1; i <= GEODE_WAIT_SECS; i++)); do
        # Probe with a deliberately-bad password against a NONEXISTENT
        # username — never the real admin. Geode v0.5.11 locks a user
        # for 5 minutes after 5 failed-password attempts; a probe that
        # used `-U ${GEODE_ADMIN_USER}` would burn 1-5 attempts here
        # and could lock the admin before the rotation step runs.
        # An unknown user produces the same "Authentication failed"
        # response (auth check happens before we know the user exists)
        # without touching any real account's counter.
        out=$(geode query \
            --insecure-tls-skip-verify \
            --server "${GEODE_ADDR}" \
            -U "_seed_wire_probe_" -P "x" \
            "RETURN 1" 2>&1 || true)
        if printf '%s' "$out" | grep -qiE 'auth|Authentication|password|invalid|incorrect|reset required|status_class'; then
            log "geode wire is up"
            return 0
        fi
        sleep 1
    done
    err "geode did not become reachable in ${GEODE_WAIT_SECS}s"
    return 1
}

# Step 2: discover bootstrap password (if rotation hasn't happened yet)
# and rotate to GEODE_ADMIN_PASSWORD.
#
# Strategy:
#   a. Try the target password. If it works, rotation is already done.
#   b. Try GEODE_BOOTSTRAP_PASSWORD env (compose can pre-populate this
#      via `docker logs <geode>` parse).
#   c. Try /shared-data/admin-password.txt (offline-init artifact).
#   d. Fail with a clear diagnostic.
#
# After any rotation attempt, re-authenticate with the target password
# to confirm it actually took. The `geode query` client prints
# "Error: query execution failed" on the trailing empty result of a
# single ALTER USER statement, so we don't trust its exit code.
ensure_admin_password() {
    log "testing target admin password"
    if echo "RETURN 1" | query_admin - >/dev/null 2>&1; then
        log "target admin password already active (skipping rotation)"
        return 0
    fi

    log "rotating admin password"
    local bootstrap=""
    if [[ -n "${GEODE_BOOTSTRAP_PASSWORD:-}" ]]; then
        bootstrap="${GEODE_BOOTSTRAP_PASSWORD}"
        log "using GEODE_BOOTSTRAP_PASSWORD from environment"
    elif [[ -f /shared-data/admin-password.txt ]]; then
        bootstrap=$(cat /shared-data/admin-password.txt)
        log "using bootstrap password from /shared-data/admin-password.txt"
    fi

    if [[ -z "$bootstrap" ]]; then
        err "cannot find bootstrap admin password."
        err "set GEODE_BOOTSTRAP_PASSWORD or write it to /shared-data/admin-password.txt"
        err "(extract from geode container stdout: 'Generated admin password: <hex>')"
        return 2
    fi

    # Issue the rotation. We swallow the client's misleading exit code
    # and verify by re-authenticating below.
    echo "ALTER USER ${GEODE_ADMIN_USER} SET PASSWORD '${GEODE_ADMIN_PASSWORD}'" \
        | query_with_pw "$bootstrap" - >/dev/null 2>&1 || true

    # Verify rotation took.
    if ! echo "RETURN 1" | query_admin - >/dev/null 2>&1; then
        err "admin rotation failed: target password does not authenticate"
        err "(check that GEODE_ADMIN_PASSWORD satisfies the v0.5.11"
        err " passphrase policy: at least 3 words)"
        return 3
    fi
    log "admin password rotated"
}

# Step 3: ensure e2e_admin exists. Best-effort: Geode v0.5.11 does NOT
# expose CREATE USER on the wire (status_class=42000), so this is
# expected to be a no-op on this build. The Playwright login fixture
# falls back to the rotated admin in that case.
ensure_e2e_user() {
    log "ensuring e2e user '${E2E_USER}' (best-effort)"
    local out
    out=$(echo "CREATE USER ${E2E_USER} WITH EMAIL '${E2E_USER}@e2e.local' PASSWORD '${E2E_PASSWORD}'" \
        | query_admin - 2>&1 || true)
    if echo "RETURN 1" | geode query \
        --insecure-tls-skip-verify \
        --server "${GEODE_ADDR}" \
        -U "${E2E_USER}" -P "${E2E_PASSWORD}" - >/dev/null 2>&1; then
        log "e2e user '${E2E_USER}' authenticates over the wire"
    else
        log "CREATE USER not available on the wire in this Geode build"
        log "(Playwright fixture will use the rotated admin instead)"
        # Surface the actual error code once for diagnostic value.
        if printf '%s' "$out" | grep -qE 'status_class'; then
            log "  server response: $(printf '%s' "$out" | head -c 200)"
        fi
    fi
}

# Helper: does the 'movies' graph already exist? Uses SHOW GRAPHS so
# we don't accidentally create an empty graph via `USE GRAPH movies`
# (which auto-creates on this Geode build, breaking subsequent
# `CREATE GRAPH movies` in the seed file with status_class=42P07).
movies_graph_exists() {
    local out
    out=$(echo "SHOW GRAPHS" | query_admin - 2>/dev/null || true)
    printf '%s' "$out" | grep -q '"name":"movies"'
}

# Helper: returns count(n) for graph movies. ONLY safe to call after
# we've confirmed the graph exists (or after a seed has run).
count_movies_nodes() {
    echo "USE GRAPH movies; MATCH (n) RETURN count(n) AS c" \
        | query_admin - 2>/dev/null || true
}

# Step 4: populate the movies graph.
#
# Idempotency strategy: if the graph already has 9 nodes, do nothing.
# Otherwise, DROP the graph (if it exists) and replay init.gql.
# `geode query -f` halts on the first statement-level error, so we
# must not let `CREATE GRAPH movies` collide with an existing graph.
seed_movies() {
    if [[ ! -f "${GEODE_INIT_GQL}" ]]; then
        err "init.gql not found at ${GEODE_INIT_GQL}"
        return 1
    fi

    if movies_graph_exists; then
        if count_movies_nodes | grep -q '"c":9'; then
            log "movies graph already populated (9 nodes); skipping seed"
            return 0
        fi
        log "movies graph exists but is incomplete; dropping for clean reseed"
        echo "DROP GRAPH movies" | query_admin - >/dev/null 2>&1 || true
    fi

    log "populating movies graph from ${GEODE_INIT_GQL}"
    # init.gql is multi-statement; --file feeds it through the query
    # client which handles statement splitting. We don't trust the
    # client's exit code (it returns nonzero on the trailing empty
    # result of some DDL statements); we verify by node count below.
    query_admin -f "${GEODE_INIT_GQL}" >/dev/null 2>&1 || true
}

# Step 5: verify the seed produced exactly 9 nodes.
verify_seed() {
    if ! movies_graph_exists; then
        err "verification failed: graph 'movies' does not exist"
        return 1
    fi
    local out
    out=$(count_movies_nodes)
    if printf '%s' "$out" | grep -q '"c":9'; then
        log "verified: 9 nodes in graph 'movies'"
        return 0
    fi
    err "expected 9 nodes, got: $out"
    return 1
}

main() {
    wait_for_wire
    ensure_admin_password
    ensure_e2e_user
    seed_movies
    verify_seed
    log "bootstrap complete"
}

main "$@"
