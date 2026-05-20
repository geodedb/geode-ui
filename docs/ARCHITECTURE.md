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

### Server-side admin DDL (Geode v0.5.15+)

The 2026-05-13 v0.5.15 auth-DDL integration pass landed wire-side admin
operations over GQL. The handler layer (`internal/server/handlers_users.go`,
`handlers_roles.go`, `handlers_grants.go`, `handlers_policies.go`) emits
the v0.5.15 grammar (see upstream
[`geode/docs/GQL_AUTH_DDL.md`](https://gitlab.com/devnw/codepros/geode/-/blob/main/docs/GQL_AUTH_DDL.md))
and the SPA gates CTAs via the typed `GET /api/v1/capabilities` probe
(`admin_writable.{users,roles,grants,policies}`). On older Geode builds
the probe returns `false` for unsupported surfaces and the affordances
render disabled with an inline "not supported" note instead of failing
on first click.

Supported on v0.5.15:

- `CREATE USER <name> SET PASSWORD '<pw>' [EMAIL '<email>'] [ROLE <role>]`
- `ALTER USER <name> SET PASSWORD '<pw>'`
- `ALTER USER <name> SET ROLE <role>`
- `ALTER USER <name> SET EMAIL '<email>'`
- `ALTER USER <name> ENABLE` / `DISABLE`
- `DROP USER [IF EXISTS] <name>`
- `SHOW USERS` -- columns: `username, email, role, active`
- `CREATE ROLE <name> [SET DESCRIPTION '<text>']`
- `DROP ROLE [IF EXISTS] <name>`
- `SHOW ROLES` -- single column `role_name` (v0.5.15) plus legacy
  multi-column emit (`name, description, permissions`) for back-compat
- `GRANT ROLE <role> TO <user>`
- `GRANT {READ|WRITE|SCHEMA|ALL} [ON GRAPH <graph>] TO <user>`
- `REVOKE {...} [ON GRAPH <graph>] FROM <user>`
- `SHOW PERMISSIONS [FOR <user>]` -- bare `FOR <user>`, no `USER` keyword

Persistence: `User`/`Role`/`Permission` nodes live in the internal
`__geode_security` graph and survive restarts. The HMAC chain protects
each record so a tampered row fails verification at server start
(`AuthGraphManager::verifyChain` at `src/server/server_init.zig`).

Upstream-truth divergences from this integration run that future
maintainers should know about:

1. **No working delimited-identifier delimiter on the GQL wire.** v0.5.15's
   `src/gql/lexer.zig` defines `scanQuotedIdentifier` but the dispatch
   table never calls it -- `"x"` is parsed as `string_lit`, backticks
   are illegal. `quoteIdent` therefore validates inputs against the
   identifier shape `[A-Za-z_0-9][A-Za-z_0-9-]*` and emits bare. Anything
   outside the shape (whitespace, dots, slashes, multi-byte) is rejected
   at the handler boundary with 400 `invalid_<field>`.
2. **Bootstrap password violates the wire-side passphrase policy.**
   `geode auth init` generates a 32-hex bootstrap admin password, but
   `geode_auth_lib.zig::geodeSecure` enforces ≥20 chars, ≥3 words, mixed
   case after the first successful auth. Result: the bootstrap auth path
   succeeds, then `checkStoredPasswordMeetsCurrentPolicy` flips
   `password_reset_required = true` and returns `error.PasswordResetRequired`
   with no session -- locking the operator out of any wire-side `ALTER
   USER`. The e2e stack works around this by running the offline
   `geode user reset-password` in the container entrypoint (clears the
   reset flag, applies the relaxed CLI password policy).
3. **`SHOW USERS` `role` is singular.** The handler lifts the singular
   `role` column from upstream `geode.auth.user_list` into the typed
   `[]Roles` slice the SPA expects.
4. **`SHOW USERS` uses `active` (bool), not `disabled`.** The handler
   inverts on projection.
5. **`SHOW ROLES` may emit one column (`role_name`) or many.** The
   handler accepts both shapes and normalises to `{name, description,
   permissions}` for the SPA.
6. **`SHOW PERMISSIONS FOR` takes a bare username**, no `USER` keyword.
7. **CREATE POLICY is upstream-deferred.** `admin_writable.policies=false`
   on v0.5.15 -- `handlePolicyCreate` (`src/execution/auth_dispatch.zig`)
   still returns `wire_feature_missing`. SPA gates the New Policy CTA;
   e2e spec marks the policies describe block as `test.fixme`.
8. **`GRANT <priv> TO <user>` without an `ON GRAPH` clause parses but
   does not persist.** Upstream `handleGrantRevoke` returns an
   explanatory status row instead of an error. SPA treats this as a
   200 (audit log captures the no-op).
9. **No dedicated `audit` role.** Built-in v0.5.15 role set is
   `{admin, user, readwrite, readonly}`. `/api/v1/audit` may 403 even
   for admins because the audit permissions are gated by the missing
   role. Tracked under GAP-004 / GAP-015.
10. **Login `roles` is `null` for non-bootstrap admins.**
    `authenticateUpstream` (`internal/server/handlers_auth.go`) does not
    yet query `SHOW USERS` to populate the JWT `roles` claim. The
    `-admin-users` CLI flag is the working fallback -- supply a
    comma-separated list of usernames that should receive the `admin`
    role on login.
11. **Login expects `application/x-www-form-urlencoded`**, not JSON. The
    `LoginReq` schema is form-encoded per genapi `BodyMode: "form"`.

Open follow-ups: re-emit `roles` from `SHOW USERS` on login (close
divergence #10), wire-side delimited-identifier support upstream
(divergence #1), CREATE POLICY persistence (divergence #7).

## Performance SLOs (assumed, pending real telemetry)

> **These numbers are *assumed*, not measured.** There is no production
> telemetry for geode-ui yet. They are the working assumptions inherited from
> `docs/PERF_GAP_ANALYSIS.md` (Phase 3 of the 2026-05 audit) and are used to
> size connection pools, batch sizes, and the like. Replace each value with a
> measured SLO once real traffic data exists.

Assumed workload / targets:

- **Steady-state throughput**: ~2,000 rps on `POST /api/v1/query` (a mix of
  cheap auth/schema reads and user-issued GQL).
- **Burst concurrency**: ~400 concurrent users issuing simultaneous queries
  (admin dashboards refreshing at once).
- **Result-set distribution**: 10th–90th percentile ≈ 1–1,000 rows; long tail
  to 100k+ rows on streamed `MATCH (n)`-style queries (hence the streaming
  `/api/v1/query` codepath — TTFB ≪ TTLB for big result sets).
- **Upstream query latency**: Geode driver (QUIC) p50 ≈ 10 ms.
- **Graph render**: Cytoscape view should stay responsive at 400+ nodes (one
  layout invocation per completed query, not per row batch).
- **Webpack/Vite bundle budget**: `performance.hints: 'error'`, 1 MiB per
  asset, 1.5 MiB per entrypoint — the SPA build fails if either is exceeded.

### Rate limits: per-route, cross-route aggregate, and per-IP

Three independent server-side throttles are layered on the genapi-emitted
HTTP surface, checked in this order on every request (after auth/authz):

1. **Cross-route aggregate ceiling** — `RegisterGeneratedAPI` builds a single
   server-wide token bucket from `APIOptions.GlobalRate` / `GlobalBurst`
   (`global_rps` / `burst` in the genapi config). It is the coarsest control:
   one bucket shared by *every* generated route, checked once per request.
   `geode.json` sets `global_rps: 2000` (matching the assumed steady-state
   target above) with a burst of `400`; `cmd/server/app.go` passes those into
   `RegisterGeneratedAPI`. Set `global_rps: 0` to disable the aggregate
   limiter entirely. Pinned by
   `internal/server/global_ratelimit_test.go` (cross-route 429 + disabled-
   when-zero) and `internal/server/query_ratelimit_test.go`.
2. **Per-route bucket** — each route declared with a `rateLimit` in
   `geode.json` gets its own token bucket (e.g. `/api/v1/query` → `2000` rps,
   pinned by `query_ratelimit_test.go`); a route with no `rateLimit` falls
   back to `global_rps` as its *per-route default rate*. This is the tighter
   per-endpoint ceiling — it can never let a single route exceed its own
   `rateLimit` even if the aggregate budget has room.
3. **Per-IP limiter** (`PerIPRPS` / `PerIPBurst`, partitioned by client IP)
   — a coarse per-client ceiling applied to every route; opt-in (disabled
   when `PerIPRPS` is 0).

The cross-route aggregate limiter landed in genapi via commit `2eabc11`
(recommended tag `v0.3.1`); before that `APIOptions.GlobalRate` was populated
from config but unused in `RegisterGeneratedAPI`. (Resolved 2026-05-12, #159 —
was a documented open question; `global_rps` is now both aligned to the SLO
*and* a real server-wide ceiling.) If a future workload review needs
`/api/v1/query` capped lower, change the spec `rateLimit` and regenerate; if
it needs a different aggregate ceiling, change `global_rps` (and the
`GlobalRate` argument in `cmd/server/app.go`).

### Regression net

There is no continuous load-test rig. The regression net for the Go side is:

- `make bench-gate` — runs the curated benchmark set (see
  `scripts/bench-gate.sh`: `internal/conn`, `internal/server`, `internal/jwt`,
  `gen/pkg/{wsx,oidcx,securex,gen}`) with `-count=6` and a bounded
  `-benchtime`, then diffs against the committed `bench-baseline.txt` via
  `benchstat`. Fails if any benchmark regressed > 10% in ns/op, B/op, or
  allocs/op with a statistically significant delta.
- `bench-baseline.txt` (repo root) — the committed reference, generated
  post-#142 (audit-ring) / #150 (profilestore WAL split). It is the
  like-for-like baseline the gate compares against, so the gate command and
  the baseline must always cover the same package set.
- CI job `bench-gate` (`test` stage, `allow_failure: true`) — runs
  `make bench-gate` on MRs and on `main`. It's `allow_failure` on purpose:
  shared CI runners are noisy. `-count=6` plus benchstat's significance test
  suppress most false positives, but not all — a red gate means "go look", not
  "you broke production". Promote to a hard gate once runner noise is
  characterised against real telemetry.

**Refreshing the baseline** after a deliberate, accepted perf change:

```bash
make bench-baseline   # alias: make bench-record
git add bench-baseline.txt && git commit
```

### pprof / debug endpoints

`net/http/pprof` and other debug surfaces are mounted **only** when
`Observability.EnableDebug` is set; they are not exposed in the production
configuration. Profiling in prod therefore requires an explicit opt-in, not a
default-on endpoint.

### Geode metrics proxy

`GET /api/v1/metrics` is a JWT-gated proxy fronting the upstream
`http://<geode>:<GEODE_METRICS_PORT>/metrics` endpoint:

```text
SPA (DashboardPage)
  └─ useMetricsPolling() — 5s poll, 5-minute history ring
       └─ fetchMetrics() (src/api/metrics.ts)
            └─ geode-ui /api/v1/metrics (auth chain)
                 └─ HandleMetrics (internal/server/handlers_metrics.go)
                      ├─ http.Get(cfg.MetricsURL, 2s timeout)
                      ├─ ParseProm (internal/server/promparse.go, stdlib)
                      └─ projectSnapshot → typed MetricsSnapshot JSON
```

Decisions:

- The parser is hand-rolled (≈280 LoC, stdlib only) rather than
  `github.com/prometheus/common/expfmt` (a ≈2 MB transitive blob).
  Supports counter, gauge, histogram only — sufficient for every
  family the upstream emits today.
- The proxy projects per-family scalars into a typed
  `MetricsSnapshot` so the SPA never sees free-form
  `MetricFamily[]`; a renamed upstream metric is a Go compile
  error, not a SPA-runtime parse failure.
- The route is registered directly on the `mux` (not via genapi)
  because adding a single endpoint isn't worth the
  regenerate-all-clients cost. When metrics joins genapi.json this
  can collapse into the generated surface without changing the
  wire shape.
- Capability flagging is implicit: the SPA's first fetch either
  returns 200 (cards render) or 503 `METRICS_DISABLED` (cards drop
  out, polling stops). No separate `metrics_enabled` field on
  `/capabilities` — the runtime probe is more truthful since it
  also catches the "GEODE_METRICS_URL set but server is down"
  branch.
