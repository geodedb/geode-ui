# Gap-Close Pipeline -- 2026-05-13

## Scope

User-selected 4 priorities from the 2026-05-13 `/codepros:audit` (run against HEAD `c07668b`):

1. **Land S-NEW-5 (#201)** -- highest-risk security fix in the 2026-05-13 cohort (XFF spoofing -> login-limiter bypass + DoS-by-lockout against arbitrary IPs).
2. **Bundle B quick-wins:** `#220` (limiter global mutex on hot path), `#223` (schema_cache `Mutex` -> `RWMutex`), `#103` / GAP-022 / PSR-F5 (`fs.Stat` per static-asset request).
3. **Bundle C tsconfig consolidation** Q47 / Q52: `#194` (`noImplicitAny:false` strict-mode defeat) + `#195` (duplicate compiler options across web / electron / e2e) + `#196` (ts-jest `isolatedModules` v30 deprecation).
4. **Bundle D `GraphView.tsx` decomposition** Q48: `#192` -- 1982-LOC orchestrator, supersedes Q18 / `#164`'s earlier 1257-LOC framing.

Bundle B remaining perf items (P2/P3 -- #213 / #216 / #217 / #218 / #225 / #219 / #221 / #222) and Bundle B's P0 (#165 `Pool.DB`) were intentionally out of scope for this run.

## Result

**8 closures across 13 commits. Verifier returned PASS on every closure. All 8 GitLab issues closed with evidence comments.**

All commits sit on local `main` ahead of `origin/main`. **Nothing has been pushed.**

## Closures

| SHA | Issue | Type | Brief | Headline impact |
|-----|-------|------|-------|-----------------|
| `6f75a74` | [#201](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/201) (S-NEW-5) | security | `-trust-proxy-xff` flag (default off) gates XFF parsing in `clientIP()` | Auth-limiter-bypass + DoS-by-lockout chain closed; binary operator-opt-in for trusted-proxy deployments |
| `cca498b` | [#220](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/220) (PERF-2026-05-13-06) | perf | `LoginLimiter` + `ProfileLimiter` 2-map `atomic.Pointer[map]` COW design; per-bucket mutex | Hot-path holds zero global locks; `Allow_Parallel` 800.9 -> **9.84 ns/op (~81x)** + 957.4 -> **7.33 ns/op (~131x)** |
| `04a199e` | [#223](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/223) (PERF-2026-05-13-07) | perf | `schema_cache` `sync.Mutex` -> `sync.RWMutex`; expiry-delete re-checks under writer lock | `Get_Parallel` 404.1 -> **92.93 ns/op (~4.3x)**; 0 allocs/op |
| `a3c9552` | [#103](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/103) / GAP-022 / PSR-F5 | perf | `sync.Map` cache of cleaned-path -> `fs.FileInfo` in `internal/ui/embed.Handler()`; positive results only | `BenchmarkEmbedHandler_StaticHit` 10355 -> 9697 ns/op (-6.4%); **-2 allocs/op** (exactly the eliminated `fs.Stat` round trip) |
| `7e5c008` | (doc fixup) | perf docs | Records B3 closure SHA in `PERF_GAP_ANALYSIS.md` | Doc-only; not a code change |
| `1c57b0c` | [#194](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/194) / [#195](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/195) / [#196](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/196) (Q47 / Q52 / Q51) | quality | New `tsconfig.base.json`; web / electron / e2e all `extends` base; `noImplicitAny:false` removed; ts-jest `isolatedModules` moved into inline tsconfig | Strict mode uniformly enforced; ts-jest v30 deprecation warning gone; drift surface across 3 tsconfigs eliminated |
| `a562788` | #194 follow-up | quality | Annotated `Shell.tsx` + `gqlLanguage.ts` parameters for strict mode | `tsc` clean post-Bundle-C |
| `ac486ad`, `ff130d2`, `9c46ae8`, `0a4f36b`, `eb3a910`, `6b45ac5` | [#192](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/192) (Q48) | quality | 6-commit seam decomposing `src/components/results/GraphView.tsx` across 11 new modules under `src/components/results/graph/` | **1982 LOC -> 396 LOC**; public contract preserved; `GraphView.test.tsx` + `ResultPanel.test.tsx` pass unchanged |

## Coverage deltas (per package, before/after)

| Package | Before | After | Delta |
|---|---|---|---|
| `internal/server` | 78.3% | 78.8% | **+0.5pp** |
| `internal/ui` | 86.1% | 87.6% | **+1.5pp** |
| `internal/conn` | unchanged | unchanged | 0 |
| `internal/jwt` | unchanged | unchanged | 0 |
| `internal/profilestore` | unchanged | unchanged | 0 |
| jest (SPA) | 540/540 | 540/540 | 0 (file moves under `GraphView.tsx` split kept all suites green; no test count change) |

## Benchmark deltas (Bundle B)

The bench numbers on this run were the headline outcome: three hot paths shrank by 4x-131x without changing the public contract.

| Bench | Baseline | After | Speedup | Allocs |
|---|---|---|---|---|
| `BenchmarkLoginLimiter_Allow_Parallel` | 800.9 ns/op | **9.84 ns/op** | **~81x** | 0 -> 0 |
| `BenchmarkProfileLimiter_Allow_Parallel` | 957.4 ns/op | **7.33 ns/op** | **~131x** | 0 -> 0 |
| `BenchmarkSchemaCache_Get_Parallel` | 404.1 ns/op | **92.93 ns/op** | **~4.3x** | 0 -> 0 |
| `BenchmarkEmbedHandler_StaticHit` (full HTTP path) | 10355 ns/op, 3420 B/op, **19 allocs/op** | 9697 ns/op, 3388 B/op, **17 allocs/op** | -6.4% wall, **-2 allocs/op** | -2 (exactly the eliminated per-request `fs.Stat` calls) |

Race pinning: `TestLoginLimiter_ConcurrentInsertRace`, `TestProfileLimiter_ConcurrentInsertRace`, `TestSchemaCache_ConcurrentReadersAndWriters` -- all clean under `-race -count=10`.

Cache-bound pinning: `TestEmbedHandler_CachesStat` (counts Stat calls via `countingFS`) + `TestEmbedHandler_DoesNotCache404` (404 paths re-Stat every call, so attacker-shaped URLs cannot grow the map unboundedly).

## Tests executed

| Command | Result |
|---|---|
| `make go-test` (`-race`) | PASS (`internal/server` 78.8%, `internal/ui` 87.6%) |
| `go test -race -count=10 ./internal/server -run 'Limiter_ConcurrentInsertRace\|SchemaCache_ConcurrentReadersAndWriters'` | PASS (race-pinning suite for #220 / #223) |
| `make go-lint` | PASS (0 issues) |
| `make generate` | PASS (idempotent) |
| `make bench-gate` | PASS (`PERF GATE OK`) |
| `make bench` (PERF-cohort comparison) | PASS -- deltas recorded in PERF_GAP_ANALYSIS.md closure-run table |
| `npm test` (jest) | PASS (540/540) |
| `npm run test:ts` | PASS (strict mode clean after `1c57b0c` + `a562788`) |
| `npm run lint` | PASS |
| `npm run prettier:check` | PASS |

## Working tree at completion

- **Branch:** `main`, 14 commits ahead of `origin/main` (the 13 closure commits + the docs-tracking commit `0e392ee` that landed this completion report's tracking-doc updates -- this report itself adds a 15th).
- **Push status:** **Nothing pushed.** The user decides on `git push origin main`.
- **Unpushed commits (in order):**

  ```text
  0e392ee  docs(gap): mark 8 closures resolved in 2026-05-13 gap-close pipeline run
  a562788  fix(build): annotate gqlLanguage parameter -- Bundle C follow-up for #194
  6b45ac5  refactor(graph): extract useGraphElements + finalize <400 LOC orchestrator -- closes #192
  eb3a910  refactor(graph): extract GraphSidebar
  0a4f36b  refactor(graph): extract GraphToolbar
  9c46ae8  refactor(graph): extract GraphInspector from inline SelectedInspector
  ff130d2  refactor(graph): extract useFillHeight hook
  ac486ad  refactor(graph): extract useGraphPathMode hook from GraphView
  1c57b0c  refactor(build): close #194 #195 #196 -- consolidate tsconfig via tsconfig.base.json, drop noImplicitAny loophole
  7e5c008  docs(perf): record B3 closure SHA in PERF_GAP_ANALYSIS
  a3c9552  perf: close #103/GAP-022 -- cache embed FS Stat for static asset hits
  04a199e  perf: close #223 -- RWMutex on schema_cache for concurrent reads
  cca498b  perf: close #220 -- 2-map limiter design removes global mutex from hot path
  6f75a74  fix(security): close S-NEW-5 (#201) -- gate XFF parsing behind -trust-proxy-xff flag
  ```

- **Working tree:** clean except for two pre-existing untracked items unrelated to this run -- `.scratch/` (developer scratch dir, gitignored conceptually) and `docs/superpowers/plans/2026-05-13-geode-0-5-15-auth-ddl-integration.md` (the next planning artifact for the Geode v0.5.15 auth-DDL integration thread, see "What's next" below).

## GitLab issues closed

| Issue | Closure SHA | Comment posted |
|---|---|---|
| [#201](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/201) (S-NEW-5) | `6f75a74` | `-trust-proxy-xff` flag (default off); 2 new unit tests pass under `-race`; README + `SECURITY_GAP_ANALYSIS.md` updated |
| [#220](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/220) | `cca498b` | 2-map `atomic.Pointer` COW; ~81x / ~131x faster; `-race -count=10` clean |
| [#223](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/223) | `04a199e` | `RWMutex` on schema_cache; ~4.3x faster; new race-pinning test under `-race -count=10` |
| [#103](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/103) (GAP-022 / PSR-F5) | `a3c9552` | `sync.Map` positive-only Stat cache; 404s NOT cached; -2 allocs/op |
| [#194](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/194) (Q47) | `1c57b0c` + `a562788` | `tsconfig.base.json`; `noImplicitAny:false` removed; Shell.tsx + gqlLanguage.ts annotated |
| [#195](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/195) (Q52) | `1c57b0c` | `tsconfig.base.json` shared by web / electron / e2e configs |
| [#196](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/196) (Q51) | `1c57b0c` | ts-jest v30 deprecation warning eliminated; `isolatedModules` moved into inline tsconfig |
| [#192](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/192) (Q48) | `ac486ad..6b45ac5` (6 seam commits) | `GraphView.tsx` 1982 -> 396 LOC; 11 new modules under `src/components/results/graph/`; tests pass unchanged; public contract preserved |

## Tracking-doc updates landed in `0e392ee`

| File | Action |
|---|---|
| `docs/GAP_ANALYSIS.md` | Marked GAP-022 / #103 closed; added "Closure batch 2026-05-13 (gap-close pipeline run)" sub-section enumerating the 8 closures by SHA; updated header `Last refreshed` + executive-summary lead-in |
| `docs/GAP_ANALYSIS_RESOLVED.md` | Appended "Closure batch 2026-05-13 (gap-close pipeline run)" block with one detail entry per closure (issue, domain, commit, resolution, evidence, files, resolved-date); added 2026-05-13 bullet to the recent-runs list |
| `docs/SECURITY_GAP_ANALYSIS.md` | Added commit SHA `6f75a74` to the S-NEW-5 status cell and the "immediate actions" line |
| `docs/PERF_GAP_ANALYSIS.md` | Updated the 2026-05-13-cohort severity summary table from 14 open / 0 closed -> 11 open / 3 closed; updated `Last updated` line; closure-run table at the bottom of the file already carried the SHAs from the implementer |
| `docs/QUALITY_GAP_ANALYSIS.md` | Added commit SHAs to Q47 / Q48 / Q51 / Q52 status cells; updated `Last updated` line |

## Security notes

- **No new credentials, secrets, or keys touched** by this run.
- **S-NEW-5 (#201) closure is operator-opt-in.** The `-trust-proxy-xff` flag defaults `false`. Deployments that previously relied on `X-Forwarded-For` for per-IP attribution must explicitly set the flag at startup; otherwise both limiters now key on `RemoteAddr` host portion. This is a hardening default change -- documented in `README.md` + `docs/SECURITY_GAP_ANALYSIS.md`. The trusted-proxy-CIDR enforcement is intentionally out of scope and remains a follow-up if multi-hop XFF parsing on the trusted path proves insufficient.
- **No regression** on F2 (#58 login rate-limit) or N2 (#64 JWT revocation) -- both rely on the same `clientIP()` path that S-NEW-5 hardened; their existing race / restart-survival tests still pass.
- **#220 / #223 closures preserve correctness contracts.** The 81x / 131x / 4.3x speedups came from removing redundant global locking, not from weakening any invariant. The per-bucket mutex in `LoginLimiter` / `ProfileLimiter` still serializes `tokens` / `last` / `count` / `lastFail` mutations on a single bucket. The `schemaCache` writer lock is still acquired on the expiry-delete branch with a re-check to avoid racing a concurrent `set()`.
- **#103 / GAP-022 closure does NOT cache 404s.** `TestEmbedHandler_DoesNotCache404` pins this so attacker-shaped URLs (e.g. fuzzing `/assets/x.<random>`) cannot grow the `sync.Map` unboundedly.

## What's next

- **Geode v0.5.15 auth-DDL integration** -- planning artifact at `docs/superpowers/plans/2026-05-13-geode-0-5-15-auth-ddl-integration.md` (untracked at the time of this report; the next chunk of feature work).
- **Bundle B remaining perf items (P2/P3) not closed in this run** -- can be picked up in a future iteration:
  - **P1 still open:** PERF-2026-05-13-10 (#213, Workspace 4-pane Monaco/WS always-on), PERF-2026-05-13-09 (#216, MatrixView dense N x N DOM), PERF-2026-05-13-03 (#217, scanQueryResult per-row Marshal).
  - **P2 still open:** PERF-2026-05-13-08 (#218, WS goroutines), PERF-2026-05-13-NEW (#225, unbounded limiter map TTL janitor), PERF-2026-05-13-04 (#219, column-meta Marshal), PERF-2026-05-13-06-followup (#221, driftSeen RWMutex).
  - **P3 still open:** PERF-2026-05-13-12 (#222, F9 coalesce contract).
  - **P0 re-confirmed:** PERF-2026-05-13-01 (#165, `Pool.DB` global mutex) -- highest-PerfScore item still open.
- **Pre-existing `schema_cache` test-infra flakiness** -- `TestSchemaCache_*HitDoesNotQueryDB` family has a process-scoped `sql.Register` that makes `-count>1` unstable regardless of cache locking. **Unrelated to #223** (the new `TestSchemaCache_ConcurrentReadersAndWriters` is clean under `-race -count=10`). If we hit this in CI as a separate finding, it gets its own issue.
- **Remaining Q items in 2026-05-13 cohort:** Q49 (#193, `newApp` 317 LOC split), Q-NEW-A..I (#197..#208 / #214 / #215), Q53 (#198). None re-validated as resolved by this run.

## Remaining blockers

None for this run. All 8 closures were accepted by the verifier and all 8 issues closed cleanly with evidence comments. The only outstanding action is `git push origin main` -- left to the user per repo convention.
