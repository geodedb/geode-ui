# Gap Closure Completion Report -- 2026-05-12 (genapi + medium-cohort batch)

- **Repository:** `devnw/codepros/geode/geode-ui`
- **Branch:** `main` (9 implementation commits + 1 docs-tracking commit, **unpushed**)
- **Companion repo:** `~/src/devnw/go/genapi` -- `main`, 5 commits ahead of origin, **unpushed**
- **Platform:** GitLab (`glab` as `benjiv`)
- **Verifier:** ACCEPTED -- full suite green in both repos (`make go-test -race`, `make go-lint`, `make generate` clean, `npm test` 453/453, `make bench-gate`); no regressions
- **Run window:** 2026-05-12 `/codepros:gap-close` -- landed the upstream-genapi follow-ups deferred from the 2026-05-11 run (F-AUTH-1 #132, F-AUTH-2 #135, F5/PERF-2026-05-11-03 #133, Q02 #90 -- all needed a genapi change) plus a medium in-repo cohort (PERF-2026-05-11-06 #142, -09 #150, -10 #154, -11 #156; Q27 #173)
- **Companion docs:** [SECURITY_GAP_ANALYSIS.md](../SECURITY_GAP_ANALYSIS.md), [PERF_GAP_ANALYSIS.md](../PERF_GAP_ANALYSIS.md), [QUALITY_GAP_ANALYSIS.md](../QUALITY_GAP_ANALYSIS.md), [GAP_ANALYSIS.md](../GAP_ANALYSIS.md), [GAP_ANALYSIS_RESOLVED.md](../GAP_ANALYSIS_RESOLVED.md#2026-05-12-closure-run----genapi--medium-cohort-batch-9-closed--159-deferred-9-geode-ui-commits--5-genapi-commits); prior runs: [2026-05-11-audit-cohort-completion.md](./2026-05-11-audit-cohort-completion.md), [2026-05-11-followup-completion.md](./2026-05-11-followup-completion.md), [2026-05-11-completion.md](./2026-05-11-completion.md), [2026-05-10-completion.md](./2026-05-10-completion.md)

## Summary

| Metric | Value |
|---|---|
| GitLab issues closed | **9** -- #132, #135, #133, #142, #150, #154, #156, #173, #90 |
| GitLab issues commented-but-left-open | **1** -- #159 (`/api/v1/query rateLimit=200` vs ~2000-rps target -- awaiting product decision) |
| GitLab issues commented (cross-reference, not closed) | **2** -- #48 (`src/components/ops` now ~92% covered), #156-adjacent perf issues (the `make bench-gate` infra now exists) |
| geode-ui implementation commits | **9** on `main`, unpushed: `4002c6f` (#132), `1ec9889` (#135), `8af76ca` (#133), `9b0a423` (#90), `203a454` (#142), `9c39d57` (#150), `6e6db14` (#154), `2aaaebc` (#173), `e877465` (#156) + **1** docs-tracking commit (this report + the 5 `*GAP_ANALYSIS*.md` updates) |
| genapi commits | **5** on `main`, unpushed: `1ffa8eb` (artifact refresh), `e01b2de` (#132 mcpx ctx threading), `30fad5d` (#135 mcpx role gate), `09d4ac8` (#133 obsx buffered logging), `55c79d2` (#90 client/react expandPath) |
| Build / test status | GREEN (verifier ACCEPTED) -- both repos |
| Pushed? | **No** -- neither repo. The user decides on pushing geode-ui and on pushing/tagging genapi (genapi changes are breaking -> minor bump; see caveat below) |

## GAP_ANALYSIS status

| File | Closed (this run) | Commented-open | Remaining open (cohort) | Cohort total |
|---|---|---|---|---|
| `SECURITY_GAP_ANALYSIS.md` (Audit-2026-05-11 cohort) | 2 -- F-AUTH-1 #132, F-AUTH-2 #135 | 0 | 4 -- F-SUP-2 #72, F-SUP-3 #153, F-INPUT-2 #143, F-SUP-5 #161 | 9 (all 3 release-blockers/mitigations now fully resolved across the two closure runs) |
| `PERF_GAP_ANALYSIS.md` (Audit-2026-05-11 cohort) | 5 -- PERF-2026-05-11-03 #133, -06 #142, -09 #150, -10 #154, -11 #156 | 1 -- PERF-2026-05-11-12 #159 (on product) | 7 -- #139, #145, #165 (in-repo) + #163, #167, #169, #171 (upstream genapi) | 17 |
| `QUALITY_GAP_ANALYSIS.md` (Phase 4 + PSR cohorts) | 2 -- Q02 #90, Q27 #173 | 0 | ~24 (rest of the Phase 4 cohort) | -- |
| `GAP_ANALYSIS.md` | 1 -- GAP-020 (#90) | 0 | 7 Low (GAP-013..019, 021, 022; GAP-013..016 upstream-blocked) | 8 |
| `GAP_ANALYSIS_RESOLVED.md` | +9 resolved entries appended (2 security, 5 perf, 2 quality) | -- | -- | -- |

**Overall:** 9 closed, 0 blocked-without-path, 1 deferred-on-product (#159) this run. Cumulatively, the Audit-2026-05-11 security cohort is now fully clear of release-blockers (F-AUTH-1 #132 + F-SUP-1 #148 both fixed; F-AUTH-2 #135 mechanism landed); the perf cohort is 9-of-17 closed with only #159 deferred-on-product.

## Closed items

| GitLab # | Domain / ID | Title | Commit(s) | Evidence |
|---|---|---|---|---|
| #132 | Security / F-AUTH-1 (release-blocker -> cleared) | MCP `query` tool drops JWT `profile` claim -- cross-profile data access | `4002c6f` (geode-ui) + genapi `e01b2de` (+ `1ffa8eb` precursor) | genapi threads `context.Context` through the MCP tool path -- `mcpx.Tool` ctx param, `MCPServerInterface.Query(ctx, params)`, `mcpx.SetAuthVerifier func(*http.Request)(context.Context,error)`. geode-ui: `internal/server/mcp.go` `MCPServer.Query(ctx, params)` -> `handleQuery(ctx, params)`; the per-goroutine stash (`mcpQueryContext`/`mcpRequestCtx`/`goID`/`WrapMCPHTTP`) is deleted; `MCPAuthVerifier` runs `AuthJWT` (mutates `*r`) and returns `r.Context()` (carries `profileCtxKey`/`rolesCtxKey`); `gen/mcp/tools.gen.go` `Query(ctx,...)`, `gen/pkg/mcpx/engine.go` `Tool` ctx param. Pinned by `internal/server/mcp_profile_test.go` -- `TestMCPQuery_CrossProfileIsolation`/`AppliesProfileClaim`/`AuditAttributedToJWTProfile`/`NoTokenFallsBackToDefault` (native path). The in-repo mitigation `c46e77e` is fully superseded. |
| #135 | Security / F-AUTH-2 | MCP layer has no per-tool role enforcement | `1ec9889` (geode-ui) + genapi `30fad5d` | genapi `mcpx.ContextWithRoles`/`RolesFromContext`/`SetToolRoles` + a `handleRaw` gate (no roles in ctx + tool requires a role -> audit + JSON-RPC `-32000 "insufficient role"`, tool body never runs) + `mcpToolRoles` template emission. geode-ui `geode.json` `query` tool deliberately declares **NO** required role (matches the `POST /api/v1/query` REST route, which has none) so behavior is unchanged; `internal/server/mcp.go` re-publishes JWT roles via `mcpx.ContextWithRoles(ctx, rolesFromContext(ctx))`. Upstream genapi tests cover sufficient/insufficient/none-declared. |
| #133 | Perf / PERF-2026-05-11-03 (F5) | obsx.LogAudit per-request map literal + redact clone + unbuffered stdout (355 call sites) | `8af76ca` (geode-ui regen + wiring) + genapi `09d4ac8` | genapi `pkg/obsx/log.go` (`bufio.Writer` 64 KiB over stdout, `FlushLogs()` exported, 100 ms flush ticker, single `Write` per record under `logMu`, pre-scan skips the redact-clone when no sensitive key; crash-loss tradeoff commented) + `log_hooks.go` (pooled `[]any` slog args) + `bench_test.go` (`BenchmarkLogAudit`: 8->7 allocs/op, ~23% smaller B/op on the clean case) + `templates/server.go.tmpl` (generated `Serve()` defers `obsx.FlushLogs()`). geode-ui regen `gen/pkg/obsx/`; `cmd/server/app.go` `defer obsx.FlushLogs()` in `run` + eager flush on fatal-init/serve-error paths. 355 `obsx.LogAudit` call sites unchanged. (Out of scope: pooling the caller-built `map[string]any` literals at those sites -- needs an obsx API change.) |
| #142 | Perf / PERF-2026-05-11-06 | defaultAuditRing single mutex + full-ring snapshot per audit poll | `203a454` | `internal/server/audit.go` `snapshot` rewritten to a two-pass count-then-copy (`cap == matchCount`, not `cap == r.count` -- saves ~560 KiB per `/api/v1/audit` poll on a near-full 10k ring); `handlers_audit.go` already marshals JSON after `snapshot` returns. Did NOT shard (bench: append latency is mutex-handoff-bound, not alloc-bound). Tests: `audit_test.go` +`TestAuditRing_SnapshotSinceExact`, `TestAuditRing_SnapshotSinceUnderConcurrentAppend` (`-race`), `BenchmarkAuditRing_ConcurrentAppendSnapshot` (~25% less per-op churn). |
| #150 | Perf / PERF-2026-05-11-09 | Profile-SQLite `SetMaxOpenConns(1)` shared with JWT revocation | `9c39d57` | `internal/profilestore/sqlite.go` opens a second `*sql.DB` (`file:<path>?mode=ro&_pragma=busy_timeout(5000)`, `SetMaxOpenConns/IdleConns = max(2, GOMAXPROCS)`); `DBHandleRO()` added to `DBHandleProvider`; `Close()` closes both (aliases to writer for in-memory DBs); `internal/jwt/revocation.go` `AttachSQLiteRW(rw, ro)` (`AttachSQLite(db)` preserved as `AttachSQLiteRW(db,db)`); `cmd/server/app.go` wires `DBHandle()`+`DBHandleRO()`; `mode=ro` enforced (test asserts RO handle rejects writes). `-race` concurrency tests (8xN RO reads vs CRUD/Revoke churn -- no deadlock); `BenchmarkRevocationReloadUnderWrite`. |
| #154 | Perf / PERF-2026-05-11-10 | LabelList/EdgeTypeList -- no shared cache, no AbortController | `6e6db14` | new `src/components/schema/schemaCache.ts` (bounded LRU keyed `kind:graph`, shared by all four schema reads); `SchemaExplorer.tsx` migrated onto it via a pair-accessor shim (F8 tests still pass); `LabelList.tsx`/`EdgeTypeList.tsx` cache-hit synchronously + arm a fresh `AbortController` per graph change (gating `setState` on `signal.aborted`). `LabelList.test.tsx`/`EdgeTypeList.test.tsx` +6 cases (re-select zero wire calls, mid-flight abort, LRU eviction). Comment cites the #128 server-side cache as the cold-miss backstop. |
| #156 | Perf / PERF-2026-05-11-11 | No CI perf gate, no documented SLOs | `e877465` | `Makefile` `bench-gate`/`bench-baseline`/`bench-record` targets; `scripts/bench-gate.sh` (benchstat gate, `-bench=. -benchmem -run='^$' -benchtime=100ms -count=6` over the curated bench-bearing packages, fails on >10% regression in any metric -- self-verified via perturb-and-fail); `.gitlab-ci.yml` `bench-gate` job (`allow_failure: true`, informational-leaning given CI noise); `bench-baseline.txt` at repo root (generated post-#142/#150); `docs/ARCHITECTURE.md` "Performance SLOs (assumed, pending real telemetry)" section (~2000 rps `/api/v1/query`, ~400 burst, result-set distribution, upstream p50 ~10 ms, 400+-node graph, webpack bundle budget -- all marked assumed-not-measured) + the **#159 open question** + pprof-gated-behind-`Observability.EnableDebug` note + baseline-refresh instructions. `geode.json rateLimit` unchanged. |
| #173 | Quality / Q27 | `src/components/ops` 28% coverage on data-destructive pages | `2aaaebc` | new `BackupPage.test.tsx` (8) / `MigrationsPage.test.tsx` (9) / `RestorePage.test.tsx` (6) -- confirm-modal flows, error-envelope rendering in `role="alert"`, wire-feature-missing 501 banner + disabled controls, happy/empty list states. `src/components/ops` line coverage **28% -> 91.87%** (Backup 92.5%, Migrations 95.3%, Restore 100%). No coverage gate added (Q14/#48 owns that -- separate, still open). |
| #90 | Quality / Q02 / GAP-020 | `as unknown as` path-param casts in `src/api/profiles.ts` (was 5) | `9b0a423` (geode-ui) + genapi `55c79d2` | genapi `client_templates.go` + `client_react.ts.tmpl` + `client_go_rest.go.tmpl` -- `expandPath`/`expandRoute` now map URL path tokens to snake_case schema keys (`[["profileId","profile_id"]]`), read `payload[schemaKey]`, substitute `{token}` (still `encodeURIComponent`'d), `delete payload[schemaKey]` before sending the body. geode-ui `geode.json` `UpdateProfileReq` gains required `profile_id`; regen `gen/`; `src/api/profiles.ts` `updateProfile`/`deleteProfile` call the typed client directly (no cast). Upstream `cmd/genapi/path_params_test.go` cases added. (`createProfile`'s `as any` body cast is a *different* cast -- out of scope; small follow-up, not yet ticketed.) |

## Won't Do items

None this run.

## Blocked / deferred items

| GitLab # | Domain / ID | Title | Blocker | Unblock steps |
|---|---|---|---|---|
| #159 | Perf / PERF-2026-05-11-12 | `/api/v1/query rateLimit=200` vs documented ~2000-rps target | **Product decision** -- whether 2000 rps is the budget for `/query` specifically, or 200 is intentional | (1) Product confirms the target rps for `/api/v1/query`; (2) if ~2000, raise `geode.json:53 rateLimit` and re-validate F11 pool sizing under load; (3) if ~200, document the rationale and right-size F11 pool down. Now documented in `docs/ARCHITECTURE.md` (Performance SLOs section) as an explicit open question; `geode.json rateLimit` deliberately unchanged. **Not closed.** |

## Tests executed (verifier-reported, both repos)

| Command | Result |
|---|---|
| `make go-test` (`-race`) -- geode-ui + genapi | PASS (full suites green, no regressions) |
| `make go-lint` -- geode-ui | PASS |
| `make generate` -- geode-ui | PASS (clean -- regenerated `gen/` matches the new genapi output) |
| `npm test` -- geode-ui | PASS (453/453) |
| `make bench-gate` -- geode-ui | PASS (no >10% regression vs `bench-baseline.txt`) |

## Security notes

- **F-AUTH-1 (#132) fully resolved** -- the cross-profile-data-access concern (the closest thing to an immediate security issue in the Audit-2026-05-11 cohort, and JWT-gated) is now closed by natively threading the verified request context through the generated MCP path; the per-goroutine stash that the 2026-05-11 mitigation introduced is **deleted**. Pinned by `mcp_profile_test.go` against the native path.
- **F-AUTH-2 (#135) mechanism landed** -- per-tool role enforcement now exists in the MCP dispatch (genapi `mcpx` + `handleRaw` gate). The `query` tool deliberately keeps a **no-role policy** because the analogous `POST /api/v1/query` REST route has none -- behavior is unchanged; the mechanism is in place for any future tool that needs a role gate.
- **Both original release-blockers (F-AUTH-1 #132, F-SUP-1 #148) are now fully resolved** across the 2026-05-11 and 2026-05-12 closure runs.
- No production credentials leaked; no active RCE path identified.

## genapi caveat (BREAKING -- flag in the genapi release notes)

The 5 genapi commits sit on genapi `main` ahead of origin, **unpushed** -- the user decides on pushing/tagging genapi:

| genapi commit | What it does |
|---|---|
| `1ffa8eb` | artifact refresh (precursor to the ctx-threading change) |
| `e01b2de` | #132 -- thread `context.Context` through the MCP tool dispatch path |
| `30fad5d` | #135 -- per-tool role enforcement in MCP dispatch |
| `09d4ac8` | #133 -- single-write buffered audit log; pooled redaction + slog args; skip-clone-when-clean |
| `55c79d2` | #90 -- `expandPath` maps path tokens to snake_case schema fields (genapi#216) |

`e01b2de` and `30fad5d` are **breaking changes** to genapi's `mcpx.Tool` / `MCPServerInterface` / `SetAuthVerifier` API -> **the next genapi release should be a minor version bump**. Other genapi consumers (notably `devnw.dev/oidc`) must:

1. regenerate against the new genapi;
2. update their `MCPServerInterface` implementations to the new `ctx`-carrying signatures (`Query(ctx, params)`, the `mcpx.Tool` ctx param, the `func(*http.Request)(context.Context,error)` auth-verifier signature);
3. add a `defer obsx.FlushLogs()` on shutdown (genapi `09d4ac8` makes the audit log buffered -- without the flush, the tail of the audit log can be lost on a clean exit).

## Remaining blockers

- **#159** -- deferred on a product decision (see the table above). This is the only item in scope this run that did not close, and it is intentional.

## Follow-up notes

- **`createProfile`'s `as any` body cast** (`src/api/profiles.ts`) -- a different cast from the path-param casts Q02 closed (this one is the request-body shape, not a URL path token). Small follow-up; file it under the export-surface / api-contract cleanup if a convention exists, otherwise it is noted in `QUALITY_GAP_ANALYSIS.md`. Not ticketed yet.
- **In-repo mitigation `c46e77e` superseded** -- the per-goroutine MCP-context stash is removed entirely by `4002c6f`.
- **Cross-reference comments posted (issues not closed):** #48 (coverage gate -- `src/components/ops` is now ~92% covered, the bulk of what Q27/#173 worried about), and a note on #156-adjacent perf issues that `make bench-gate` infra now exists for any other perf issue that wants to lean on it.

## Handoff

**10 geode-ui commits (9 implementation + 1 docs-tracking) sit on `main` unpushed; 5 genapi commits sit on genapi `main` unpushed. Neither repo has been pushed. The user decides on pushing geode-ui and on pushing/tagging genapi** -- and the genapi push, when it happens, should be a **minor version bump** with release notes flagging the `mcpx`/`SetAuthVerifier` API break and the required `defer obsx.FlushLogs()` for downstream consumers (`devnw.dev/oidc`).
