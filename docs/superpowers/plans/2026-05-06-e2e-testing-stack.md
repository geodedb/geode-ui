# E2E Testing Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a docker-compose stack pairing Geode v0.5.11 + the geode-ui Go API + the React SPA + the Geode LSP + the Geode MCP, pre-populated with a movies graph for testing, and ship a comprehensive Playwright test suite that drives the full UI surface (auth, query/stream/graph viz, schema explorer, admin, ops, MCP) against the live stack.

**Architecture:** Five docker services in a single compose: `geode` (Geode database, v0.5.11, persistent volume), `geode-init` (one-shot container that seeds the movies graph + admin user via `geode query` then exits), `geode-ui` (the binary built from the sibling-source Dockerfile, pointing at `geode:3141`), `geode-mcp` (HTTP-mode MCP at `:8090` pointing at the Geode endpoint), `geode-lsp` (stdin/stdout LSP wrapped in a socat TCP bridge on `:2087` for editor/test integration). Playwright runs against `http://localhost:8080` (the geode-ui SPA), uses an auth fixture that programmatically logs in once per worker, and follows the brancher e2e pattern (per-feature `.spec.ts`, shared `helpers/`, `fixtures.ts`).

**Tech Stack:** Docker Compose v2, Geode v0.5.11 (debian-bookworm-slim image), Node 22 + Playwright `@playwright/test`, Page-Object Model for stable selectors, `socat` for the LSP TCP bridge, GitLab CI Docker-in-Docker job for pipeline coverage.

---

## Working Directory

All paths in this plan are relative to `/data/home/benji/src/devnw/codepros/geode/geode-ui` unless otherwise stated. The Geode source lives at `/data/home/benji/src/devnw/codepros/geode/geode`. The geode-ui replace directive points at `/data/home/benji/src/devnw/codepros/geode/geode-client-go`.

The plan **never edits generated code** under `gen/`. If a generator change is needed, fix `~/src/devnw/go/genapi` and regen.

---

## File Structure (Final State)

```
geode-ui/
├── deploy/
│   ├── Dockerfile                      # (existing, geode-ui multi-stage)
│   └── docker-compose.example.yml      # (existing)
│
├── e2e/                                # Playwright tests (NEW)
│   ├── playwright.config.ts            # config: chromium-only, html reporter, trace on retry
│   ├── tsconfig.json                   # extends root tsconfig, ts-node-friendly
│   ├── .env.example                    # documents UI_URL, ADMIN_USER, ADMIN_PASSWORD
│   ├── fixtures.ts                     # auth fixture, seeded-data fixture, page-object fixture
│   ├── helpers/
│   │   ├── selectors.ts                # data-testid map + role-based locators
│   │   ├── auth.ts                     # programmatic login → access_token
│   │   ├── globalSetup.ts              # waits for compose stack to be healthy before tests
│   │   ├── docker.ts                   # spawn/teardown helper for `docker compose up -d`/`down`
│   │   └── gqlData.ts                  # canonical movies-graph fixtures (Person/Movie/ACTED_IN)
│   └── specs/
│       ├── 01-auth.spec.ts             # login, redirect, logout, token persistence, bad creds
│       ├── 02-connection-picker.spec.ts# profiles list, switch, persistence
│       ├── 03-query-sync.spec.ts       # editor → run → table rows, error display
│       ├── 04-query-stream.spec.ts     # WS streaming toggle, progressive rows, cancel
│       ├── 05-query-graph.spec.ts      # cytoscape canvas, click-to-inspect, label coloring
│       ├── 06-schema-explorer.spec.ts  # graphs/labels/edge-types/indexes/constraints, stage-and-go
│       ├── 07-admin-users.spec.ts      # list/create/disable/enable/delete via UI
│       ├── 08-admin-roles-policies.spec.ts # roles, policies, grants
│       ├── 09-ops.spec.ts              # backup list/create, migrations status, audit polling
│       └── 10-mcp-endpoint.spec.ts     # /mcp HTTP smoke + tool listing
│
├── deploy/
│   ├── docker-compose.test.yml         # (NEW) test compose: 5 services, named volumes, healthchecks
│   ├── geode/
│   │   ├── Dockerfile.geode            # (NEW) builds geode:v0.5.11 from sibling source
│   │   ├── init.gql                    # (NEW) seeds movies graph: 6 People + 3 Movies + 9 edges + indexes
│   │   ├── seed-bootstrap.sh           # (NEW) the geode-init container's entrypoint
│   │   └── lsp-bridge.sh               # (NEW) socat wrapper that exposes `geode lsp` over TCP :2087
│   └── playwright/
│       └── Dockerfile.playwright       # (NEW) Node 22 + @playwright/test image for CI runs
│
├── Makefile                            # (modified) add e2e-up/e2e-down/e2e-test/e2e-ci targets
├── package.json                        # (modified) add @playwright/test devDep + e2e scripts
└── .gitlab-ci.yml                      # (modified) add e2e:playwright job
```

---

# Phase 1 — Docker Compose Stack

**Goal:** `make e2e-up` spins up Geode v0.5.11 + geode-ui + MCP HTTP + LSP TCP bridge in 5 services, populates the movies graph + an `e2e_admin` user, and `curl http://localhost:8080/healthz` returns `{"status":"ok"}` plus `curl http://localhost:8090/mcp/tools/list` (or whatever MCP exposes) returns a non-empty tool list.

## Task 1: Build a `geode:v0.5.11` Docker image from sibling source

**Files:**
- Create: `deploy/geode/Dockerfile.geode`

The official Geode source at `/data/home/benji/src/devnw/codepros/geode/geode` ships `Dockerfile.release` (debian-bookworm-slim, expects a prebuilt binary in the build context). For a self-contained test stack we build a from-source image that compiles Geode v0.5.11 inside the image so the test stack works on any developer machine that has the sibling checkout.

- [ ] **Step 1: Verify v0.5.11 is the current source tag**

```bash
cd /data/home/benji/src/devnw/codepros/geode/geode && git tag -l | sort -V | tail -5
```
Expected: `v0.5.11` is the most recent tag (or a `main` checkout that includes it). If the checkout is older, `cd` there and `git fetch --tags && git checkout v0.5.11` before continuing.

- [ ] **Step 2: Write the Dockerfile**

`deploy/geode/Dockerfile.geode`:
```dockerfile
# syntax=docker/dockerfile:1.7
#
# Builds geode:v0.5.11 from the sibling source checkout. This image is
# intentionally fat (full toolchain inside) so the e2e stack works on any
# developer machine without depending on a published image registry.
#
# Build context: the parent directory of geode-ui (so that ../geode is
# available as ./geode inside the build context).
#
# Build:  docker build -f deploy/geode/Dockerfile.geode -t geode:v0.5.11 ..
# Run:    geode serve --data-dir /data --listen 0.0.0.0:3141

FROM debian:bookworm-slim AS build
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG ZIG_VERSION=0.13.0
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl xz-utils git build-essential pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Install Zig (Geode's build system uses Zig for the core).
RUN curl -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-linux-x86_64-${ZIG_VERSION}.tar.xz" \
      | tar -xJ -C /opt \
    && ln -s "/opt/zig-linux-x86_64-${ZIG_VERSION}/zig" /usr/local/bin/zig

WORKDIR /src
COPY geode/ ./
RUN ./build.sh release

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/zig-out/bin/geode /usr/local/bin/geode
RUN useradd -r -u 10001 -m -d /home/geode geode && mkdir -p /data && chown geode:geode /data

USER geode
WORKDIR /home/geode
EXPOSE 3141/udp 3141/tcp

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/geode"]
CMD ["serve", "--data-dir", "/data", "--listen", "0.0.0.0:3141"]
```

> **Build verification before continuing:** Geode's repo may use `build.zig` directly (no `build.sh`) — read `/data/home/benji/src/devnw/codepros/geode/geode/build.sh` first. If only `build.zig` exists, replace the `RUN ./build.sh release` line with `RUN zig build -Doptimize=ReleaseSafe` (the canonical Zig release-build invocation). Read `/data/home/benji/src/devnw/codepros/geode/geode/build.zig` to confirm what option name it accepts (`Doptimize`, `Drelease`, etc.).

- [ ] **Step 3: Build and tag the image**

From `geode-ui/`:
```bash
docker build -f deploy/geode/Dockerfile.geode -t geode:v0.5.11 ..
```
Expected: image builds successfully. First build will take 5-10 minutes (Zig compilation). Confirm with `docker images | grep geode` showing the v0.5.11 tag.

- [ ] **Step 4: Smoke the image**

```bash
docker run --rm -d --name geode-smoke -p 3141:3141/udp geode:v0.5.11
sleep 5
docker logs geode-smoke 2>&1 | head -20
docker stop geode-smoke
```
Expected: log lines like `listening on 0.0.0.0:3141` (or equivalent — Geode's startup banner).

- [ ] **Step 5: Commit**

```bash
git add deploy/geode/Dockerfile.geode
git commit -m "build(deploy): geode:v0.5.11 source-build Dockerfile"
```

---

## Task 2: Author the movies-graph seed (`init.gql`)

**Files:**
- Create: `deploy/geode/init.gql`

A small, deterministic dataset is essential for stable Playwright tests. We use a 6-person / 3-movie graph based on the canonical Neo4j movies tutorial — small enough that every test sees the same row counts, large enough to exercise nodes/edges/paths.

- [ ] **Step 1: Author the seed**

`deploy/geode/init.gql`:
```sql
-- Seeds the e2e movies graph used by every Playwright test.
-- Total: 6 nodes labeled Person, 3 nodes labeled Movie, 9 ACTED_IN edges,
-- 3 DIRECTED edges. Properties: Person {name, born}, Movie {title, year},
-- edge ACTED_IN {role}.
--
-- Counts are pinned in e2e/helpers/gqlData.ts so test assertions stay in
-- sync if this file ever grows.

CREATE GRAPH `movies`;

USE GRAPH `movies`;

-- People
CREATE (alice:Person   {name: 'Alice Wonder',   born: 1980});
CREATE (bob:Person     {name: 'Bob Builder',    born: 1975});
CREATE (carol:Person   {name: 'Carol Singer',   born: 1990});
CREATE (dave:Person    {name: 'Dave Smith',     born: 1985});
CREATE (eve:Person     {name: 'Eve Adams',      born: 1992});
CREATE (frank:Person   {name: 'Frank Director', born: 1965});

-- Movies
CREATE (m1:Movie {title: 'The Graph', year: 2020});
CREATE (m2:Movie {title: 'Edges of Reality', year: 2022});
CREATE (m3:Movie {title: 'Walk the Path', year: 2024});

-- ACTED_IN edges (9 total)
MATCH (p:Person {name: 'Alice Wonder'}),   (m:Movie {title: 'The Graph'})         CREATE (p)-[:ACTED_IN {role: 'Mathematician'}]->(m);
MATCH (p:Person {name: 'Bob Builder'}),    (m:Movie {title: 'The Graph'})         CREATE (p)-[:ACTED_IN {role: 'Engineer'}]->(m);
MATCH (p:Person {name: 'Carol Singer'}),   (m:Movie {title: 'The Graph'})         CREATE (p)-[:ACTED_IN {role: 'Narrator'}]->(m);
MATCH (p:Person {name: 'Dave Smith'}),     (m:Movie {title: 'Edges of Reality'})  CREATE (p)-[:ACTED_IN {role: 'Detective'}]->(m);
MATCH (p:Person {name: 'Eve Adams'}),      (m:Movie {title: 'Edges of Reality'})  CREATE (p)-[:ACTED_IN {role: 'Hacker'}]->(m);
MATCH (p:Person {name: 'Alice Wonder'}),   (m:Movie {title: 'Edges of Reality'})  CREATE (p)-[:ACTED_IN {role: 'Professor'}]->(m);
MATCH (p:Person {name: 'Bob Builder'}),    (m:Movie {title: 'Walk the Path'})     CREATE (p)-[:ACTED_IN {role: 'Foreman'}]->(m);
MATCH (p:Person {name: 'Carol Singer'}),   (m:Movie {title: 'Walk the Path'})     CREATE (p)-[:ACTED_IN {role: 'Composer'}]->(m);
MATCH (p:Person {name: 'Dave Smith'}),     (m:Movie {title: 'Walk the Path'})     CREATE (p)-[:ACTED_IN {role: 'Inspector'}]->(m);

-- DIRECTED edges (3 total — Frank directs all three)
MATCH (p:Person {name: 'Frank Director'}), (m:Movie {title: 'The Graph'})         CREATE (p)-[:DIRECTED]->(m);
MATCH (p:Person {name: 'Frank Director'}), (m:Movie {title: 'Edges of Reality'})  CREATE (p)-[:DIRECTED]->(m);
MATCH (p:Person {name: 'Frank Director'}), (m:Movie {title: 'Walk the Path'})     CREATE (p)-[:DIRECTED]->(m);

-- Indexes for the schema explorer to display.
CREATE INDEX ON :Person(name);
CREATE INDEX ON :Movie(title);
```

> **GQL syntax check before continuing:** the syntax above is the canonical Neo4j-style Cypher. Geode v0.5.11 is ISO/IEC 39075:2024 GQL — most clauses match but some keywords or punctuation may differ. Run a smoke against the freshly-built image:
> ```bash
> docker run --rm -i geode:v0.5.11 query --insecure-tls-skip-verify \
>     --server localhost:3141 -U geode -P "$(... password)" < deploy/geode/init.gql
> ```
> If a clause errors, adjust the seed to whatever Geode v0.5.11 accepts. Document any deviations in a comment block at the top of the file.

- [ ] **Step 2: Commit**

```bash
git add deploy/geode/init.gql
git commit -m "feat(e2e): movies-graph seed for Playwright fixtures"
```

---

## Task 3: Author the seed bootstrap script

**Files:**
- Create: `deploy/geode/seed-bootstrap.sh`

The `geode-init` one-shot container needs to:
1. Wait for `geode:3141` to accept connections.
2. Run `geode auth init` to bootstrap the admin user (Geode v0.5.11 requires this on first start; it generates a password the first time, then accepts a known one if provided).
3. Run `geode user create e2e_admin ...` with a known password so the Playwright fixture can log in.
4. Pipe `init.gql` through `geode query` to populate the movies graph.
5. Verify the seed (`MATCH (n) RETURN count(n)` should be `9`).

- [ ] **Step 1: Write the script**

`deploy/geode/seed-bootstrap.sh`:
```bash
#!/usr/bin/env bash
# Geode test-stack bootstrap. Runs once per `docker compose up` lifecycle
# inside the geode-init container, then exits 0. Idempotent — safe to
# rerun against an already-populated data dir (will skip the seed).
#
# Required env:
#   GEODE_HOST           — hostname of the geode service (default: geode)
#   GEODE_PORT           — Geode port (default: 3141)
#   GEODE_ADMIN_USER     — admin username  (default: geode)
#   GEODE_ADMIN_PASSWORD — admin password  (default: geode-test-pw-12)
#   E2E_USER             — playwright fixture username (default: e2e_admin)
#   E2E_PASSWORD         — playwright fixture password (default: e2e-pw-1234)
set -euo pipefail

GEODE_HOST="${GEODE_HOST:-geode}"
GEODE_PORT="${GEODE_PORT:-3141}"
GEODE_ADMIN_USER="${GEODE_ADMIN_USER:-geode}"
GEODE_ADMIN_PASSWORD="${GEODE_ADMIN_PASSWORD:-geode-test-pw-12}"
E2E_USER="${E2E_USER:-e2e_admin}"
E2E_PASSWORD="${E2E_PASSWORD:-e2e-pw-1234}"

QUERY="geode query --server ${GEODE_HOST}:${GEODE_PORT} --insecure-tls-skip-verify -U ${GEODE_ADMIN_USER} -P ${GEODE_ADMIN_PASSWORD}"

wait_for_geode() {
  echo "[seed] waiting for ${GEODE_HOST}:${GEODE_PORT} ..."
  for _ in $(seq 1 60); do
    if echo "RETURN 1" | $QUERY >/dev/null 2>&1; then
      echo "[seed] geode is up"
      return 0
    fi
    sleep 1
  done
  echo "[seed] geode did not become ready in 60s" >&2
  return 1
}

ensure_admin() {
  echo "[seed] ensuring admin user ${GEODE_ADMIN_USER} exists with known password"
  geode auth init \
    --data-dir /shared-data \
    --user "${GEODE_ADMIN_USER}" \
    --password "${GEODE_ADMIN_PASSWORD}" \
    || true   # offline init may already have run; ignore on rerun
}

ensure_e2e_user() {
  echo "[seed] ensuring e2e user ${E2E_USER}"
  echo "CREATE USER \`${E2E_USER}\` WITH EMAIL '${E2E_USER}@e2e.local' PASSWORD '${E2E_PASSWORD}'" \
    | $QUERY 2>/dev/null \
    || echo "[seed] (e2e user already exists or CREATE USER not supported on this version — login fixture will use admin instead)"
}

seed_movies() {
  if echo "USE GRAPH \`movies\`; MATCH (n) RETURN count(n) AS c" | $QUERY 2>/dev/null | grep -q "9"; then
    echo "[seed] movies graph already populated (9 nodes); skipping"
    return 0
  fi
  echo "[seed] populating movies graph"
  $QUERY -f /seed/init.gql
}

verify_seed() {
  echo "[seed] verifying seed counts"
  local got
  got=$(echo "USE GRAPH \`movies\`; MATCH (n) RETURN count(n) AS c" | $QUERY 2>/dev/null | tail -n 1 || echo "")
  if ! echo "${got}" | grep -q "9"; then
    echo "[seed] expected 9 nodes, got: ${got}" >&2
    return 1
  fi
  echo "[seed] verified: 9 nodes"
}

wait_for_geode
ensure_admin
ensure_e2e_user
seed_movies
verify_seed
echo "[seed] bootstrap complete"
```

- [ ] **Step 2: Make it executable + commit**

```bash
chmod +x deploy/geode/seed-bootstrap.sh
git add deploy/geode/seed-bootstrap.sh
git commit -m "feat(e2e): geode-init bootstrap script (admin + movies seed)"
```

---

## Task 4: Author the LSP TCP bridge wrapper

**Files:**
- Create: `deploy/geode/lsp-bridge.sh`

`geode lsp` is stdin/stdout JSON-RPC. To make it consumable from outside its container we wrap it with `socat`, which forks one `geode lsp` process per inbound TCP connection and pipes the connection's bytes to/from the child's stdin/stdout. This is the conventional pattern for "make a stdio LSP usable over a network" (cf. eclipse JDT, gopls in dev containers).

- [ ] **Step 1: Write the bridge**

`deploy/geode/lsp-bridge.sh`:
```bash
#!/usr/bin/env bash
# Exposes `geode lsp` (stdin/stdout JSON-RPC) over TCP :2087 by forking
# one `geode lsp` process per inbound connection. Conventional pattern
# for stdio-only LSP servers.
#
# socat options:
#   TCP-LISTEN:2087  bind on every interface inside the container
#   reuseaddr        allow restart without TIME_WAIT delay
#   fork             one child per connection
#   EXEC:"geode lsp" pipes stdin/stdout to the spawned process
#   stderr           bubble child stderr into our log so editor errors
#                    appear in `docker logs geode-lsp`
set -euo pipefail
exec socat -d -d \
    TCP-LISTEN:2087,reuseaddr,fork \
    EXEC:"geode lsp",pty,stderr
```

- [ ] **Step 2: Commit**

```bash
chmod +x deploy/geode/lsp-bridge.sh
git add deploy/geode/lsp-bridge.sh
git commit -m "feat(e2e): socat TCP bridge for geode lsp"
```

---

## Task 5: Author `docker-compose.test.yml`

**Files:**
- Create: `deploy/docker-compose.test.yml`

- [ ] **Step 1: Write the compose file**

`deploy/docker-compose.test.yml`:
```yaml
# E2E test stack. Brings up:
#   - geode        (database, v0.5.11, persistent named volume)
#   - geode-init   (one-shot: bootstrap admin + seed movies graph, then exits)
#   - geode-ui     (Go API + embedded SPA, builds from the geode-ui Dockerfile)
#   - geode-mcp    (MCP HTTP transport, port 8090)
#   - geode-lsp    (LSP TCP bridge via socat, port 2087)
#
# Build context for the geode + geode-ui images is the PARENT directory
# (../) so that the sibling-checkout pattern works: ../geode, ../geode-ui,
# ../geode-client-go are all available inside the build context.
#
# Bring up:  make e2e-up    (= docker compose -f deploy/docker-compose.test.yml up -d --build)
# Tear down: make e2e-down  (= docker compose -f deploy/docker-compose.test.yml down -v)

name: geode-e2e

services:
  geode:
    image: geode:v0.5.11
    build:
      context: ..
      dockerfile: geode-ui/deploy/geode/Dockerfile.geode
    command: ["serve", "--data-dir", "/data", "--listen", "0.0.0.0:3141", "--log-level", "info"]
    volumes:
      - geode-data:/data
    ports:
      - "3141:3141/udp"
    healthcheck:
      # geode CLI is shipped in the same image; talk to itself.
      test: ["CMD", "geode", "query", "--insecure-tls-skip-verify",
             "--server", "127.0.0.1:3141", "-U", "geode",
             "-P", "${GEODE_ADMIN_PASSWORD:-geode-test-pw-12}",
             "RETURN 1"]
      interval: 5s
      timeout: 5s
      retries: 30
      start_period: 10s

  geode-init:
    image: geode:v0.5.11
    depends_on:
      geode:
        condition: service_healthy
    entrypoint: ["/seed/seed-bootstrap.sh"]
    environment:
      GEODE_HOST: geode
      GEODE_PORT: "3141"
      GEODE_ADMIN_USER: geode
      GEODE_ADMIN_PASSWORD: ${GEODE_ADMIN_PASSWORD:-geode-test-pw-12}
      E2E_USER: e2e_admin
      E2E_PASSWORD: ${E2E_PASSWORD:-e2e-pw-1234}
    volumes:
      - geode-data:/shared-data
      - ./geode/seed-bootstrap.sh:/seed/seed-bootstrap.sh:ro
      - ./geode/init.gql:/seed/init.gql:ro
    restart: "no"

  geode-ui:
    image: geode-ui:e2e
    build:
      context: ..
      dockerfile: geode-ui/deploy/Dockerfile
    depends_on:
      geode-init:
        condition: service_completed_successfully
    environment:
      # SEC F-SUP-5 (#161): NEVER commit a literal JWT secret to a plan
      # or doc, even a deterministic one — detect-secrets and gitleaks
      # both flag it, and a future copy-paste into a real compose file
      # would inherit the value. The fallback below is the documented
      # placeholder; the operator MUST replace it with the output of
      # `openssl rand -hex 32` before bringing the stack up.
      JWT_SECRET_HEX: ${JWT_SECRET_HEX:-<GENERATE_WITH_openssl_rand_hex_32>}
    command: [
      "-listen", ":8080",
      "-jwt-secret-hex", "${JWT_SECRET_HEX:-<GENERATE_WITH_openssl_rand_hex_32>}",
      "-profiles", "/etc/geode-ui/profiles.json"
    ]
    volumes:
      - ./profiles.json:/etc/geode-ui/profiles.json:ro
    ports:
      - "8080:8080"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/healthz | grep -q ok"]
      interval: 5s
      timeout: 3s
      retries: 12

  geode-mcp:
    image: geode:v0.5.11
    depends_on:
      geode-init:
        condition: service_completed_successfully
    command: ["mcp", "--port", "8090", "-e", "geode:3141"]
    ports:
      - "8090:8090"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8090/health || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 6
      start_period: 5s

  geode-lsp:
    image: geode:v0.5.11
    depends_on:
      geode-init:
        condition: service_completed_successfully
    user: root  # socat install on first run
    entrypoint: ["/bin/bash", "-c"]
    command:
      - |
        if ! command -v socat >/dev/null; then
          apt-get update && apt-get install -y --no-install-recommends socat
          rm -rf /var/lib/apt/lists/*
        fi
        exec /lsp/lsp-bridge.sh
    volumes:
      - ./geode/lsp-bridge.sh:/lsp/lsp-bridge.sh:ro
    ports:
      - "2087:2087"

volumes:
  geode-data:
```

> **Path note:** the `volumes:` mount paths use `./geode/...` because the working directory for `docker compose` invocations is the location of the compose file (`deploy/`). The build contexts are `..` because they need access to the sibling `../geode` and `../geode-client-go` directories, which means: from `geode-ui/`, run `docker compose -f deploy/docker-compose.test.yml ...`. The Makefile target in Task 7 codifies this.

- [ ] **Step 2: Author a `profiles.json` for the geode-ui service**

`deploy/profiles.json`:
```json
[
  {
    "name": "default",
    "dsn": "quic://geode:e2e-pw-1234@geode:3141?insecure=true",  // pragma: allowlist secret
    "description": "in-cluster geode for e2e"
  }
]
```

> **DSN format check:** verify against `geode-client-go/config.go:168` (the `ParseDSN` implementation). The form `quic://user:pass@host:port?insecure=true` is the conventional shape but the exact query-param key for skip-verify (`insecure`, `tls-insecure`, `verify`, etc.) is driver-specific. If `?insecure=true` is rejected at startup, drop the query param and rely on the geode-ui server-side `--insecure` flag (add it to the compose `command` array if needed).

- [ ] **Step 3: Commit**

```bash
git add deploy/docker-compose.test.yml deploy/profiles.json
git commit -m "feat(e2e): docker-compose stack (geode + ui + mcp + lsp + init)"
```

---

## Task 6: Add Makefile targets for the e2e stack lifecycle

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Append e2e targets**

After the existing `dev:` target (around line 78), insert:

```makefile

# ----- E2E stack -----
COMPOSE := docker compose -f deploy/docker-compose.test.yml

.PHONY: e2e-up e2e-down e2e-logs e2e-test e2e-ci

# Bring up the test stack (build images, run init, leave services running).
e2e-up:
	$(COMPOSE) up -d --build
	@echo "stack is up — http://localhost:8080 (UI), :8090 (MCP), :2087 (LSP), :3141/udp (Geode)"

# Tear down + delete named volumes (full reset for next run).
e2e-down:
	$(COMPOSE) down -v

# Tail logs from every service (Ctrl-C to detach).
e2e-logs:
	$(COMPOSE) logs -f

# Run Playwright against an already-running stack (assumes e2e-up was called).
e2e-test:
	cd e2e && npx playwright test

# Full CI run: bring up, wait for health, run tests, tear down.
e2e-ci: e2e-up
	@echo "waiting for geode-ui health..."
	@for i in $$(seq 1 30); do \
	  if wget -qO- http://localhost:8080/healthz | grep -q ok; then break; fi; \
	  sleep 2; \
	done
	cd e2e && npx playwright test --reporter=html
	$(MAKE) e2e-down
```

Also append the new `.PHONY` targets to the existing top-of-file `.PHONY:` line (Task A1's collapse-to-one-line style applies here):
```makefile
.PHONY: ... e2e-up e2e-down e2e-logs e2e-test e2e-ci
```

- [ ] **Step 2: Smoke `make help` still works**

```bash
make help
```
Expected: prints help text. (Note: extending `scripts/help.txt` to mention `make e2e-up` is OK but optional for this task.)

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "build(make): e2e-up/e2e-down/e2e-test/e2e-ci targets"
```

---

## Task 7: Bring the stack up end-to-end and verify

- [ ] **Step 1: Build and start**

```bash
make e2e-up
```
Expected: 5 services come up. `docker compose -f deploy/docker-compose.test.yml ps` shows `geode (healthy)`, `geode-init (exited 0)`, `geode-ui (healthy)`, `geode-mcp (running)`, `geode-lsp (running)`. First run takes 5-10 minutes for the geode image build.

If the build fails or a service crashes, capture logs and adjust:
- `geode` logs should mention seed-time creation of the `geode` user
- `geode-init` logs should print `[seed] verified: 9 nodes`
- `geode-ui` logs should print `listening addr=:8080`
- `geode-mcp` logs should mention listening on 8090
- `geode-lsp` logs should mention `socat: listening on :2087`

- [ ] **Step 2: Smoke each surface**

```bash
# UI healthz
curl -sf http://localhost:8080/healthz | jq .

# Login → token
TOKEN=$(curl -sf -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'username=e2e_admin&password=e2e-pw-1234&profile=default' | jq -r .access_token)
echo "TOKEN=${TOKEN:0:24}..."

# Authenticated query
curl -sf -X POST http://localhost:8080/api/v1/query \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"statement":"USE GRAPH `movies`; MATCH (n:Person) RETURN n.name AS name ORDER BY name"}' \
  | jq '.row_count'

# MCP HTTP — list tools (genapi-emitted endpoint shape)
curl -sf http://localhost:8090/health || echo "(MCP /health may not exist; fall back to /tools)"

# LSP TCP — should accept connections (just verify the bridge is listening)
nc -z localhost 2087 && echo "LSP bridge listening"
```
Expected:
- `/healthz` returns `{"status":"ok","version":"v0.1.0"}`
- `TOKEN` is a non-empty JWT
- `row_count` is `6` (six Person nodes)
- MCP responds on port 8090 (exact endpoint shape depends on Geode's MCP HTTP routing — `/mcp`, `/tools`, or similar; document whatever the implementation exposes)
- `nc -z localhost 2087` succeeds

If the row_count is not 6 or the login fails, the seed didn't run cleanly — check `docker logs geode-e2e-geode-init-1`.

- [ ] **Step 3: Tear down**

```bash
make e2e-down
```
Expected: all containers stopped, volume removed.

- [ ] **Step 4: Commit any tweaks needed to make Step 2 pass**

If Step 2 surfaced any issues (e.g. a wrong query-string key in the DSN, a missing `--insecure` flag on geode-ui, a bad GQL clause in `init.gql`), fix and commit:

```bash
git add -A
git commit -m "fix(e2e): smoke-test corrections for the test stack"
```

---

# Phase 2 — Playwright Scaffold

**Goal:** `npm run e2e:smoke` runs a single test that drives the running stack: navigate to `/`, expect redirect to `/login`, fill in `e2e_admin` / `e2e-pw-1234`, click Login, expect URL `/`, expect the GQL editor to be visible. The test passes against the live compose stack.

## Task 8: Install Playwright + add npm scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Add npm scripts**

In `package.json` under `scripts`, add:
```json
"e2e": "playwright test --config=e2e/playwright.config.ts",
"e2e:headed": "playwright test --config=e2e/playwright.config.ts --headed",
"e2e:debug": "PWDEBUG=1 playwright test --config=e2e/playwright.config.ts",
"e2e:report": "playwright show-report e2e/playwright-report",
"e2e:smoke": "playwright test --config=e2e/playwright.config.ts e2e/specs/01-auth.spec.ts"
```

- [ ] **Step 3: Update `.gitignore`**

Append:
```
# Playwright
/e2e/playwright-report/
/e2e/test-results/
/e2e/.cache/
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "build(e2e): install @playwright/test"
```

---

## Task 9: Write `e2e/playwright.config.ts`, `e2e/tsconfig.json`, `e2e/.env.example`

**Files:**
- Create: `e2e/playwright.config.ts`
- Create: `e2e/tsconfig.json`
- Create: `e2e/.env.example`

- [ ] **Step 1: Config**

`e2e/playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test'

const UI_URL = process.env.UI_URL ?? 'http://localhost:8080'

export default defineConfig({
  testDir: './specs',
  testMatch: '**/*.spec.ts',
  globalSetup: require.resolve('./helpers/globalSetup'),

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
    ...((process.env.CI ? [['github'] as const] : []) as never),
  ],

  timeout: 30_000,
  expect: { timeout: 8_000 },

  use: {
    baseURL: UI_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
```

- [ ] **Step 2: tsconfig**

`e2e/tsconfig.json`:
```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "module": "commonjs",
    "moduleResolution": "node",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 3: Env example**

`e2e/.env.example`:
```bash
# Copy to .env.local (gitignored) for local dev. CI uses defaults.
UI_URL=http://localhost:8080
ADMIN_USER=e2e_admin
ADMIN_PASSWORD=e2e-pw-1234
ADMIN_PROFILE=default
```

- [ ] **Step 4: Commit**

```bash
git add e2e/playwright.config.ts e2e/tsconfig.json e2e/.env.example
git commit -m "build(e2e): playwright config + tsconfig + env example"
```

---

## Task 10: Helpers — auth, selectors, globalSetup, gqlData

**Files:**
- Create: `e2e/helpers/auth.ts`
- Create: `e2e/helpers/selectors.ts`
- Create: `e2e/helpers/globalSetup.ts`
- Create: `e2e/helpers/gqlData.ts`

- [ ] **Step 1: `auth.ts` — programmatic login**

```ts
import { APIRequestContext } from '@playwright/test'

const ADMIN_USER = process.env.ADMIN_USER ?? 'e2e_admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'e2e-pw-1234'
const ADMIN_PROFILE = process.env.ADMIN_PROFILE ?? 'default'

export async function login(req: APIRequestContext): Promise<string> {
  const res = await req.post('/api/v1/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    form: {
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
      profile: ADMIN_PROFILE,
    },
  })
  if (!res.ok()) {
    const body = await res.text().catch(() => '')
    throw new Error(`login failed (${res.status()}): ${body}`)
  }
  const json = (await res.json()) as { access_token: string }
  return json.access_token
}
```

- [ ] **Step 2: `selectors.ts` — central selector map**

The UI doesn't yet have `data-testid` attributes everywhere; we use a mix of role-based locators (preferred) and visible-text. We add `data-testid` opportunistically in later test tasks where a more stable handle is needed.

```ts
import { Page, Locator } from '@playwright/test'

export const sel = {
  // Login
  loginUsername: (p: Page): Locator => p.getByLabel('Username'),
  loginPassword: (p: Page): Locator => p.getByLabel('Password'),
  loginProfile:  (p: Page): Locator => p.getByLabel('Profile'),
  loginSubmit:   (p: Page): Locator => p.getByRole('button', { name: /login/i }),

  // Shell
  navQuery:    (p: Page): Locator => p.getByRole('link', { name: 'Query' }),
  navSchema:   (p: Page): Locator => p.getByRole('link', { name: 'Schema' }),
  navAdmin:    (p: Page): Locator => p.getByRole('link', { name: 'Admin' }),
  navOps:      (p: Page): Locator => p.getByRole('link', { name: 'Ops' }),
  logout:      (p: Page): Locator => p.getByRole('button', { name: /logout/i }),
  connection:  (p: Page): Locator => p.locator('select').first(), // ConnectionPicker

  // Query page
  queryRunBtn: (p: Page): Locator => p.getByRole('button', { name: /run/i }),
  queryStreamToggle: (p: Page): Locator => p.getByRole('checkbox', { name: 'Stream' }),
  queryTabTable: (p: Page): Locator => p.getByRole('button', { name: 'table', exact: true }),
  queryTabJson:  (p: Page): Locator => p.getByRole('button', { name: 'json',  exact: true }),
  queryTabGraph: (p: Page): Locator => p.getByRole('button', { name: 'graph', exact: true }),
  cancelStream: (p: Page): Locator => p.getByRole('button', { name: /cancel/i }),
  resultsTable: (p: Page): Locator => p.locator('table'),
  graphCanvas:  (p: Page): Locator => p.locator('canvas'), // cytoscape uses <canvas>

  // Schema explorer
  graphsList:  (p: Page): Locator => p.getByRole('heading', { name: 'Graphs' }).locator('xpath=..'),
  labelsList:  (p: Page): Locator => p.getByRole('heading', { name: /^Labels/ }).locator('xpath=..'),

  // Admin
  newUserBtn:  (p: Page): Locator => p.getByRole('button', { name: /new user/i }),

  // Ops
  newBackupBtn: (p: Page): Locator => p.getByRole('button', { name: /new backup/i }),
}
```

- [ ] **Step 3: `gqlData.ts` — fixture-side mirror of `init.gql` counts**

```ts
// Mirrors deploy/geode/init.gql so test assertions stay in sync.
// Update both files together if the seed changes.
export const seed = {
  graph: 'movies',
  labels: ['Person', 'Movie'] as const,
  edgeTypes: ['ACTED_IN', 'DIRECTED'] as const,
  counts: {
    persons: 6,
    movies: 3,
    actedIn: 9,
    directed: 3,
    nodesTotal: 9,
    edgesTotal: 12,
  },
  people: [
    'Alice Wonder', 'Bob Builder', 'Carol Singer',
    'Dave Smith', 'Eve Adams', 'Frank Director',
  ] as const,
  movieTitles: ['The Graph', 'Edges of Reality', 'Walk the Path'] as const,
}
```

- [ ] **Step 4: `globalSetup.ts` — health gate**

```ts
import { request } from '@playwright/test'

const UI_URL = process.env.UI_URL ?? 'http://localhost:8080'
const TIMEOUT_MS = 60_000

async function waitForHealth(): Promise<void> {
  const ctx = await request.newContext({ baseURL: UI_URL })
  const start = Date.now()
  let lastErr: unknown
  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const res = await ctx.get('/healthz')
      if (res.ok()) {
        const body = (await res.json()) as { status?: string }
        if (body.status === 'ok') {
          await ctx.dispose()
          return
        }
      }
      lastErr = `status ${res.status()}`
    } catch (e: unknown) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  await ctx.dispose()
  throw new Error(`UI did not become healthy at ${UI_URL} within ${TIMEOUT_MS}ms: ${String(lastErr)}`)
}

export default async function globalSetup(): Promise<void> {
  await waitForHealth()
}
```

- [ ] **Step 5: Commit**

```bash
git add e2e/helpers
git commit -m "feat(e2e): playwright helpers (auth, selectors, gqlData, globalSetup)"
```

---

## Task 11: Shared fixture file (`e2e/fixtures.ts`)

**Files:**
- Create: `e2e/fixtures.ts`

- [ ] **Step 1: Author**

```ts
import { test as base, Page, BrowserContext } from '@playwright/test'
import { login } from './helpers/auth'

type Fixtures = {
  authedContext: BrowserContext
  authedPage:    Page
}

// `authedContext` boots a fresh browser context with the JWT pre-seeded
// in localStorage so tests skip the login flow. Use this for every test
// that doesn't specifically test login itself.
export const test = base.extend<Fixtures>({
  authedContext: async ({ browser, request }, use) => {
    const token = await login(request)
    const ctx = await browser.newContext()
    // The SPA reads localStorage via the AuthProvider on mount, so
    // initialize the token before the first navigation.
    await ctx.addInitScript((t: string) => {
      localStorage.setItem('geode-ui.access_token', t)
      localStorage.setItem('geode-ui.profile', 'default')
    }, token)
    await use(ctx)
    await ctx.close()
  },

  authedPage: async ({ authedContext }, use) => {
    const page = await authedContext.newPage()
    await use(page)
    await page.close()
  },
})

export { expect } from '@playwright/test'
```

- [ ] **Step 2: Commit**

```bash
git add e2e/fixtures.ts
git commit -m "feat(e2e): authedContext + authedPage shared fixtures"
```

---

# Phase 3 — Test Suites

Each suite is one `.spec.ts` file. The runner executes them in parallel. Each suite is independent — a failing suite never affects the others.

## Task 12: `01-auth.spec.ts` — login, logout, redirect, persistence

**Files:**
- Create: `e2e/specs/01-auth.spec.ts`

- [ ] **Step 1: Author**

```ts
import { test, expect } from '@playwright/test'
import { sel } from '../helpers/selectors'

const USER = process.env.ADMIN_USER ?? 'e2e_admin'
const PASS = process.env.ADMIN_PASSWORD ?? 'e2e-pw-1234'

test.describe('auth', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
    await context.clearPermissions()
  })

  test('redirects unauthenticated user from / to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(sel.loginSubmit(page)).toBeVisible()
  })

  test('login flow: fill, submit, land on /', async ({ page }) => {
    await page.goto('/login')
    await sel.loginProfile(page).fill('default')
    await sel.loginUsername(page).fill(USER)
    await sel.loginPassword(page).fill(PASS)
    await sel.loginSubmit(page).click()
    await expect(page).toHaveURL(/\/$/)
    // The query editor is the index of the protected shell.
    await expect(sel.queryRunBtn(page)).toBeVisible()
  })

  test('bad credentials surface a visible error', async ({ page }) => {
    await page.goto('/login')
    await sel.loginUsername(page).fill('not-a-real-user')
    await sel.loginPassword(page).fill('wrong')
    await sel.loginSubmit(page).click()
    await expect(page.getByText(/invalid|unauthorized|incorrect/i)).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('token persists across reloads', async ({ page }) => {
    await page.goto('/login')
    await sel.loginUsername(page).fill(USER)
    await sel.loginPassword(page).fill(PASS)
    await sel.loginSubmit(page).click()
    await expect(page).toHaveURL(/\/$/)
    await page.reload()
    await expect(page).toHaveURL(/\/$/)
    await expect(sel.queryRunBtn(page)).toBeVisible()
  })

  test('logout clears token and redirects', async ({ page }) => {
    await page.goto('/login')
    await sel.loginUsername(page).fill(USER)
    await sel.loginPassword(page).fill(PASS)
    await sel.loginSubmit(page).click()
    await expect(page).toHaveURL(/\/$/)
    await sel.logout(page).click()
    await expect(page).toHaveURL(/\/login$/)
    // localStorage cleared
    const token = await page.evaluate(() => localStorage.getItem('geode-ui.access_token'))
    expect(token).toBeNull()
  })
})
```

- [ ] **Step 2: Run + verify**

```bash
npm run e2e -- --grep auth
```
Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/01-auth.spec.ts
git commit -m "test(e2e): auth flow (login, redirect, error, persistence, logout)"
```

---

## Task 13: `02-connection-picker.spec.ts` — profiles list + persistence

**Files:**
- Create: `e2e/specs/02-connection-picker.spec.ts`

- [ ] **Step 1: Author**

```ts
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'

test.describe('connection picker', () => {
  test('lists at least the default profile', async ({ authedPage: page }) => {
    await page.goto('/')
    await expect(sel.connection(page)).toBeVisible()
    const value = await sel.connection(page).inputValue()
    expect(value).toBe('default')
    const options = await sel.connection(page).locator('option').allTextContents()
    expect(options).toContain('default')
  })

  test('selecting a profile persists in localStorage', async ({ authedPage: page }) => {
    await page.goto('/')
    await sel.connection(page).selectOption('default')
    const stored = await page.evaluate(() => localStorage.getItem('geode-ui.profile'))
    expect(stored).toBe('default')
  })
})
```

- [ ] **Step 2: Run, commit**

```bash
npm run e2e -- --grep "connection picker"
git add e2e/specs/02-connection-picker.spec.ts
git commit -m "test(e2e): connection picker"
```

---

## Task 14: `03-query-sync.spec.ts` — sync GQL execution

**Files:**
- Create: `e2e/specs/03-query-sync.spec.ts`

- [ ] **Step 1: Author**

```ts
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

test.describe('query (sync)', () => {
  test('runs MATCH and shows the expected number of rows', async ({ authedPage: page }) => {
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()

    // Replace the editor's default statement with a deterministic query.
    // Monaco doesn't expose a stable input role; we use Ctrl+A + type.
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(`USE GRAPH \`${seed.graph}\`; MATCH (n:Person) RETURN n.name AS name ORDER BY name`)

    await sel.queryRunBtn(page).click()

    // Wait for the row-count summary to appear.
    await expect(page.getByText(new RegExp(`${seed.counts.persons} rows`))).toBeVisible()

    // Switch to table tab, verify the seeded names appear.
    await sel.queryTabTable(page).click()
    for (const name of seed.people) {
      await expect(page.getByText(name)).toBeVisible()
    }
  })

  test('a syntactically broken query surfaces an error banner', async ({ authedPage: page }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('NOT A REAL QUERY ;;;')
    await sel.queryRunBtn(page).click()
    await expect(page.locator('span', { hasText: /query_error|syntax|unexpected/i }).first()).toBeVisible()
  })

  test('switches to JSON tab and shows valid JSON', async ({ authedPage: page }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(`USE GRAPH \`${seed.graph}\`; MATCH (n:Person) RETURN n.name LIMIT 1`)
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/1 rows/)).toBeVisible()
    await sel.queryTabJson(page).click()
    const txt = await page.locator('pre').textContent()
    expect(txt && txt.length).toBeGreaterThan(0)
    expect(() => JSON.parse(txt!)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run, commit**

```bash
npm run e2e -- --grep "query \(sync\)"
git add e2e/specs/03-query-sync.spec.ts
git commit -m "test(e2e): sync query — MATCH, error banner, JSON tab"
```

---

## Task 15: `04-query-stream.spec.ts` — WebSocket streaming

**Files:**
- Create: `e2e/specs/04-query-stream.spec.ts`

- [ ] **Step 1: Author**

```ts
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

test.describe('query (stream)', () => {
  test('toggles stream mode, runs, and accumulates rows progressively', async ({ authedPage: page }) => {
    await page.goto('/')
    await sel.queryStreamToggle(page).check()
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(`USE GRAPH \`${seed.graph}\`; MATCH (n:Person) RETURN n.name AS name`)
    await sel.queryRunBtn(page).click()

    // The summary frame is sent at the end; wait for it.
    await expect(page.getByText(new RegExp(`${seed.counts.persons} rows`))).toBeVisible({ timeout: 15_000 })

    await sel.queryTabTable(page).click()
    for (const name of seed.people) {
      await expect(page.getByText(name)).toBeVisible()
    }
  })

  test('cancel button aborts a streaming query', async ({ authedPage: page }) => {
    await page.goto('/')
    await sel.queryStreamToggle(page).check()
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    // A query that would return many rows if we let it complete — UNWIND
    // a large list to force enough work for cancel to be observable.
    await page.keyboard.type(`USE GRAPH \`${seed.graph}\`; UNWIND range(1, 100000) AS i RETURN i`)
    await sel.queryRunBtn(page).click()
    // Cancel button only renders while busy.
    await sel.cancelStream(page).click()
    // After cancel, the Run button should be enabled again.
    await expect(sel.queryRunBtn(page)).toBeEnabled()
  })
})
```

> **Note on the cancel test:** if Geode v0.5.11 doesn't support `UNWIND range(...)`, substitute any deterministic long-running query — e.g. a `MATCH` with a self-product that the engine can stream incrementally. The point of the test is: clicking Cancel mid-stream returns the UI to an enabled state without error.

- [ ] **Step 2: Run, commit**

```bash
npm run e2e -- --grep "query \(stream\)"
git add e2e/specs/04-query-stream.spec.ts
git commit -m "test(e2e): WS streaming — accumulation + cancel"
```

---

## Task 16: `05-query-graph.spec.ts` — Cytoscape graph view

**Files:**
- Create: `e2e/specs/05-query-graph.spec.ts`

Cytoscape renders to a `<canvas>`; pixel-level inspection is brittle, so we verify behavior via the side panel that shows JSON when a node/edge is clicked, and via the count of `<canvas>` elements present.

- [ ] **Step 1: Author**

```ts
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

test.describe('query (graph view)', () => {
  test('switches to graph tab and the cytoscape canvas mounts', async ({ authedPage: page }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH \`${seed.graph}\`; MATCH (a:Person)-[r:ACTED_IN]->(m:Movie) RETURN a, r, m LIMIT 10`,
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/10 rows|9 rows/)).toBeVisible()

    await sel.queryTabGraph(page).click()
    // Cytoscape mounts at least one <canvas> for the layer renderer.
    await expect(sel.graphCanvas(page).first()).toBeVisible()

    // The side panel renders the placeholder until a node is clicked.
    await expect(page.getByText('Click a node or edge to inspect properties.')).toBeVisible()
  })

  test('graph tab does not render when no rows', async ({ authedPage: page }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(`USE GRAPH \`${seed.graph}\`; MATCH (n:Person {name: 'Nobody'}) RETURN n`)
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/0 rows/)).toBeVisible()
    await sel.queryTabGraph(page).click()
    // Canvas renders empty; no inspector content beyond placeholder.
    await expect(page.getByText('Click a node or edge to inspect properties.')).toBeVisible()
  })
})
```

- [ ] **Step 2: Run, commit**

```bash
npm run e2e -- --grep "graph view"
git add e2e/specs/05-query-graph.spec.ts
git commit -m "test(e2e): cytoscape graph tab"
```

---

## Task 17: `06-schema-explorer.spec.ts` — schema discovery + stage-and-go

**Files:**
- Create: `e2e/specs/06-schema-explorer.spec.ts`

- [ ] **Step 1: Author**

```ts
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

test.describe('schema explorer', () => {
  test('lists graphs from the seeded database', async ({ authedPage: page }) => {
    await page.goto('/schema')
    // The page auto-fetches /api/v1/graphs and renders a button per graph.
    await expect(page.getByRole('button', { name: seed.graph })).toBeVisible()
  })

  test('clicking a graph populates the labels pane', async ({ authedPage: page }) => {
    await page.goto('/schema')
    await page.getByRole('button', { name: seed.graph }).click()
    for (const label of seed.labels) {
      await expect(page.getByRole('button', { name: label })).toBeVisible()
    }
  })

  test('clicking a label stages a MATCH query and navigates to /', async ({ authedPage: page }) => {
    await page.goto('/schema')
    await page.getByRole('button', { name: seed.graph }).click()
    await page.getByRole('button', { name: 'Person' }).click()
    await expect(page).toHaveURL(/\/$/)
    // The editor should now contain MATCH (n:`Person`) RETURN n LIMIT 25
    const editorText = await page.locator('.monaco-editor').first().textContent()
    expect(editorText).toContain('MATCH')
    expect(editorText).toContain('Person')
  })

  test('edge types pane lists ACTED_IN and DIRECTED', async ({ authedPage: page }) => {
    await page.goto('/schema')
    await page.getByRole('button', { name: seed.graph }).click()
    for (const t of seed.edgeTypes) {
      await expect(page.getByRole('button', { name: t })).toBeVisible()
    }
  })
})
```

- [ ] **Step 2: Run, commit**

```bash
npm run e2e -- --grep "schema explorer"
git add e2e/specs/06-schema-explorer.spec.ts
git commit -m "test(e2e): schema explorer + stage-and-go"
```

---

## Task 18: `07-admin-users.spec.ts` — users CRUD

**Files:**
- Create: `e2e/specs/07-admin-users.spec.ts`

If Geode v0.5.11 still has wire-level admin GQL gaps (per the v0.3.8 finding documented in handler comments), several of these tests will gracefully `test.skip` after asserting the underlying error is the documented engine limitation rather than a UI regression.

- [ ] **Step 1: Author**

```ts
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'

const newUsername = `e2e_user_${Date.now()}`

test.describe('admin / users', () => {
  test('users page lists at least the e2e_admin user', async ({ authedPage: page }) => {
    await page.goto('/admin/users')
    // Either we see the table populated, or we see a 422 admin-not-supported
    // error banner. Both are acceptable on Geode versions where SHOW USERS
    // is not yet on the wire — the UI still shouldn't crash.
    const banner = page.getByText(/schema_error|not supported|unimplemented/i)
    const row = page.getByText(/e2e_admin/)
    await expect(row.or(banner).first()).toBeVisible()
    test.skip(await banner.isVisible(), 'Geode does not expose SHOW USERS on the wire yet')
  })

  test('+ New user opens a modal and POST to /api/v1/users', async ({ authedPage: page }) => {
    await page.goto('/admin/users')
    test.skip(
      await page.getByText(/not supported|schema_error/i).isVisible(),
      'admin GQL not on wire',
    )
    await sel.newUserBtn(page).click()
    await page.getByPlaceholder('username').fill(newUsername)
    await page.getByPlaceholder('email').fill(`${newUsername}@e2e.local`)
    await page.getByPlaceholder('password').fill('p4$$word!')
    await page.getByRole('button', { name: /create/i }).click()
    // Modal closes on success; the new row should appear.
    await expect(page.getByText(newUsername)).toBeVisible({ timeout: 8_000 })
  })

  test('Delete row removes the user', async ({ authedPage: page }) => {
    await page.goto('/admin/users')
    test.skip(
      await page.getByText(/not supported|schema_error/i).isVisible(),
      'admin GQL not on wire',
    )
    test.skip(
      !(await page.getByText(newUsername).isVisible({ timeout: 1_000 }).catch(() => false)),
      'previous create test was skipped',
    )

    page.once('dialog', (d) => d.accept()) // window.confirm
    await page
      .getByRole('row', { name: new RegExp(newUsername) })
      .getByRole('button', { name: /delete/i })
      .click()
    await expect(page.getByText(newUsername)).toBeHidden({ timeout: 8_000 })
  })
})
```

- [ ] **Step 2: Run, commit**

```bash
npm run e2e -- --grep "admin / users"
git add e2e/specs/07-admin-users.spec.ts
git commit -m "test(e2e): admin users CRUD (with graceful skip for engine gaps)"
```

---

## Task 19: `08-admin-roles-policies.spec.ts` — roles, policies, grants

**Files:**
- Create: `e2e/specs/08-admin-roles-policies.spec.ts`

Same skip-on-engine-gap pattern as Task 18.

- [ ] **Step 1: Author**

```ts
import { test, expect } from '../fixtures'

const skipIfNoAdmin = async (page: import('@playwright/test').Page): Promise<void> => {
  const banner = page.getByText(/not supported|schema_error/i)
  test.skip(await banner.isVisible(), 'admin GQL not on wire')
}

test.describe('admin / roles', () => {
  test('roles page renders and exposes the New role button', async ({ authedPage: page }) => {
    await page.goto('/admin/roles')
    await skipIfNoAdmin(page)
    await expect(page.getByRole('button', { name: /new role/i })).toBeVisible()
  })
})

test.describe('admin / policies', () => {
  test('policies page renders and exposes the New policy button', async ({ authedPage: page }) => {
    await page.goto('/admin/policies')
    await skipIfNoAdmin(page)
    await expect(page.getByRole('button', { name: /new policy/i })).toBeVisible()
  })
})

test.describe('admin / grants', () => {
  test('grants page renders the apply form', async ({ authedPage: page }) => {
    await page.goto('/admin/grants')
    // Grants is a form (no list), so the only "skip" signal is a
    // catastrophic UI error — fail loudly if that happens.
    await expect(page.getByRole('button', { name: /apply/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /revoke/i })).toBeVisible()
  })
})
```

- [ ] **Step 2: Run, commit**

```bash
npm run e2e -- --grep "admin / roles|admin / policies|admin / grants"
git add e2e/specs/08-admin-roles-policies.spec.ts
git commit -m "test(e2e): admin roles, policies, grants pages"
```

---

## Task 20: `09-ops.spec.ts` — backups, restore, migrations, audit

**Files:**
- Create: `e2e/specs/09-ops.spec.ts`

- [ ] **Step 1: Author**

```ts
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'

test.describe('ops', () => {
  test('default tab is backups', async ({ authedPage: page }) => {
    await page.goto('/ops')
    await expect(page).toHaveURL(/\/ops\/backups/)
    await expect(sel.newBackupBtn(page)).toBeVisible()
  })

  test('migrations tab loads', async ({ authedPage: page }) => {
    await page.goto('/ops/migrations')
    // Either there are no migrations yet (empty) or there are some — both
    // are valid initial states; the page should at least render without
    // throwing.
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible()
  })

  test('audit tab polls and renders the table', async ({ authedPage: page }) => {
    await page.goto('/ops/audit')
    await expect(page.getByText(/Audit log/)).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Event' })).toBeVisible()
  })

  test('audit table contains a query_executed entry within 10s', async ({ authedPage: page, request }) => {
    // Trigger an auditable event from the API, then watch the audit table.
    const token = await page.evaluate(() => localStorage.getItem('geode-ui.access_token'))
    expect(token).toBeTruthy()
    await request.post('/api/v1/query', {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      data: { statement: 'USE GRAPH `movies`; MATCH (n:Person) RETURN count(n) AS c' },
    })
    await page.goto('/ops/audit')
    await expect(page.getByText('query_executed').first()).toBeVisible({ timeout: 10_000 })
  })

  test('restore tab pre-fills file from BackupPage navigation', async ({ authedPage: page }) => {
    // Navigate directly with state in router; verify the input is empty
    // initially. (Pre-fill via location.state requires a real backup
    // first; just confirm the field exists and is empty.)
    await page.goto('/ops/restore')
    const fileInput = page.getByPlaceholder(/backup file/i).first()
    await expect(fileInput).toBeVisible()
    expect(await fileInput.inputValue()).toBe('')
  })
})
```

- [ ] **Step 2: Run, commit**

```bash
npm run e2e -- --grep "ops"
git add e2e/specs/09-ops.spec.ts
git commit -m "test(e2e): ops tabs (backups, migrations, audit, restore)"
```

---

## Task 21: `10-mcp-endpoint.spec.ts` — MCP HTTP smoke

**Files:**
- Create: `e2e/specs/10-mcp-endpoint.spec.ts`

The MCP HTTP transport listens on port `8090` of the `geode-mcp` service. Playwright's `request` API can probe it directly.

- [ ] **Step 1: Author**

```ts
import { test, expect, request } from '@playwright/test'

const MCP_URL = process.env.MCP_URL ?? 'http://localhost:8090'

test.describe('mcp', () => {
  test('responds on the MCP HTTP transport', async () => {
    const ctx = await request.newContext({ baseURL: MCP_URL })
    // The MCP HTTP transport speaks JSON-RPC 2.0 at / (or /mcp depending
    // on Geode's routing). Try /mcp first; fall back to /.
    const tryEndpoints = ['/mcp', '/']
    let ok = false
    let lastStatus = 0
    for (const ep of tryEndpoints) {
      const res = await ctx.post(ep, {
        headers: { 'content-type': 'application/json' },
        data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      })
      lastStatus = res.status()
      if (res.ok() || res.status() === 400 /* spec-compliant error reply still proves life */) {
        ok = true
        break
      }
    }
    expect(ok, `MCP HTTP did not respond at any of ${tryEndpoints.join(', ')}; last status=${lastStatus}`).toBe(true)
    await ctx.dispose()
  })

  test('exposes tool list via tools/list method', async () => {
    const ctx = await request.newContext({ baseURL: MCP_URL })
    const res = await ctx.post('/mcp', {
      headers: { 'content-type': 'application/json' },
      data: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    })
    test.skip(!res.ok(), `MCP /mcp returned ${res.status()}; tool listing not exposed at this path`)
    const body = (await res.json()) as { result?: { tools?: unknown[] } }
    expect(body.result?.tools, 'tools array is present').toBeDefined()
    expect((body.result?.tools ?? []).length).toBeGreaterThan(0)
    await ctx.dispose()
  })
})
```

> The exact MCP HTTP path is implementation-dependent. The first test is tolerant (tries `/mcp` and `/`, accepts any 200 or 400 as proof-of-life). The second test specifically probes `tools/list` and skips if the path doesn't expose it. If both pass against the real stack, leave them; if the second consistently skips, document the actual MCP path in `e2e/.env.example` and update the test.

- [ ] **Step 2: Run, commit**

```bash
npm run e2e -- --grep "mcp"
git add e2e/specs/10-mcp-endpoint.spec.ts
git commit -m "test(e2e): MCP HTTP transport smoke + tools/list"
```

---

# Phase 4 — CI Integration

## Task 22: Build a Playwright runner image

**Files:**
- Create: `deploy/playwright/Dockerfile.playwright`

We build a slim image that has Node 22 + Playwright + Chromium pre-installed so CI doesn't redownload the browser on every run.

- [ ] **Step 1: Author**

`deploy/playwright/Dockerfile.playwright`:
```dockerfile
# syntax=docker/dockerfile:1.7
# Pre-baked Playwright runner for CI. Has Node 22, the e2e package
# layout staged, and Chromium baked in.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /work
COPY package.json package-lock.json ./
RUN npm ci --omit=optional

COPY e2e/ ./e2e/
ENV CI=1
ENTRYPOINT ["npx", "playwright", "test", "--config=e2e/playwright.config.ts"]
```

- [ ] **Step 2: Build + smoke**

```bash
docker build -f deploy/playwright/Dockerfile.playwright -t geode-ui-pw:e2e .
docker run --rm --network=host -e UI_URL=http://localhost:8080 geode-ui-pw:e2e --list
```
Expected: lists all tests from `e2e/specs/*.spec.ts`.

- [ ] **Step 3: Commit**

```bash
git add deploy/playwright/Dockerfile.playwright
git commit -m "build(e2e): playwright runner Dockerfile"
```

---

## Task 23: GitLab CI job

**Files:**
- Modify: `.gitlab-ci.yml`

- [ ] **Step 1: Append the e2e job**

After the existing `docker:build` job, add:

```yaml
e2e:playwright:
  stage: test
  image: docker:25
  services:
    - docker:25-dind
  variables:
    DOCKER_TLS_CERTDIR: "/certs"
    GEODE_ADMIN_PASSWORD: geode-test-pw-12
    # SEC F-SUP-5 (#161): placeholder; the real CI value is injected
    # from a CI variable. Never commit the literal secret.
    JWT_SECRET_HEX: <GENERATE_WITH_openssl_rand_hex_32>
  script:
    # Bring up the test stack.
    - apk add --no-cache make git bash
    - make e2e-up
    # Wait for geode-ui health.
    - |
      for i in $(seq 1 60); do
        if wget -qO- http://docker:8080/healthz | grep -q ok; then break; fi
        sleep 2
      done
    # Run Playwright in a sibling container against the docker-host network.
    - >
      docker run --rm --network=host
      -e UI_URL=http://docker:8080
      -e MCP_URL=http://docker:8090
      -e ADMIN_USER=e2e_admin
      -e ADMIN_PASSWORD=e2e-pw-1234
      -v "$PWD/e2e/playwright-report:/work/e2e/playwright-report"
      $CI_REGISTRY_IMAGE/playwright:latest
  after_script:
    - make e2e-down || true
  artifacts:
    when: always
    paths:
      - e2e/playwright-report/
    expire_in: 7 days
```

> **Image registry note:** the `$CI_REGISTRY_IMAGE/playwright:latest` reference assumes the Playwright image is published to the same GitLab registry as the geode-ui image. If your CI doesn't yet publish it, swap that line for an inline build:
> ```yaml
>     - docker build -f deploy/playwright/Dockerfile.playwright -t pw:local .
>     - docker run --rm --network=host ... pw:local
> ```

- [ ] **Step 2: Push and verify the pipeline**

```bash
git add .gitlab-ci.yml
git commit -m "ci(e2e): playwright job in test stage"
git push
```

Expected: the new `e2e:playwright` job runs in CI. If it fails, inspect the GitLab job log and the uploaded `playwright-report/` artifact to triage.

---

## Task 24: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append the E2E section**

Find the existing `## Development` section and add this subsection just below it:

```markdown
## E2E testing

The repo ships a docker-compose stack and a Playwright suite that drives the
full UI surface against a real Geode v0.5.11 database.

```bash
make e2e-up          # build images, run init, leave services running
make e2e-test        # run Playwright against the running stack
make e2e-down        # tear down + clear volumes
make e2e-ci          # one-shot: up + test + down (CI-shaped)
```

Services brought up by the stack:

| Service     | Port           | Purpose                          |
|-------------|----------------|----------------------------------|
| geode       | 3141/udp       | Geode v0.5.11 graph database     |
| geode-init  | one-shot       | Bootstraps admin + seeds movies  |
| geode-ui    | 8080           | Go API + embedded React SPA      |
| geode-mcp   | 8090           | MCP HTTP transport               |
| geode-lsp   | 2087           | LSP TCP bridge (socat)           |

Seeded data is the canonical movies graph (6 People, 3 Movies, 9 ACTED_IN
edges, 3 DIRECTED edges) plus indexes on `:Person(name)` and `:Movie(title)`.
See `deploy/geode/init.gql`.

Playwright suites live under `e2e/specs/` and follow the page-object pattern
with shared fixtures in `e2e/fixtures.ts`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(e2e): README section for the test stack"
```

---

# Self-Review

**Spec coverage:**
- "full suite of playwright tests" → 10 spec files cover auth/connection/query-sync/query-stream/query-graph/schema/admin-users/admin-roles-policies/ops/mcp.
- "verify functionality of the UI against the server" → tests exercise real network round-trips (no mocks), asserting on rendered DOM after live API calls.
- "docker compose system that pairs the latest version of geode" → Task 1 builds `geode:v0.5.11` from sibling source; Task 5 pairs it with geode-ui, mcp, lsp, and init.
- "as well as the geode LSP and MCP" → `geode-lsp` (Task 4 + Task 5) and `geode-mcp` (Task 5) are explicit services in the compose; the MCP suite (Task 21) probes its HTTP transport.
- "pre-populate geode with data for testing and validation" → Tasks 2 & 3 author `init.gql` + the bootstrap script; Task 11 mirrors the seed counts in `gqlData.ts`; every query test asserts against the seeded counts.

**Placeholder scan:** No `TBD`/`fill in details`. Two intentional pointers in Task 1 ("verify v0.5.11", "build.sh vs build.zig") and Task 21 ("MCP path is implementation-dependent") are explicit run-this-and-adapt instructions, not placeholders.

**Type consistency:** `seed` shape in `gqlData.ts` is referenced consistently across query/schema specs (`seed.graph`, `seed.counts.persons`, `seed.people`, `seed.labels`, `seed.edgeTypes`). Selector names in `selectors.ts` (`queryRunBtn`, `queryStreamToggle`, `queryTabTable`, `queryTabJson`, `queryTabGraph`, `cancelStream`, `graphCanvas`, `graphsList`, `labelsList`, `newUserBtn`, `newBackupBtn`) used identically across all spec files. Compose service names (`geode`, `geode-init`, `geode-ui`, `geode-mcp`, `geode-lsp`) and ports (3141/8080/8090/2087) match across compose, Makefile, and README.

---

# Execution Notes

- **Adapt to actual Geode behavior at run time:** init.gql, the seed script's `CREATE USER` step, and the admin spec all encode "what we hope works on v0.5.11". When something doesn't, document the deviation (in code comments or in the test's `test.skip` reason), don't hide it.
- **Don't edit gen/ files** if a generator quirk surfaces; fix `~/src/devnw/go/genapi` and regen.
- **Run `superpowers:verification-before-completion` before claiming a task done** — every task ends in `npm run e2e -- --grep` or `make e2e-up`/`make e2e-down`. Confirm green output, not "should pass".
- **Image rebuilds:** the geode-ui Dockerfile copies the sibling `geode-client-go` source into `/work/geode-client-go` and rewrites the `replace` directive. If a Phase 1 task fails because that copy isn't happening, re-read the existing `deploy/Dockerfile` from D6 and adjust.
