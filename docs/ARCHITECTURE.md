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

### Per-route rate limit on `/api/v1/query`

- The `/api/v1/query` per-route rate limit is set to `2000` rps in
  `geode.json` (matching the assumed steady-state target above), pinned by
  `internal/server/query_ratelimit_test.go`. The per-route token bucket is
  a ceiling on *this* route; the genapi-emitted handlers do not currently
  wire `GlobalRate` / `global_rps` as a cross-route aggregate limit
  (`APIOptions.GlobalRate` is populated from config but unused in
  `RegisterGeneratedAPI`), so the only other server-side throttle in play
  is the per-IP limiter (`PerIPRPS`, per-IP not aggregate). If a future
  workload review needs `/api/v1/query` capped lower, change the spec
  value and regenerate; if it needs a real global aggregate ceiling, that
  is a genapi-generator change. (Resolved 2026-05-12, #159 — was a
  documented open question; the per-route value is now aligned to the SLO.)

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
