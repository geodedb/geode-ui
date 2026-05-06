# Geode UI

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.26.2-00ADD8.svg)](https://go.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-22.14.0+-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18.2.0-blue.svg)](https://reactjs.org/)

A self-contained Go binary that embeds a React + TypeScript SPA and exposes the
entire Geode graph database client surface as an HTTP/WebSocket API. Includes a
Neo4j-style interactive graph visualization, a Monaco GQL editor, schema
explorer, and admin/ops UIs for users, roles, policies, grants, backups,
restores, migrations, and the audit log.

## Quick start

```bash
# Build (Go 1.26.2 + Node 22.14+)
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
- `/api/v1/...`    → genapi-generated REST handlers (44 endpoints)
- `/ws/query`      → streaming GQL query (WebSocket)
- `/mcp`           → genapi-generated MCP HTTP transport (one `query` tool)
- `/healthz`       → liveness

Outbound, the server fans out to one or more Geode servers via the
`geodedb.com/geode` driver, multiplexed through a profile-aware connection
pool (`internal/conn`).

## Configuration

| Flag | Default | Purpose |
|------|---------|---------|
| `-listen` | `:8080` | HTTP listen address |
| `-jwt-secret-hex` | (required) | hex-encoded HS256 secret, ≥32 bytes; generate with `openssl rand -hex 32` |
| `-jwt-ttl` | `8h` | JWT TTL (1m..24h) |
| `-profiles` | (none) | path to JSON profile config; defaults to a single `default` profile pointing at `quic://127.0.0.1:3141` |

Profiles JSON example:

```json
[
  { "name": "local", "dsn": "quic://127.0.0.1:3141" },
  { "name": "prod",  "dsn": "quic://geode-prod.internal:3141", "tls_ca_file": "/etc/certs/ca.pem" }
]
```

## Docker

A multi-stage build (Node web build → Go static binary → minimal Alpine
runtime) lives in [deploy/Dockerfile](deploy/Dockerfile). An example compose
file is in [deploy/docker-compose.example.yml](deploy/docker-compose.example.yml).

> **Note:** until `geodedb.com/geode` ships to a public Go module proxy, the
> Docker build context must include a sibling `geode-client-go/` checkout next
> to `geode-ui/`. See the Dockerfile header comments for details.

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

## Documentation

- [Architecture overview](docs/README.md)
- [Private registry setup](docs/PRIVATE_REGISTRY.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for security policy and vulnerability reporting.

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
