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
GEODE_VULNDB_GQL="${GEODE_VULNDB_GQL:-/seed/vulndb.gql}"
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
        # Geode v0.5.11 caveat: the "must-reset" flag may still be set
        # on this user account even though the target password
        # authenticates via the CLI (the CLI tolerates the flag for
        # `RETURN 1` and `ALTER USER`). On restarts this leaves the
        # SPA wire-login broken with 08P01 because the wire path is
        # strict. Recovering from the script side requires rotating to
        # a *different* value (Geode treats target->target as a no-op
        # for the flag), which would invalidate the configured
        # GEODE_ADMIN_PASSWORD. Instead, the SPA's /auth/login surfaces
        # a `must_reset` flag in this state and the UI guides the user
        # through a reset; the server-side /auth/reset-password
        # endpoint runs ALTER USER on their behalf with a new value.
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

# Step 3: ensure e2e_admin exists. Geode v0.5.18 supports CREATE USER over
# the GQL wire per docs/GQL_AUTH_DDL.md grammar:
#   CREATE USER <name> SET PASSWORD <string> [ EMAIL <string> ] [ ROLE <name> ]
# The Playwright fixture authenticates as E2E_USER once this succeeds. If
# the user already exists (idempotent re-runs of `e2e-up`), CREATE USER
# returns a duplicate-key error and we trust the existing credentials.
ensure_e2e_user() {
    log "ensuring e2e user '${E2E_USER}'"
    local out
    out=$(echo "CREATE USER ${E2E_USER} SET PASSWORD '${E2E_PASSWORD}' EMAIL '${E2E_USER}@e2e.local' ROLE admin" \
        | query_admin - 2>&1 || true)
    if echo "RETURN 1" | geode query \
        --insecure-tls-skip-verify \
        --server "${GEODE_ADDR}" \
        -U "${E2E_USER}" -P "${E2E_PASSWORD}" - >/dev/null 2>&1; then
        log "e2e user '${E2E_USER}' authenticates over the wire"
    else
        log "WARNING: e2e user '${E2E_USER}' does not authenticate"
        log "(Playwright fixture will fall back to the rotated admin)"
        # Surface the actual CREATE USER response for diagnostic value.
        if printf '%s' "$out" | grep -qE 'status_class|error'; then
            log "  server response: $(printf '%s' "$out" | head -c 240)"
        fi
    fi
}

# Helper: does $graph exist? Uses SHOW GRAPHS so we don't accidentally
# create an empty graph via `USE GRAPH <name>` (which auto-creates on
# this Geode build, breaking subsequent `CREATE GRAPH` in the seed file
# with status_class=42P07).
graph_exists() {
    local graph="$1" out
    out=$(echo "SHOW GRAPHS" | query_admin - 2>/dev/null || true)
    printf '%s' "$out" | grep -q "\"name\":\"${graph}\""
}

# Helper: returns count(n) for the named graph. ONLY safe to call
# after we've confirmed the graph exists (or after a seed has run).
count_nodes() {
    local graph="$1"
    echo "USE GRAPH ${graph}; MATCH (n) RETURN count(n) AS c" \
        | query_admin - 2>/dev/null || true
}

# Idempotently seed a graph from a multi-statement GQL file.
#
# `geode query -f` halts on the first statement-level error, so we
# must not let `CREATE GRAPH <name>` collide with an existing graph.
# If the graph already has the expected node count, skip; otherwise
# DROP and replay.
seed_graph() {
    local graph="$1" gql_path="$2" expected_count="$3"
    if [[ ! -f "$gql_path" ]]; then
        err "${graph} seed not found at ${gql_path}"
        return 1
    fi

    if graph_exists "$graph"; then
        if count_nodes "$graph" | grep -q "\"c\":${expected_count}"; then
            log "${graph} graph already populated (${expected_count} nodes); skipping seed"
            return 0
        fi
        log "${graph} graph exists but is incomplete; dropping for clean reseed"
        echo "DROP GRAPH ${graph}" | query_admin - >/dev/null 2>&1 || true
    fi

    log "populating ${graph} graph from ${gql_path}"
    # We don't trust the client's exit code (it returns nonzero on the
    # trailing empty result of some DDL statements); verify by node
    # count below.
    query_admin -f "$gql_path" >/dev/null 2>&1 || true
}

verify_graph() {
    local graph="$1" expected_count="$2"
    if ! graph_exists "$graph"; then
        err "verification failed: graph '${graph}' does not exist"
        return 1
    fi
    local out
    out=$(count_nodes "$graph")
    if printf '%s' "$out" | grep -q "\"c\":${expected_count}"; then
        log "verified: ${expected_count} nodes in graph '${graph}'"
        return 0
    fi
    err "expected ${expected_count} nodes in '${graph}', got: $out"
    return 1
}

# Geode v0.5.18's `geode query -f` duplicates the last statement of
# each ~100-statement batch when ingesting a multi-statement seed
# file (one extra row per batch boundary; observed empirically at
# ~110-line intervals in our 1700-statement vulndb.gql). The
# duplicates have distinct internal node ids but the same property
# id, so a single dedupe pass per label collapses them back down.
#
# Why we don't just patch the server: the CLI quirk is upstream of
# this repo and affects any -f ingest. Cleaning up post-hoc keeps the
# bootstrap idempotent and matches the count the seed file declares.
dedupe_graph_label() {
    local graph="$1" label="$2"
    local dup_query="USE GRAPH ${graph}; MATCH (n:${label}) WITH n.id AS xid, count(n) AS c WHERE c > 1 RETURN xid"
    local resp
    resp=$(echo "${dup_query}" | query_admin - 2>/dev/null || true)
    # Extract dup ids from the JSON `{"xid":"<value>"...}` rows. The
    # geode image ships busybox-only userland (no python, no jq), so
    # we use grep + sed against the well-known response shape.
    local dup_ids
    dup_ids=$(printf '%s' "${resp}" \
        | grep -oE '"xid":"[^"]+"' \
        | sed -E 's/.*"xid":"([^"]+)".*/\1/' \
        | tr '\n' ' ' || true)
    if [[ -z "${dup_ids// /}" ]]; then
        return 0
    fi
    local removed=0
    for xid in ${dup_ids}; do
        # Cap the per-id pass at 16 — a runaway duplicate count shouldn't
        # spin forever (real-world max observed is 2 per id).
        local pass
        for ((pass = 0; pass < 16; pass++)); do
            local count_resp n
            count_resp=$(echo "USE GRAPH ${graph}; MATCH (n:${label} {id: '${xid}'}) RETURN count(n) AS c" \
                | query_admin - 2>/dev/null || true)
            n=$(printf '%s' "${count_resp}" \
                | grep -oE '"c":[0-9]+' \
                | head -1 \
                | cut -d: -f2)
            [[ -z "${n}" ]] && n=0
            if [[ "${n}" -le 1 ]]; then
                break
            fi
            # Get one internal id to delete.
            local int_resp internal_id
            int_resp=$(echo "USE GRAPH ${graph}; MATCH (n:${label} {id: '${xid}'}) RETURN id(n) AS i LIMIT 1" \
                | query_admin - 2>/dev/null || true)
            internal_id=$(printf '%s' "${int_resp}" \
                | grep -oE '"i":[0-9]+' \
                | head -1 \
                | cut -d: -f2)
            if [[ -z "${internal_id}" ]]; then
                break
            fi
            echo "USE GRAPH ${graph}; MATCH (n:${label}) WHERE id(n) = ${internal_id} DETACH DELETE n" \
                | query_admin - >/dev/null 2>&1 || true
            removed=$((removed + 1))
        done
    done
    if [[ "${removed}" -gt 0 ]]; then
        log "deduped ${removed} duplicate ${label} node(s) in ${graph} (geode v0.5.18 CLI batch artifact)"
    fi
    return 0
}

main() {
    wait_for_wire
    ensure_admin_password
    ensure_e2e_user
    # 171 = 38 Movie + 133 Person from the Neo4j Movies dataset.
    seed_graph movies "${GEODE_INIT_GQL}" 171
    verify_graph movies 171
    # vulndb is a richer secondary fixture: ~969 CWE + KEV CVEs +
    # affected Package nodes. Treat any partial-load as non-fatal so
    # the geode-ui stack still comes up (the movies graph is what
    # gates the e2e suite); log the discrepancy for diagnostics.
    if [[ -f "${GEODE_VULNDB_GQL}" ]]; then
        seed_graph vulndb "${GEODE_VULNDB_GQL}" 1369 || \
            log "vulndb seed reported a non-zero status (continuing)"
        # Strip the geode CLI's batch-boundary duplicate artifacts
        # before verifying the row count. See dedupe_graph_label for the
        # quirk; without this, vulndb routinely lands at 1379 (10 extras
        # across CWE + CVE) and fails the strict count check.
        dedupe_graph_label vulndb CWE
        dedupe_graph_label vulndb CVE
        dedupe_graph_label vulndb Package
        verify_graph vulndb 1369 || \
            log "vulndb seed is partial; check convert-vulndb.py output for parse-rejected rows"
    else
        log "vulndb seed not present at ${GEODE_VULNDB_GQL}; skipping"
    fi
    log "bootstrap complete"
}

main "$@"
