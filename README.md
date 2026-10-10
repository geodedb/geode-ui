# Geode UI

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.26.2-00ADD8.svg)](https://go.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-24.21.0+-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18.2.0-blue.svg)](https://reactjs.org/)

A self-contained Go binary that embeds a React + TypeScript SPA and exposes the
entire Geode graph database client surface as an HTTP/WebSocket API. Includes a
Neo4j-style interactive graph visualization, a Monaco GQL editor, schema
explorer, and admin/ops UIs for users, roles, policies, grants, backups,
restores, migrations, and the audit log.

## Quick start

```bash
# Build (Go 1.26.2 + Node 24.21+)
make build

# Generate a JWT secret
SECRET=$(openssl rand -hex 32)

# Run, pointing at a local Geode at quic://127.0.0.1:3141
./bin/geode-ui -listen :8080 -jwt-secret-hex "$SECRET"

# Open http://localhost:8080 and sign in with your Geode credentials
```

## Architecture

A single Go binary serves:

- `/`              → SPA from `go:embed dist/` (`internal/ui/embed.go`)
- `/api/v1/...`    → genapi-generated REST handlers (see [`geode.json`](geode.json) for the full route list)
- `/ws/query`      → streaming GQL query (WebSocket)
- `/mcp`           → genapi-generated MCP HTTP transport (one `query` tool)
- `/healthz`       → liveness

Outbound, the server fans out to one or more Geode servers via the
`geodedb.com/geode` driver, multiplexed through a profile-aware connection
pool (`internal/conn`).

The SPA exposes three top-level routes: `/` (single-pane query editor), `/workspace` (multi-pane query workspace — 1–4 tiled editor+result panes, each with its own WebSocket stream), and `/dashboard` (overview cards for graphs, recent queries, connection status, and on-demand graph stats). The result panel on every editor surface offers a Table / JSON / Graph / **Matrix** tab switcher; the Matrix view renders scalar-projection results (e.g. `RETURN n.name, n.age`) as a sortable matrix. A persisted FIFO **query history** (capped at 20 entries, stored in `localStorage` via `useQueryHistory`) backs the dashboard's "recent queries" card and lets users prefill the editor by clicking a past statement.

## Configuration

| Flag | Default | Purpose |
|------|---------|---------|
| `-listen` | `:8080` | HTTP listen address |
| `-jwt-secret-hex` | (required) | hex-encoded HS256 secret, ≥32 bytes; generate with `openssl rand -hex 32` |
| `-jwt-ttl` | `8h` | JWT TTL (1m..24h) |
| `-profiles` | (none) | path to JSON profile config; defaults to a single `default` profile pointing at `quic://127.0.0.1:3141` |
| `-trust-proxy-xff` | `false` | trust `X-Forwarded-For` for per-IP rate-limit keying (see security note below) |

> **Security note — `-trust-proxy-xff`.** By default the per-IP login limiter
> (5 rps) and the per-(profile, username) lockout counter key on
> `RemoteAddr`, which makes the deployment secure-by-default against a
> public-internet attacker who would otherwise rotate `X-Forwarded-For`
> to bypass the limiter or trip per-IP lockouts against innocent IPs
> (S-NEW-5 / [#201](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/201)).
> Set `-trust-proxy-xff=true` **only** when the binary sits behind a
> TLS-terminating reverse proxy you control and that proxy strips
> any inbound `X-Forwarded-For` before appending the real client hop.

Profiles JSON example:

```json
[
  { "name": "local", "dsn": "quic://127.0.0.1:3141" },
  { "name": "prod",  "dsn": "quic://geode-prod.internal:3141", "tls_ca_file": "/etc/certs/ca.pem" }
]
```

## Docker

For local development, a multi-stage build (Node web build → Go static binary
→ minimal Alpine runtime) lives in [deploy/Dockerfile](deploy/Dockerfile).
An example compose file is in
[deploy/docker-compose.example.yml](deploy/docker-compose.example.yml).

> **Note:** until `geodedb.com/geode` ships to a public Go module proxy, the
> dev Docker build context must include a sibling `geode-client-go/` checkout
> next to `geode-ui/`. See the Dockerfile header comments for details.

For released images, GoReleaser produces eight container variants
(debian + alpine × amd64 + arm64) on every git tag and pushes them to
both the GitLab Container Registry and `docker.io/geodedb/geode-ui` —
see [Releasing](#releasing) below.

## Releasing

The release pipeline produces three artifact families on every git tag
matching `v*`:

| Artifact | Where it lands | Built by |
|---|---|---|
| Container images (8 variants) | `registry.gitlab.com/devnw/codepros/geode/geode-ui` + `docker.io/geodedb/geode-ui` | GoReleaser ([`.goreleaser.yaml`](.goreleaser.yaml)) |
| Linux packages (.deb / .rpm / .apk) | GitLab Release page assets | GoReleaser nFPM |
| Electron desktop installers (.dmg / .AppImage / .deb / .exe) | GitLab Release page assets | electron-builder |

Snapshot builds (main-branch pushes) push container images to the GitLab
Container Registry only with `<version>-snapshot-<sha>` tags; nothing is
published to Docker Hub or as desktop installers off-tag.

Windows installers are signed with an EV Authenticode certificate via
ssl.com's eSigner cloud HSM (delegated to the
[`codesign-windows-ssl`](https://gitlab.com/devnw/ci-catalog/-/tree/main/templates/codesign-windows-ssl)
ci-catalog component); macOS installers are signed via electron-builder
when an Apple Developer ID cert is provisioned.

See [deploy/RELEASE.md](deploy/RELEASE.md) for the full operator runbook —
required CI variables (already provisioned at the
`devnw/codepros/geode` group level for Docker Hub), tag-cut workflow,
ssl.com EV signing setup, snapshot semantics, and local-test commands.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). Quick targets:

```bash
make help            # list all targets
make generate        # regenerate gen/ from geode.json
make build           # production build (SPA + Go binary)
make test            # all tests (Go + JS)
make lint            # all linters
make web-dev         # webpack dev server (port 3000, proxies to :8080)
```

## E2E testing

The repo ships a docker-compose stack and a Playwright suite that drives the
full UI surface against a real Geode database. **Minimum: v0.5.15 for admin
DDL + role + grant management; v0.5.x is sufficient for read-only query
flows.** The SPA gates admin CTAs from the upstream `SHOW CAPABILITIES` probe
(surfaced via `GET /api/v1/capabilities`), so older engines render with the
admin write affordances disabled and an inline "not supported" note instead
of failing outright. See [docs/ARCHITECTURE.md → Server-side admin DDL
(Geode v0.5.15+)](docs/ARCHITECTURE.md) for the supported operations and
the upstream divergences (e.g. CREATE POLICY remains upstream-deferred).

```bash
make e2e-deps        # build geode binary on the host (one-time, ~5 min cold)
make e2e-up          # build images, run init, leave services running
make e2e-test        # run Playwright against the running stack
make e2e-down        # tear down + clear volumes
make e2e-ci          # one-shot: up + test + down (CI-shaped)
```

Services brought up by the stack:

| Service     | Port           | Purpose                          |
|-------------|----------------|----------------------------------|
| geode       | 3141/udp       | Geode v0.5.15 graph database     |
| geode-init  | one-shot       | Bootstraps admin + seeds movies  |
| geode-ui    | 8080           | Go API + embedded React SPA      |
| geode-mcp   | 8090           | MCP TCP bridge (socat to stdio)  |
| geode-lsp   | 2087           | LSP TCP bridge (socat to stdio)  |

Seeded data is the canonical movies graph (6 People, 3 Movies, 9 ACTED_IN
edges, 3 DIRECTED edges). See [deploy/geode/init.gql](deploy/geode/init.gql).

Playwright suites live under `e2e/specs/` and follow the page-object
pattern with shared fixtures in `e2e/fixtures.ts`. Default suite is 10
specs / 31 tests:

- `01-auth.spec.ts` — login, redirect, token persistence, logout
- `02-connection-picker.spec.ts` — profile dropdown
- `03-query-sync.spec.ts` — sync MATCH, error banner, JSON tab
- `04-query-stream.spec.ts` — WS streaming, cancel
- `05-query-graph.spec.ts` — Cytoscape canvas, empty-state
- `06-schema-explorer.spec.ts` — graphs/labels/edges, stage-and-go
- `07-admin-users.spec.ts` — users CRUD (graceful skip on engine gaps)
- `08-admin-roles-policies.spec.ts` — roles/policies/grants pages
- `09-ops.spec.ts` — backups/migrations/audit/restore
- `10-mcp-endpoint.spec.ts` — MCP TCP bridge JSON-RPC smoke

Some tests gracefully skip on upstream-deferred surfaces -- CREATE
POLICY (admin_writable.policies=false on v0.5.15), the dedicated `audit`
role (not in the v0.5.15 built-in set), and MCP `tools/list`. Each skip
emits the GAP-### tracking id so dashboard reviewers can match the trace
output against `docs/GAP_ANALYSIS.md` without spelunking the spec.

## Documentation

- [Architecture overview](docs/README.md)
- [Private registry setup](docs/PRIVATE_REGISTRY.md)
- [Electron desktop client](docs/ELECTRON.md)
- [Internationalization (i18n)](docs/I18N.md)
- [Release engineering](deploy/RELEASE.md) — goreleaser pipeline, EV signing, tag workflow

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for security policy and vulnerability reporting.

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
