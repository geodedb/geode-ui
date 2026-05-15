# Gap Closure Completion Report -- 2026-05-10

- **Repository:** `devnw/codepros/geode/geode-ui`
- **Branch:** `main`
- **Verifier:** GREEN (all CI gates clean)
- **Run window:** 2026-05-10 single-session gap-close pass

## Summary

| Metric                             | Value                         |
|------------------------------------|-------------------------------|
| Gaps closed (this session)         | **16**                        |
| Gaps deferred (this session)       | **5**                         |
| Per-gap closure commits            | 16 (one per gap)              |
| Deferral rollup commits            | 1 (`77ac64d`)                 |
| Bookkeeping commit (this report)   | 1                             |
| **Total commits this session**     | **18**                        |
| Genapi-paired closures             | 3 (F11, N5, F6+N6)            |
| Build / CI status                  | GREEN -- `make ci` end-to-end |

Verifier rolled up: `make ci` end-to-end pass; Go 17 packages OK; `internal/server` line coverage 74.5% -> 75.7% (+1.2 pp); Jest 375/375 passing; tsc / golangci-lint / eslint clean; `gosec -include=G115 ./gen/...` reports 0 (was >=1 pre-F11).

## Closed by Category

### Requirements (2) -- `docs/GAP_ANALYSIS.md`

| ID       | Title                                                  | Commit    |
|----------|--------------------------------------------------------|-----------|
| GAP-006  | e2e job runtime status in CI verified (pipeline URL recorded) | `4a7ad51` |
| GAP-007  | docker-compose stack-up smoke executed (healthz + /profiles/public 2xx) | `ec270f9` |

### Quality (5) -- `docs/QUALITY_GAP_ANALYSIS.md`

| ID  | Title                                                              | Commit    |
|-----|--------------------------------------------------------------------|-----------|
| Q3  | Package-wide rename of `user*` helpers -> `connDB` / `wireErr` / `respondErr` / `rowToMap` | `dfbe67a` |
| Q6  | Typed-error tier (`errWireFeatureMissing` sentinel + `statusClasser` + pinned substrings) for `isWireFeatureMissing` | `c949e8a` |
| Q7  | `emitAudit` log+continue policy sealed via `defer recover()` to `os.Stderr` (slog-safe) | `3c5c8fe` |
| Q9  | `withConnDBAndIdent(ctx, name, fn)` extracted across 8 user-handler sites | `1b227da` |
| Q10 | `docs/adr/` skeleton (Nygard) + `internal/server/README.md` per-file layout | `bceb198` |

### Performance (2) -- `docs/PERF_GAP_ANALYSIS.md`

| ID  | Title                                                                  | Commit    |
|-----|------------------------------------------------------------------------|-----------|
| F7  | `projectColumns` single-pass inference (N+1 row visits -> exactly 2)   | `7f371fe` |
| F8  | `SchemaExplorer` AbortController + LRU per-graph cache                 | `975cc59` |

### Security (7) -- `docs/SECURITY_GAP_ANALYSIS.md`

| ID      | Title                                                                | Commit                            |
|---------|----------------------------------------------------------------------|-----------------------------------|
| N1      | Adversarial `quoteString` / `quoteIdent` corpus (no escape gap surfaced) | `8a4e96d`                       |
| N4      | Server-side password policy (12+ chars; weak/username/HIBP options)  | `6765e64`                         |
| N5      | `httpx.ValidateConfig` panics on wildcard CORS with credentials       | `0fbccc6` + genapi `df654de`     |
| N10     | Constant-time auth-failure: dummy compare + 250 ms latency floor + struct body | `502a865`                |
| F8-sec  | `dompurify` resolved to >= 3.4 via `npm.overrides` (closes 6+ XSS advisories) | `edbd1d9`                |
| F11     | `gosec G115` real bounds check in `gqlx/subscription.go:readWSFrame`  | `8336a43` + genapi `1033c50`     |
| F6+N6   | Centralised audit redaction in `obsx.LogAudit` + geode-ui key list extension | `cea4fbd` + genapi `e100aed` |

## Deferred (5) -- requires a separate genapi work cycle

All five carry a Deferred status with specific genapi-side prerequisites and are tracked at `genapi#215` / `genapi#216`. Rollup commit: **`77ac64d`**.

| Gap   | File                          | Genapi prerequisite                                                                                       |
|-------|-------------------------------|-----------------------------------------------------------------------------------------------------------|
| F3    | `PERF_GAP_ANALYSIS.md`        | Redesign `cmd/genapi/templates/api.go.tmpl` for chunked Marshal + WriteHeader-then-stream; per-endpoint opt-in. |
| F13   | `PERF_GAP_ANALYSIS.md`        | gzip + pprof + jsontext `sync.Pool` middlewares in `pkg/httpx`; pprof gated by `Observability.EnableDebug`. |
| N7 (remainder) | `SECURITY_GAP_ANALYSIS.md` | Global per-IP rate-limit middleware in `pkg/httpx` keyed on `RemoteAddr` (XFF/XRI/TLS-subject extractor); login surface stays partially-closed via `8e9f5d2`. |
| Q5    | `QUALITY_GAP_ANALYSIS.md`     | `multipart/form-data` request-body schema + `client_react.ts.tmpl` + `client_go_rest.go.tmpl` emitters.   |
| Q8    | `QUALITY_GAP_ANALYSIS.md`     | Schema mechanism for typed lists whose columns are runtime-discovered (SHOW USERS / SHOW PERMISSIONS).    |

## Build Verification

| Command / Gate                             | Result                                                  |
|--------------------------------------------|---------------------------------------------------------|
| `make ci`                                  | PASS (end-to-end)                                       |
| Go test (17 packages)                      | PASS                                                    |
| `internal/server` coverage                 | 74.5% -> **75.7%** (+1.2 pp)                            |
| Jest (`pnpm test`)                         | **375 / 375** passing                                   |
| `tsc --noEmit`                             | clean                                                   |
| `golangci-lint`                            | clean                                                   |
| `eslint`                                   | clean                                                   |
| `gosec -include=G115 ./gen/...`            | 0 (was >=1 pre-F11)                                     |
| Doc rows verified (16 Closed + 5 Deferred) | All present in their `*GAP_ANALYSIS.md` files           |

## Notable Findings During This Run

- **Q3 was package-wide, not file-local.** The original framing tagged `internal/server/handlers_users.go`, but the rename had to land across `errors,handlers_users,handlers_backups,handlers_grants,handlers_policies,handlers_migrations,handlers_roles`. The `user*` prefix had migrated to any handler doing wire-level admin work via `connDB` / `quoteIdent`; the rename followed the actual call graph, not the filename.
- **PSR-G02-followup wire contract was misunderstood by the original e2e plan.** Test plan assumed empty-string PATCH cleared `description` / `saved_username`; the genapi-side change in #124 made these `*string` so absent vs explicit-empty are distinct. The closed e2e specs (`d3c4e4e`, `044ded0`) now distinguish the two and pin pointer-presence semantics.
- **Rate-limit bucket is per-actor, not per-token.** S7 (#120) `profilelimiter.go` keys on the JWT `sub` (or falls back to a per-IP key prefixed `ip\x00` for unauthenticated callers). Reusing the same token from different machines counts against the same bucket, by design -- a single compromised token can't fan-out to evade the limit.
- **Verifier discovered a pre-existing 1-line cosmetic dirty in `e2e/specs/15-profile-api.spec.ts`** that is unrelated to this session's work. Left in place per scope; not cleaned up by the bookkeeping commit. Same for the other pre-existing dirty files (`electron/main.ts`, `e2e/specs/01-auth.spec.ts`, `e2e/specs/02-connection-picker.spec.ts`).
- **Q7's "8 call sites" was historical context, not work.** `emitAudit` had no error return to swallow; the 8 sites needed no change once the policy was sealed inside the helper. Test `TestEmitAudit_LogContinuePolicy` proves the policy via an injecting `panicHandler` slog sink -- a one-test, zero-call-site closure.
- **F8 cancellation is enforced at the React-effect layer, not on the wire.** The generated client (`gen/client/rest.gen.go`) doesn't accept an external `signal`; the abort gate sits in `useEffect` cleanup via `signal.aborted` checks. Structural fix (signal propagation through `fetchImpl`) is a follow-up on the genapi side -- noted in the F8 row and in `GAP_ANALYSIS_RESOLVED.md`.

## Follow-ups for Next Session

### Already deferred this run (need a separate genapi work cycle)

- **F3 (#25)** -- streaming JSON response handler template.
- **F13 (#57)** -- gzip + pprof + jsontext `sync.Pool` middlewares.
- **N7-remainder (#66)** -- structural per-IP global rate-limit middleware.
- **Q5 (#34)** -- typed `multipart/form-data` endpoint emitter.
- **Q8 (#38)** -- typed list responses for runtime-discovered columns (SHOW USERS / SHOW PERMISSIONS).

### Heavy items flagged by the planner but skipped this session

- **F10 (#54)** -- Monaco + Cytoscape code-split. Cross-cuts P-NEW-3 (i18n init on critical path). Estimate 1-2 days; requires Suspense boundaries + webpack chunk tuning + bundle-size budget re-validation (Q-NEW-T2).
- **F12 (#56)** -- `WriteTimeout=60s` caps WS streams. Per-route override needed in `cmd/server/main.go:153`; pairs with per-frame WS deadlines in `ws_query.go`.
- **F18 (#61)** -- driver re-parses queries (suspected). Needs `BenchmarkAuthCheckQuery` (or similar) confirming parse cost > ~20% of total before introducing an LRU statement cache.
- **N2 (#64)** -- JWT revocation set + password-change-triggered revocation. Amplifies the S2 mitigation (currently the only short-term defence against a long-lived seeded session).
- **PSR-F5 (#103)** -- `internal/ui/embed.go` micro-opt (backlog).
- **PSR-F15 (#112)** -- `handlers_profiles.go:43-46` micro-opt (backlog).
