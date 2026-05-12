# internal/server

The HTTP server layer for geode-ui. Wires the genapi-emitted routes
(`gen/api/handlers_gen.go`) to per-route handler implementations in
`handlers_*.go`, plus session/auth/CSRF/rate-limit middleware and
shared helpers.

## Layout

- `handlers_*.go` — per-domain handlers (auth, profiles, profiles_crud,
  profiles_public, users, roles, policies, grants, backups, migrations,
  graphs, uploads, etc.). One file per route family.
- `audit.go` — `emitAudit` helper plus the redaction substring list.
  Failures are logged but do not block the response.
- `auth.go` — `AuthJWT` middleware (HS256 verify; reads the JWT from
  the auth cookie, the `Authorization` header, and the `?access_token=`
  query parameter, in that order; the query-string fallback is
  deprecated per SEC-F5).
- `loginlimiter.go` — per-IP and per-(profile,username) rate limit on
  `/auth/login` (SEC-F2).
- `profilelimiter.go` — per-actor (JWT subject) rate limit on POST/PATCH/
  DELETE `/api/v1/profiles` (PSR-S7).
- `pemvalidate.go` — TLS PEM validation for the profile CRUD path
  (PSR-S10). Per-field 64 KiB cap, role-aware (CA / cert / key) PEM
  parsing.
- `security_headers.go` — CSP / Permissions-Policy / COOP middleware
  plus the `Deprecation`/`Sunset` emitter for `?access_token=` callers.
- `errors.go` — `endpointError`, `writeEndpointError`, the
  `writeEndpointErr` shorthand (PSR-Q07), and shared HTTP-error
  helpers (`writeBadRequest`, `writeNotFound`, `writeStoreUnavailable`).
- `util.go` (after split) → `context.go` / `quoting.go` / `sqlexec.go` /
  `coerce.go` — generic helpers: identifier/string quoting,
  `quoteIdent`/`quoteString`, `runQuery`/`runStatement`, scalar
  coercion, etc.

## Conventions

See [`CONVENTIONS.md`](CONVENTIONS.md) for the full behavioural contract
(error-code taxonomy, the empty-result rule, wire-feature-missing
fallback, per-row dual-key forward-compat, audit-event naming, and the
envelope helpers). The headline rules:

- **Handler signatures match the genapi contract.** Do not rename the
  parameter types — they are emitted from the genapi config and any
  drift will fail the type-check on the next regeneration.
- **Audit emission uses `emitAudit(ctx, ...)`.** Failures inside
  `emitAudit` are logged and swallowed; they do not block the response
  (see `audit.go` and PSR-Q07 / PSR-G08 for the policy choice).
- **Rate-limit responses** use `rejectLogin` / `rejectProfileCRUD`.
  Match the body shape (`{code, description, reason}`) so the SPA's
  existing 429 handler covers both surfaces.
- **Generated code is read-only.** Anything under `gen/` is emitted by
  `~/src/devnw/go/genapi`. If a generated file is wrong, fix the
  generator and regenerate; never hand-edit.
- **Build-time env:** the server uses the `encoding/json/v2` standard
  library, which requires `GOEXPERIMENT=jsonv2`. Use the `make` targets
  (e.g., `make go-test`, `make go-lint`) or `scripts/run-go.sh` so the
  flag is set automatically.
