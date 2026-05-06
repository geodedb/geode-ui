# geode-ui Architecture

Single Go binary serving:

- `/` → SPA from `go:embed dist/`
- `/api/v1/...` → genapi-generated REST handlers
- `/ws/...` → genapi-generated WebSocket handlers
- `/mcp` → genapi-generated MCP HTTP transport
- `/healthz` → liveness

Outbound:

- one or more Geode servers via `geodedb.com/geode` (QUIC default, gRPC fallback, mTLS)

Source of truth: `geode.json` (genapi spec). Run `make generate` after editing it.
Generated code lives in `gen/`; do not edit by hand.

Reference impl pattern: `~/src/devnw/go/oidc` (storage-abstraction, JWT auth, audit emit, embedded test http server).
