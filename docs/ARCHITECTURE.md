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
Generated code lives in `gen/`; do not edit by hand (checked in so PRs can review handler-name diffs).

Reference impl pattern: `~/src/devnw/go/oidc` (storage-abstraction, JWT auth, audit emit, embedded test http server).

## Authentication

`POST /api/v1/auth/login` accepts `application/x-www-form-urlencoded`
with `username`, `password`, and optional `profile` (defaults to
`default`). The handler authenticates against the named upstream Geode
profile by opening a short-lived `*sql.DB` with the supplied
credentials, then issues an HS256-signed JWT carrying:

- `sub` — the username
- `profile` — the connection-profile name (used by handlers to pick a
  pool DSN downstream)
- `roles` — the list returned by `SHOW USER ROLES` against the
  upstream; consumed by genapi `required_roles` enforcement

Subsequent requests must carry the token as
`Authorization: Bearer <token>`. WebSocket clients (`/ws/query`)
that can't set Authorization on the upgrade can fall back to
`?access_token=<token>` on the URL.

The HS256 secret is supplied via `-jwt-secret-hex` and must be at
least 32 bytes (64 hex characters). Generate one with:

```bash
openssl rand -hex 32
```

The binary refuses to start without the flag set. Token TTL defaults
to 8 hours and is bounded to `1m..24h` via `-jwt-ttl`.
