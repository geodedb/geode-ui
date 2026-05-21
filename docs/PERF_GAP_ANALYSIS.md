# Performance Gap Analysis

Last updated: 2026-05-21 (gap-close pass — 3 of the 14 `PERF-2026-05-21-*` cohort items CLOSED in this session: `PERF-2026-05-21-01` bench-gate meta-blocker via `1434177` (5 hot-path benches + flip `allow_failure: false`), `PERF-2026-05-21-02` SPA shared-clock via `e581d62` (`src/lib/usePollingClock.ts` hub + 3 callsite refactor), `PERF-2026-05-21-03` `*http.Transport` singleton via `28972a7` (`internal/server/http_transport.go` + metrics + HIBP). 11 `PERF-2026-05-21-*` items remain OPEN.)

Previous: 2026-05-21 (audit Phase 4 — /codepros:audit 2026-05-21 perf-review pass, **--skip-issues** mode: no GitLab writes performed. 14 cadence rows added/updated against the 2026-05-21 inputs (`docs/audits/2026-05-21/perf-context.md`, `perf-scan.md`, `perf-review.md`). Severity distribution from the reviewer: P0=0, P1=4, P2=7, P3=6 (17 findings total: 13 from scan + 3 net-new from reviewer + bench-coverage gap split out). Three OPEN P2 carry-overs from the 2026-05-19 cohort (#294, #302, #306) **REVERIFIED 2026-05-21** — code paths unchanged on `main` (HEAD `1199648`). **META-BLOCKER:** `bench-gate` job remains `allow_failure: true` AND five hot-path benches are missing (`BenchmarkParseProm`, `BenchmarkProjectSnapshot`, `BenchmarkHandleMetrics`, `BenchmarkLspFrameReader*`, `BenchmarkHibpHasSeen`). Until that combination is resolved, every `confidence::suspected` finding below stays invisible to MR review — the bench-gate is the single highest-leverage closure. See "Phase 4 (2026-05-21) Findings" section below for the full table and "Meta-Blocker (2026-05-21)" call-out for the cohort-order rationale.)

Previous: 2026-05-19 (closure cohort — /codepros:gap-close round-4 deferred-items follow-up: the three perf items deferred earlier in the round-4 cohort are now Closed. #316 lazy-load cytoscape plugins → `3259dab` (cxtmenu/lasso/navigator dynamic-imported with promise-cached module loader; new chunks ~10-11 KiB each; ~30 KiB save on the never-opt-in path — the audit's 1-2 MiB projection was over-optimistic because the bulk of `2749.*.js` is cytoscape core + fcose + dagre + spread which are NOT opt-in; see "Bundle-delta correction" below). #297 WS JSON.parse offloaded to a Web Worker → `e085a7f` (`src/lib/queryStreamWorker.ts` + URL helper + main-thread fallback). #291 layoutWorker positions posted as transferable Float32Array → `86e0463` (zero-copy postMessage; main thread reconstructs id-by-index map). All 7 PERF-2026-05-19-* items are now Closed. See `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-19" for evidence.)

Previous: 2026-05-19 (closure cohort — /codepros:gap-close round-4 against the 2026-05-19 audit Phase 4 surface: PERF-2026-05-19-06 / #312 Closed via `e42a92c` (bench harness gaps). Three perf items (#316 lazy-load cytoscape plugins, #297 WS parse worker, #291 layoutWorker transferable Float32Array) deferred to next session — clean tree, context budget. 6 of 7 2026-05-19 perf items remain Open. See `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-19" for evidence.)

Previous: 2026-05-19 (Phase 4 — /codepros:audit 2026-05-19 cohort: 7 new perf issues filed against the graph layout/worker, WS protocol, bench harness, and bundle-bloat surfaces uncovered by the 2026-05-19 perf-smoke bench. See "Phase 4 (2026-05-19) Findings — Newly Opened" section below.)

Previous: 2026-05-17 (Phase 5 — /codepros:gap-close round-3 cohort: PERF-N1 #275 (`a37caa3`), PERF-N3 #278 (`a1a1313`), PERF-N4 #281 (`912be6d`), PERF-N5 #284 (`5a052b8`), PERF-N6 #285 (`f8ed2f2`), PERF-N7 #286 (`f2b8566`), CO-242 NFKC corpus on #242 (`5e54315`), CO-259 brotli on #259 (`43eb1ef`), GAP-035 baseline rotation #276 (`42d3664`). All seven new Phase-4 findings closed plus two carry-overs. Detail in `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-17 (audit Phase 5 — /codepros:gap-close round-3 cohort)" section.)

Scope: app code, generated clients/servers, Go backend, React/Electron UI, CI/CD, Docker/release config, scripts, and performance-relevant docs. This review is non-destructive; product code was not changed.

## Summary

- **2026-05-21 audit Phase 4 (`--skip-issues` mode):** 14 cadence rows added (`PERF-2026-05-21-01..14`) against the perf-context / perf-scan / perf-review inputs. **No GitLab writes.** All 14 are in OPEN state; cadence IDs are reserved for the follow-up issue-creation pass.
- **2026-05-21 severity distribution:** P0=0; P1=4 (PERF-2026-05-21-01 bench-gate meta + -02 SPA shared-clock + -03 http.Transport + -04 lspFrameReader); P2=7 (-05/-06/-07/-08/-09 + carry-overs #294/#302/#306); P3=4 (-10/-11/-12/-13); Info=1 (-14). Reviewer pass surfaced **3 net-new findings** (Sparkline memoization, no `http.Transport` tuning in tree, `pushSynthesisedRows` two-pass) and upgraded **3 scanner findings P2 → P1** (F-FE-1 shared-clock, `lspFrameReader`, bench-gate `allow_failure:true`).
- **Carry-over reverification (2026-05-21):** #294 layoutCache.get clone, #302 WS protocol JSON-only, #306 streamRowsOverWS sequential — all three OPEN P2 items REVERIFIED on HEAD `1199648`. Code paths unchanged. See updated status cells in the "Phase 4 (2026-05-19) Findings — Newly Opened" table.
- **META-BLOCKER:** `bench-gate` CI job is `allow_failure: true` (`.gitlab-ci.yml:472-473`) AND five hot-path benches are missing (`BenchmarkParseProm`, `BenchmarkProjectSnapshot`, `BenchmarkHandleMetrics`, `BenchmarkLspFrameReader*`, `BenchmarkHibpHasSeen`). Until both halves are resolved, every `confidence::suspected` finding stays invisible to MR review. **Tracked as `PERF-2026-05-21-01` at PerfScore 100, P1 — the single highest-leverage closure in the cohort.**
- Prior cohort: Open performance/scalability gaps tracked in the 2026-05-19 update: 0. All 7 Phase 4 (2026-05-19) perf items closed by the round-4 cohort. See `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-19" for evidence.
- New GitLab issues created in this Phase 4 pass (2026-05-17): 6 — #275, #278, #281, #284, #285, #286 (cadence IDs `PERF-2026-05-17-11` through `PERF-2026-05-17-16`).
- Brotli implementation plan was de-duped into a long-form comment on existing #259 (no new issue filed).
- Phase 3 doc corrections applied:
  - #229 (CI rebuilds webpack inside `go:test`) was already FIXED via `.gitlab-ci.yml:382-398` (`needs: { job: build, artifacts: true }` reuses the canonical bundle). Row moved to "Resolved 2026-05-17" section; GitLab issue confirmed closed; closure comment posted.
  - Stale 2026-05-15 baseline paragraph replaced with the 2026-05-17 baseline note (commit `0983456`).
  - Phase 2 recommendation to add `BenchmarkAudit_EmitDuringSnapshot` redirected: already covered by `BenchmarkAuditRing_ConcurrentAppendSnapshot` at `internal/server/audit_test.go:239`. No new issue.
  - Phase 2 candidates dropped: D1 (`result_codec.go:537` no-cap make), D2 (queryStreamReducer push-spread), D3 (GraphViewCytoscape orchestrator inline memo), D4 (useOverviewData Promise.all fan-out). Recorded under "Dropped 2026-05-17" subsection below.
- Confirmed findings (2026-05-17 Phase 4): 5. Suspected findings needing workload/profiler confirmation: 2 (#275 cascade guardrail, #285 bundle-budget tripwire).
- Highest-risk Phase 4 finding: #285 (3.7 MiB largest async chunk; no CI bundle-budget guardrail). All other Phase 4 findings are P3 observability or test/cache hygiene.

Top 5 by PerfScore (2026-05-21 audit Phase 4 OPEN set — all cohorts):

1. **PERF-2026-05-21-01 (PerfScore 100, P1)** — Meta-blocker: bench-gate `allow_failure: true` + 5 missing benches (`ParseProm`, `ProjectSnapshot`, `HandleMetrics`, `LspFrameReader*`, `Hibp*`). Lifts every downstream suspected finding into a real regression net.
2. **PERF-2026-05-21-02 (PerfScore 80, P1)** — Three independent `setInterval` pollers per SPA tab; no shared clock. Server load scales `O(tabs × pollers)`.
3. **PERF-2026-05-21-03 (PerfScore 64, P1)** — Per-call `&http.Client{}` for metrics-poll + HIBP; no `http.Transport` tuning anywhere → `MaxIdleConnsPerHost=2` default.
4. **PERF-2026-05-21-04 (PerfScore 64, P1)** — `lspFrameReader.ReadFrame` reads LSP header one byte at a time; no bench coverage.
5. **PERF-2026-05-21-05 (PerfScore 48, P2, NEW)** — Sparkline + dashboard cards lack memoization; ~500 Recharts subtree rebuilds every 5 s on dashboard.

Historical Top 5 (2026-05-17 Phase 4 OPEN set, kept for trace):

1. #275 (PerfScore ~50, P2) — `useGraphElements` rowsVersion rebuild guardrail; cascade win from #239 / #249 is currently unguarded. **Closed 2026-05-17.**
2. #285 (PerfScore ~25, P3) — 3.7 MiB largest async chunk (`4111.*.js`); no CI bundle-budget tripwire. **Closed 2026-05-17.**
3. #259 (PerfScore 32-50, P2 confirmed) — brotli precompression missing. **Closed 2026-05-17.**
4. #278 (PerfScore ~20, P3) — `net/http/pprof` endpoint. **Closed 2026-05-17.**
5. #281 (PerfScore ~20, P3) — `Server-Timing` headers. **Closed 2026-05-17.**

(All P0/P1 stream-path findings — #239, #240, #243, #246, #249, #251, #254, #256, #257 — closed in the 2026-05-17 round-3 cohort and now live in GAP_ANALYSIS_RESOLVED.md. See "Resolved 2026-05-17" section below.)

## Performance Context Snapshot

Repo shape:

- Go backend entrypoint: `cmd/server`, runtime server code under `internal/server`, connection pooling under `internal/conn`, JWT/profile storage under `internal/jwt` and `internal/profilestore`.
- Generated surfaces: `gen/api`, `gen/client`, `gen/pkg/*`, `gen/mcp`, and OpenAPI in `gen/cmd/server/openapi.yaml`.
- Frontend: React/TypeScript under `src`, graph/table result views under `src/components/results`.
- Electron: `electron/` plus built preload/main output under `internal/ui/electron-dist`.
- CI/release/container: `.gitlab-ci.yml`, `.goreleaser.yaml`, `deploy/Dockerfile*`, docker-compose files, and Playwright E2E Dockerfile.

Assumed workload and SLOs:

- `docs/ARCHITECTURE.md:139-160` explicitly marks performance numbers as assumed, not production-measured.
- Current assumptions include about 2,000 rps on `POST /api/v1/query`, about 400 concurrent users, p10-p90 result sets of 1-1,000 rows, and a 100k+ row long tail for streamed queries.
- Real production telemetry, graph cardinality, browser long-task budgets, and MCP batch workloads remain unknown.

Baseline measurements (canonical 2026-05-17 — regenerated by commit `0983456` after round-3 cohort closure):

- Go curated benchmark subset (2026-05-17): committed under `bench-baseline.txt`. Regenerated via the standard `make bench-gate` baseline workflow after closing #260. Captures the post-#239/#240/#243/#246/#249/#251/#254/#256/#257 streaming-path closures. The `BenchmarkStreamQueryResult_PerRowAlloc` and `BenchmarkStreamRowsOverWS_AllocsPerRow` baselines now reflect the closed-state alloc-count contracts pinned by their tests.
- Webpack production build (2026-05-16 post-#235): `internal/ui/dist` ~16M (down from 65M), zero `.map` files when built with `EMBEDDED_BUILD=1`.
- Embedded bundle composition (2026-05-17, raw bytes from `internal/ui/dist`):
  - `2749.*.js`: 6,717,982 bytes (~6.4 MiB) — largest async chunk; likely co-bundled lazy targets.
  - `4111.*.js`: 3,803,806 bytes (~3.7 MiB) — second largest async chunk; likely Monaco language services. Tracked by #285.
  - `vendors.*.js`: 555,068 bytes (~542 KiB) — sync vendor entrypoint.
  - `main.*.js`: 228,157 bytes (~223 KiB) — entry shell.
- Streaming reducer + table projection (post-#234 + #239 + #240 closures): rowDisplayCap=5000 + 25k retention cap + rAF-coalesced streamResp memo. The pre-#234 13.38s/32k-rows baseline is now historical; the closed-state contract is pinned by `queryStreamReducer.test.ts::retention cap` and `QueryPage.streamMemo.test.tsx::PERF-2026-05-17-02`.

**Bench-baseline cadence rule (2026-05-17):** regenerate the baseline ONCE PER COHORT CLOSE — that is, after each batch of issues with the same cadence ID (`PERF-YYYY-MM-DD-NN`) lands on `main`. The 2026-05-17 baseline supersedes the 2026-05-15 baseline; the prior baseline pre-dated the entire 2026-05-16 closure cohort (#217, #218, #221, #222, #225, #237, #234, #235, #236, #216, #238, #171, #165, #167, #169, #219, #163, #224) and the entire 2026-05-17 round-3 cohort (#239, #240, #243, #246, #249, #251, #254, #256, #257), so a one-shot regeneration after both cohorts landed gave us the canonical "post-closure" anchor. Suggested regeneration command (same as `make bench-gate` baseline path):

```bash
GOEXPERIMENT=jsonv2 GOTOOLCHAIN=go1.26.3 timeout 5m go test -bench=. -benchmem -run='^$' -benchtime=100ms -count=3 \
  ./internal/conn/ ./internal/server/ ./internal/jwt/ ./gen/pkg/wsx/ ./gen/pkg/oidcx/ ./gen/pkg/securex/ ./gen/pkg/gen/ \
  > bench-baseline.txt
```

## Stack-Ranked Findings

| Rank | PerfSeverity | PerfScore | Finding | Component | Evidence | Measurement | GitLab Issue | Fix Summary | Owner | SLA/Due | Status |
|---:|---|---:|---|---|---|---|---|---|---|---|---|
| 1 | P0 | 100 | `streamStateToResp` allocates fresh QueryResp every WS batch — busts TableView/JsonView/useGraphElements memos | Query stream, table renderer, JSON view, graph elements | `src/pages/QueryPage.tsx:104-111`; `src/components/results/TableView.tsx:447-450`; `src/components/results/JsonView.tsx:28-31`; `src/components/results/graph/useGraphElements.ts:91-158` | 10k rows / 64-row batches = 156 batches; equivalent of ~8s main-thread + ~80 MB allocator churn (cf. 2026-05-15 baseline 13.38s/32k rows) | [#239](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/239) | `useMemo` keyed on `stream.rowsVersion` + add rAF throttle for resp derivation | UI performance | Current sprint | **Closed (2026-05-17)** — `7c2d867` — useMemo on streamStateToResp now keyed on rAF-throttled `throttledVersion`; multiple WS batches in one animation frame coalesce into a single downstream resp identity change. Terminal status bypasses the throttle so final state settles in one render. Pinned by `QueryPage.streamMemo.test.tsx::PERF-2026-05-17-02`. Cascade-resolves #249. |
| 2 | P0 | 100 | `queryStreamReducer.state.rows` unbounded; display cap 5,000 but retention is full stream | Query stream reducer, Electron heap | `src/pages/queryStreamReducer.ts:79-98` | 100k-row stream: ~95% RAM reduction achievable with 25k retention cap | [#240](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/240) | Configurable retention cap (default 25k); overflow banner + server-spool export | UI performance + Backend | Current sprint | **Closed (2026-05-17)** — `da9df5e` — DEFAULT_ROW_RETENTION_CAP=25k clamps rows[]; overflow rows count into `rowsTruncated`; partial-fit retains FIRST N to preserve ORDER BY; pure-overflow frames don't bump rowsVersion; banner in QueryPage surfaces truncation count + cap. Pinned by `queryStreamReducer.test.ts::retention cap`. |
| 3 | P0 | 80 | AuditLogPage refetches per keystroke; server returns full 10k-entry ring without pagination | Ops UI + audit handler | `src/components/ops/AuditLogPage.tsx:118-133`; `internal/server/handlers_audit.go:36-51` | 5-char typing burst -> 5 fetches each returning full ring | [#243](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/243) | 300ms debounce on filter inputs + server-side `limit`/`cursor` pagination | UI + Backend | Current sprint | **Closed (2026-05-17)** — `ebf97d3` — `AUDIT_FILTER_DEBOUNCE_MS=300` collapses typing-burst refetches; server respects `?limit=` (default 200, cap 10k) and returns the TAIL of the ring in chronological order. Pinned by `AuditLogPage.test.tsx::filter typing debounces refetches` and `handlers_audit_test.go::TestAudit_Limit*`. |
| 4 | P1 | 64 | `useGraphElements` rebuilds 3 Maps per `baseEls` change (cascades from #239) | Graph elements memo | `src/components/results/graph/useGraphElements.ts:91-158` | ~1.56M Map.set ops across a 10k-row graph stream; cascade-resolves with #239 | [#249](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/249) | Verify cascade fix from #239; defense-in-depth memo key on `stream.rowsVersion` | UI performance | Bundle with #239 | **Closed (2026-05-17)** — cascade-resolved by #239 (`7c2d867`). useGraphElements memo deps include the rAF-throttled streamResp identity, so the 3-Map rebuild now coalesces alongside the table/JSON re-projection. |
| 5 | P1 | 60 | `streamRowsOverWS` allocates row + ptrs slabs per row | Backend WS sender | `internal/server/ws_query.go:377-382` | ~210 B/row pure slab overhead; ~21 MB per 100k-row stream | [#251](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/251) | Pool `ptrs` via `sync.Pool` keyed on `len(cols)`; investigate row pool if batcher copies | Backend | Bundle with PERF-EPIC-STREAM | **Closed (2026-05-17)** via `eec83de` — `wsPtrsPool` (sync.Pool of `*[]any`) mirrors the existing `wsRowBufPool` pattern. Per-row Get → re-slice → populate → Scan → nil-clear → Put BEFORE `batcher.add` so the pool reference cannot outlive the batcher's row reference. Baseline 12180 allocs/op (1000 rows × 5 cols) → 11185 allocs/op; row slab cannot be pooled (batcher contract retains row until next flush). `TestStreamRowsOverWS_PoolDoesNotPinRowReferences` pins the nil-clear-before-Put safety; `BenchmarkStreamRowsOverWS_AllocsPerRow` pins the alloc-count contract. |
| 6 | P1 | 48 | audit ring uses `sync.Mutex`; snapshot blocks emit hot path | Backend audit ring | `internal/server/audit.go:115-120,169-197` | p99 emit latency picks up 250-500 µs spike on /audit poll-during-emit-burst | [#246](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/246) | Swap to `sync.RWMutex`; snapshot takes RLock | Backend | Next sprint | **Closed (2026-05-17)** — `9697a4c` — auditRing.mu is now sync.RWMutex; snapshot takes RLock so a /audit poll no longer serialises hot emitAudit appends. Existing `audit_test.go::SnapshotSinceUnderConcurrentAppend` pins the no-deadlock contract under -race. |
| 7 | P1 | 48 | Table projection explodes high-cardinality graph properties into dense columns | Table renderer | `src/components/results/projectColumns.ts:123-135,162-229`; `src/components/results/TableView.tsx:284-300,355-395` | 200 rows x 20 unique props -> 4,001 cols, 800,200 cells, 309.7 ms, +10.5 MB | [#236](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/236) | columnBudget=64 + overflow banner + per-plan distribution | UI performance | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 8 | P1 | 48 | Matrix view renders dense O(labels^2) table cells | Matrix renderer | `src/components/results/MatrixView.tsx:146-168` | Not benchmarked in this pass; code path is dense by inspection | [#216](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/216) | Sparse/windowed matrix rendering and label-count benchmarks | UI performance | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 9 | P2 | 48 | WebSocket query cancel reader uses two goroutines per session | Backend WebSocket | `internal/server/ws_query.go:300-341` | Goroutine count at 1000 sessions: pre 2000+slack, post 1.5N | [#218](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/218) | Single-goroutine cancelReader with deadline-poison wakeup | Backend | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 10 | P2 | 36 | Dashboard graph stats run two uncached full-graph count queries | Dashboard, query API, DB | `src/lib/useOverviewData.ts:93-110`; `src/pages/DashboardPage.tsx:55-62` | Not measured against real Geode graph; suspected full graph scans | [#237](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/237) | 60s TTL client cache keyed on (connectionId, graphName) | UI | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 11 | P2 | 36 | MCP JSON-RPC batch requests execute serially | MCP engine | `gen/pkg/mcpx/engine.go:315-326,451-462` | Need fake-tool sleep benchmark; recorded upstream design | [#238](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/238) | Bounded errgroup parallel scheduler with per-tool opt-out | MCP/backend (upstream genapi) | Blocked on genapi | **Closed-as-needs-genapi (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 12 | P2 | 36 | Result streaming/cold result paths still carry row serialization allocation pressure | Result codec | `internal/server/result_codec.go:87-94,237-277` | Pre #217: 3,390 allocs/op; post: 808 allocs/op (76% reduction) | [#217](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/217) | Pooled row scratch + summary accumulator + marshalRowFast | Backend | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 13 | P2 | 32 | Login/profile limiter maps are unbounded by TTL eviction | Rate limiting | `internal/server/loginlimiter.go:215-218,316-321`; `internal/server/profilelimiter.go:94-171` | 50k unique IPs heap-bounded at 2MB with MaxEntries=1000 | [#225](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/225) | StartJanitor + MaxIdle + MaxEntries hard cap | Backend | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 14 | P2 | 32 | GraphView resize/rebuild coalescing needs regression pin | Graph renderer | `src/components/results/graph/useGraphCytoscape.ts:276,394-399` | 50 schedule calls in 5 frames -> 5 refits (rAF coalesced) | [#222](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/222) | createResizeCoalescer helper + regression test | UI performance | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 15 | P1 | 36 | LSP reconnect schedule has no jitter; thundering herd on bounce | UI LSP client | `src/lib/lsp/client.ts:28,71-89` | 100 tabs all retry at T+500/2000/6500ms wall-synchronized | [#254](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/254) | Equal-jitter strategy: delay = base/2 + random*base/2 | UI/LSP | Bundle with PERF-EPIC-INFRA | **Closed (2026-05-17)** via `6695e54` — `delay = base/2 + Math.random()*base/2` in `scheduleReconnect`. With Math.random seeded to 0.0 the delay is base/2 (250ms for the first retry); seeded to 1.0 it's the full base. Pinned by new `client.test.ts::reconnect backoff applies equal jitter`. |
| 16 | P1 | 32 | Lazy imports lack `webpackPrefetch` hints for Monaco/Cytoscape/reagraph | UI bundling | `src/pages/QueryPage.tsx:33-37`; `src/components/results/ResultPanel.tsx:14-18` | First graph tab click: 50-300 ms saved with prefetch | [#256](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/256) | Add `webpackPrefetch: true` + `webpackChunkName` magic comments | UI build/perf | Bundle with PERF-EPIC-INFRA | **Closed (2026-05-17)** via `478bcf6` — `/* webpackPrefetch: true, webpackChunkName: "gql-editor" */` and `"graph-view"` magic comments on the two lazy dynamic imports. webpack emits `<link rel="prefetch">` so chunks warm during browser idle. New `src/__tests__/lazy-prefetch-hints.test.ts` pins the magic-comment contract by source-scan. |
| 17 | P2 | 60 | Production source maps are embedded and served with the SPA bundle | Release artifact, static server | `webpack.prod.js:24-25`; `internal/ui/embed.go:15-16,28-32,57-64` | Build 99.519s; dist 65M->16M after close; maps 48.78 MiB; binary 85M | [#235](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/235) | Gate `devtool` on `EMBEDDED_BUILD=1` env | Release/platform | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 18 | P2 | 60 | CI rebuilds webpack inside `go:test` instead of reusing canonical artifact | CI/CD | `.gitlab-ci.yml:382-398` | Current `go:test` job now declares `needs: { job: build, artifacts: true }` and verifies `internal/ui/dist/index.html` before running Go tests; webpack rebuild removed from test stage critical path | [#229](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/229) | Reused build artifact via `needs.artifacts: true` | CI/platform | n/a | **Closed (2026-05-17)** — verified during Phase 4. See "Resolved 2026-05-17 (Phase 4)" section. |
| 19 | P1 | 80 | Streaming query table projection recomputes all accumulated rows per WebSocket batch | Query stream, table renderer | `src/pages/queryStreamReducer.ts:89-98`; `src/pages/QueryPage.tsx:325-334`; `src/components/results/TableView.tsx:441-443`; `src/components/results/projectColumns.ts:110-229` | 500 frames / 32k rows -> 13.38s projection, +89.7 MB heap | [#234](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/234) | rowDisplayCap=5000 + columnBudget=64 + NDJSON export | UI performance | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md; residual rAF-throttle gap (#234b) now tracked by #239. |
| 20 | P1 | 24 | `refreshCsrfToken()` stampede under concurrent 403s | API client | `src/api/client.ts:73-87` | Burst of 10 concurrent 403s -> 10 concurrent /api/csrf fetches | [#257](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/257) | Singleflight guard around `refreshCsrfToken` | API client | Bundle with PERF-EPIC-INFRA | **Closed (2026-05-17)** via `79b5680` — `inflightRefresh: Promise<string \| null> \| null` shared across concurrent callers; cleared in `.finally()` so the next refresh window after settle does fetch again. Two new jest tests pin (a) fetch called exactly once for 5 concurrent calls and (b) singleflight does not leak across settle. |
| 21 | P3 | 24 | HMAC body signing is still non-streaming when body limit is raised | Auth/security middleware | `gen/pkg/securex/secure.go:318-359` | 100MB custom-limit path: 908.97 ms/op, 268.46 MB/op; default cap is 1 MiB | [#171](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/171) | True streaming/replayable body strategy | Backend (upstream genapi) | Blocked on genapi | **Closed-as-needs-genapi (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 22 | P3 | 24 | `Pool.DB` uses a global mutex on read-mostly cache hits | DB pool | `internal/conn/pool.go:165-189` | RunParallel 108.9 ns/op vs serial 95.6 ns/op (post-fix) | [#165](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/165) | Swap to RWMutex; fast-path RLock | Backend/DB | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 23 | P3 | 24 | Per-route bucket takes separate snapshot and allow locks | Generated HTTP limiter | `gen/pkg/securex/secure.go:435` and generated rate-limit wrappers | Not re-benchmarked in this pass | [#167](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/167) | Add combined `AllowAndSnapshot` path | Generated backend (upstream genapi) | Blocked on genapi | **Closed-as-needs-genapi (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 24 | P3 | 24 | Stream gzip can engage on tiny TTFB flushes | HTTP compression | `gen/pkg/httpx/compress.go`; `internal/server/result_codec.go:164` | Not re-benchmarked in this pass | [#169](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/169) | Buffer first 1024 bytes; defer gzip activation | Backend (upstream genapi) | Blocked on genapi | **Closed-as-needs-genapi (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 25 | P3 | 16 | Column descriptors are marshaled per column | Result codec | `internal/server/result_codec.go:76-96` | Pre 83,127 ns/op; post 45,141 ns/op (45% faster) | [#219](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/219) | `encodeColumnDescs` reusable buffer + tokens | Backend | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 26 | P3 | 16 | gzip response wrapper allocation likely remains per request | HTTP compression | `gen/pkg/httpx/compress.go` | Not revalidated in this pass | [#163](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/163) | Pool wrapper struct + gzip writer | Backend (upstream genapi) | Blocked on genapi | **Closed-as-needs-genapi (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 27 | P3 | 16 | `driftSeen` uses a mutex for read-mostly warning dedupe | User/admin handlers | `internal/server/handlers_users.go:666-688` | RunParallel post-fix 90.39 ns/op | [#221](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/221) | Swap to RWMutex; first-sighting double-checked under write lock | Backend | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 28 | P3 | 12 | Audit log polling is visibility-gated but lacks regression pin | Ops UI | `src/components/ops/AuditLogPage.tsx:114,156` | No current regression observed | [#224](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/224) | Regression test for visibility-gated polling | UI/ops | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 29 | P2 | 32 | No brotli for SPA bundles; gzip-only | HTTP compression | `internal/ui/embed.go:75-83` | ~30% smaller bundles on modern browsers (~1 MiB saved over the wire on the 16M post-#235 dist) | [#259](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/259) | Brotli precompression at build time + Accept-Encoding preference | Release/platform | Bundle with PERF-EPIC-INFRA | **Closed (2026-05-17, CO-259)** — added `scripts/precompress-dist.mjs` (stdlib `zlib.brotliCompressSync` at quality 11; idempotent against mtimes) wired into `npm run build` as `build:precompress`. `internal/ui/embed.go::Handler` now checks `Accept-Encoding: br` and serves the `.br` sibling with `Content-Encoding: br` + correct `Content-Length` when one exists; falls back to on-the-fly gzip otherwise. Brotli takes precedence over gzip when the client accepts both (the q11 sibling is meaningfully smaller than the on-the-fly q1 gzip). Measured ratio on the existing dist: 64.08 MiB -> 11.10 MiB (0.173 of the source). 5 new Go tests pin the contract (handler/AcceptsBrotli/falls-through-to-gzip when br not accepted). 5 new Node tests pin the precompress script (compressBuffer round-trip + shouldPrecompress extension/floor classification). |

## Resolved 2026-05-17 (Phase 4)

The following row was moved out of the open table because Phase 4 verification confirmed the fix already shipped:

| Issue | Component | Verification | Fix Reference |
|---|---|---|---|
| [#229](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/229) — CI rebuilds webpack inside `go:test` | CI/CD | Phase 4 inspection of `.gitlab-ci.yml:382-398` (`go:test` job) confirmed the job declares `needs: { job: build, artifacts: true }`. The script only verifies `test -f internal/ui/dist/index.html` before running `go test -race -cover -failfast ./cmd/... ./gen/... ./internal/...`. No `npm ci` / `npm run build` in the test stage. The job comment explicitly cites `QUALITY #229` as the closure rationale. | `.gitlab-ci.yml:382-398` |

## Phase 4 (2026-05-17) Findings — Newly Opened

Six new GitLab issues filed (cadence IDs `PERF-2026-05-17-11` through `PERF-2026-05-17-16`). One brotli implementation plan piggy-backed on existing #259 (no new issue).

| Cadence ID | Issue | PerfSeverity | PerfScore | Finding | Component | Evidence | Status |
|---|---|---|---:|---|---|---|---|
| PERF-2026-05-17-11 | [#275](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/275) | P2 | ~50 | useGraphElements rowsVersion rebuild guardrail (regression pin) | UI graph elements | `src/components/results/graph/useGraphElements.ts:91-158`; `src/components/results/graph/useGraphElements.test.ts` only asserts degree stamping | **Closed (2026-05-17)** via `a37caa3` — two new rerender tests pin the contract: (1) stable resp reference => baseEls / elements / nodeDataById / edgeDataById / nodeLabelBuckets / nodeIds / edgeIds all stay `===` across 5 rerenders; (2) bumped resp reference => derived identities rotate exactly once and then stay stable on subsequent rerenders with the new ref. A regression that reverts the upstream `streamStateToResp` memo would trip the second-bump rebuild count back to per-render. |
| PERF-2026-05-17-12 | [#278](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/278) | P3 | ~20 | No `net/http/pprof` endpoint; perf debugging requires a fresh build | Observability/backend | `cmd/server/app.go:11` imports `net/http` only; zero `pprof` imports | **Closed (2026-05-17)** via `a1a1313` — new `cmd/server/pprof.go` plumbs an opt-in pprof endpoint via `GEODE_PPROF=1`. Binds a SEPARATE `*http.Server` to `127.0.0.1:6060` by default (overridable via `GEODE_PPROF_LISTEN` but validated against a loopback-only allowlist of `127.0.0.1:N` / `[::1]:N` / `localhost:N`). Handlers (`pprof.Index/Cmdline/Profile/Symbol/Trace`) are registered on a dedicated `*http.ServeMux`. Shutdown wired into `run()` with a 5s budget. Five new tests pin the contract. |
| PERF-2026-05-17-13 | [#281](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/281) | P3 | ~20 | No `Server-Timing` headers; per-stage latency invisible in DevTools | Observability/backend | zero `Server-Timing` emissions in `internal/server/*.go` or `gen/`; suggested middleware over `POST /api/v1/query` | **Closed (2026-05-17)** via `912be6d` — `streamQueryResult` now emits `Server-Timing: db;dur=<ms>` as a pre-flush header (`internal/server/result_codec.go:430-446`) and a `marshal;dur=<ms>` trailer keyed `X-Server-Timing-Marshal` (`http.TrailerPrefix`-prefixed so net/http emits it post-body). Tests pin the contract: `TestStreamQueryResult_EmitsServerTiming` + `TestFormatMillisFloat`. |
| PERF-2026-05-17-14 | [#284](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/284) | P3 | ~20 | `perfMarks.ts` only observes `measure`, not `longtask` | UI observability | `src/lib/perfMarks.ts:41-48` `observer.observe({ entryTypes: ['measure'] })` only | **Closed (2026-05-17)** via `5a052b8` — `startObserver` now installs a second `PerformanceObserver` (separate instance so it can use `type: 'longtask'` + `buffered: true`). Each entry increments a module-level `longTaskCount` and emits a dev-only `console.warn`. Install failure is silent. Three new tests pin the contract. |
| PERF-2026-05-17-15 | [#285](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/285) | P3 | ~25 | 3.7 MiB largest async chunk; no chunk-budget tripwire in CI | UI build/perf | `internal/ui/dist/4111.5f8253d51707c022176e.js` 3,803,806 bytes; `webpack.prod.js:4-22` excludes async chunks from entrypoint budget | **Closed (2026-05-17)** via `f8ed2f2` — added `scripts/check-chunk-budget.mjs` + `scripts/check-chunk-budget.test.mjs` (6 cases) + `npm run check:chunk-budget` script. Walks `internal/ui/dist/` for `.js` chunks, sorts heaviest-first, fails if any chunk exceeds `--budget <bytes>` (default 4 MiB). Wired as a new `chunk-budget` job in `.gitlab-ci.yml` with `allow_failure: true`. |
| PERF-2026-05-17-16 | [#286](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/286) | P3 | ~20 | `graphStatsCache` is unbounded Map; entries for never-revisited graphs leak | UI memory | `src/lib/useOverviewData.ts:54-67` — 60s TTL only prunes on read-miss for exact same key | **Closed (2026-05-17)** via `f2b8566` — bounded to 32 entries via JS-Map-insertion-order LRU. `writeGraphStatsCache` does `delete-before-set` so an existing key re-registers as the newest, and post-write a `while (size > cap)` loop evicts the oldest. Two new tests pin the contract: `loadStats LRU eviction` + `loadStats LRU refresh`. |
| (no new issue) | [#259](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/259) | P2 | ~50 | Brotli precompression — long-form implementation plan landed alongside the closure | UI build + static-file negotiation | `internal/ui/embed.go:46-66` (gzip-only pre-fix); `webpack.prod.js` no `CompressionPlugin`; vendors.js 555 KiB, main.js 228 KiB | **Closed (2026-05-17)** via `43eb1ef` — `scripts/precompress-dist.mjs` wired into `npm run build` as `build:precompress`; `internal/ui/embed.go::Handler` serves `.br` siblings when `Accept-Encoding: br`. Measured 64.08 MiB -> 11.10 MiB. 5 Go tests + 5 Node tests pin the contract. |

## Phase 4 (2026-05-19) Findings — Newly Opened

Seven new GitLab issues filed (cadence IDs `PERF-2026-05-19-01` through `PERF-2026-05-19-07`). Discovered by `/codepros:audit` Phase 3 perf-reviewer pass against the 2026-05-19 perf-smoke baseline (`docs/performance/2026-05-19-perf-smoke.results.json`). Phase 3 also flagged 1 candidate (B — runLayout partial-cache 3×O(n) rerun) that was dropped at this gate: at large n the rerun is negligible relative to layout convergence cost. Recorded under "Dropped 2026-05-19" below.

Stack-ranked by PerfScore (descending):

| Cadence ID | Issue | PerfSeverity | PerfScore | Finding | Component | Evidence | Status |
|---|---|---|---:|---|---|---|---|
| PERF-2026-05-19-01 | [#291](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/291) | P1 | 80 | layoutWorker JSON-encode + toPosMap re-iteration per 33ms tick — transferable Float32Array | UI graph worker | `src/components/results/graph/layoutWorker.ts:71-81`; `src/components/results/graph/useLayoutWorker.ts:40-44,70-72`; bench `docs/performance/2026-05-19-perf-smoke.results.json` n=10000 p5Fps=0.3 | **Closed (2026-05-19)** via `86e0463` — layoutWorker now posts positions as a packed transferable `Float32Array` of length `2*N` (interleaved `[x,y,x,y,…]`) with `postMessage(buf, [positions.buffer])` for zero-copy transfer. Main thread closes over `args.nodes` to recover the id-by-index mapping. `useLayoutWorker.toPosMap` accepts BOTH the new `Float32Array` shape and the legacy `Record<string,[number,number]>` for mid-deploy chunk-skew resilience. Tests pin both decode paths. |
| PERF-2026-05-19-07 | [#316](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/316) | P1 | 80 | cytoscape chunk 6.41 MiB (eager plugins) + fcose imported twice — lazy-load + dedupe | UI build | `internal/ui/dist/2749.*.js` 6,717,982 B; main + worker both pull `cytoscape-fcose` | **Closed (2026-05-19)** via `3259dab` — opt-in cytoscape plugins (cxtmenu, lasso, navigator) are now loaded via dynamic `import()` with module-level promise caching (so the first user of each plugin triggers the chunk load and subsequent users reuse the cached promise). New emitted chunks: `cyto-cxtmenu`, `cyto-lasso`, `cyto-navigator` at ~10-11 KiB each. **Bundle-delta correction:** the main cytoscape chunk `2749.*.js` remained at 6.41 MiB — the audit's 1-2 MiB projection was over-optimistic about plugin sizes; the bulk is cytoscape core + `fcose` + `dagre` + `spread`, which are NOT opt-in and stay eagerly bundled. Realised save on the never-opt-in path: ~30 KiB across the three lazy chunks. `useLasso` / `useCxtMenu` / `GraphMiniMap` tests updated to `await waitFor(...)` for the now-async plugin-apply path. |
| PERF-2026-05-19-06 | [#312](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/312) | P1 | 60 | bench harness — no warm rerun, worker path never exercised, p5Fps gate @ n=5000 wrong tier, bench-gate.ts 10% threshold no abs-ms floor | CI/UI bench | `e2e/specs/19-graph-bench.spec.ts:40-179,136`; `src/components/results/graph/scaleTier.ts:1-11`; `scripts/bench-gate.ts:26` | **Closed (2026-05-19)** via `e42a92c` — bench harness: warm-rerun + worker-path combos; `scaleTier.MID_MAX` 5_000→5_001; `window.__geode_bench` debug surface; `layoutCache.getStats()`; `bench-gate.ts MIN_ABSOLUTE_MS` floor. See `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-19". |
| PERF-2026-05-19-03 | [#297](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/297) | P1 | 60 | WS frame parse uses JSON.parse on main thread — offload to worker for 100k-row streams | UI streaming | `src/lib/queryStream.ts:77-90`; `internal/server/ws_query.go:39` | **Closed (2026-05-19)** via `e085a7f` — WS JSON.parse offloaded to a Web Worker. New `src/lib/queryStreamWorker.ts` + `queryStreamWorkerUrl.ts` URL helper + jest mock `__test_utils__/mocks/queryStreamWorkerUrlMock.js`. Layout-worker-style singleton + fallback: `tryCreateParseWorker` returns `null` when Worker is unavailable (jsdom / CSP / construct fail) and the WS handler keeps the original inline `JSON.parse` path. New PERF #297 test pins worker-FIFO dispatch ordering via a FakeWorker; the 4 pre-existing queryStream tests still pass via the main-thread fallback. |
| PERF-2026-05-19-02 | [#294](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/294) | P2 | 48 | layoutCache.get clones full PosMap on every hit — drop defensive clone | UI graph cache | `src/components/results/graph/layoutCache.ts:42` (now line 61) | OPEN — **REVERIFIED 2026-05-21** at `layoutCache.ts:61` (`return { hit: 'full', positions: new Map(positions) }`). Store-side `bump(sig, new Map(positions))` ALSO clones — two full O(n) Map copies per layout cycle. Re-confirmed by perf-review §Top-10 #5. |
| PERF-2026-05-19-04 | [#302](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/302) | P2 | 36 | WS protocol is JSON-only — evaluate MessagePack/CBOR (design + bench, not implementation) | UI + Backend | `internal/server/ws_query.go:39`; `src/lib/queryStream.ts:77-90`; no `gen/pkg/wsx` binary path | OPEN — **REVERIFIED 2026-05-21**: no new evidence; still design-exercise territory. Worker-side parse (#297) is the steady-state path now, so the cost is no longer a main-thread P1, but a binary protocol would still cut payload size on the wire. |
| PERF-2026-05-19-05 | [#306](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/306) | P2 | 32 | streamRowsOverWS sequential scan→encode→write — producer goroutine + bounded channel | Backend WS | `internal/server/ws_query.go:391-455` | OPEN — **REVERIFIED 2026-05-21** at `ws_query.go:391-455`. Single-goroutine scan→encode→write unchanged on HEAD `1199648`. A slow WS client still back-pressures the SQL cursor end-to-end. |

Top by PerfScore (2026-05-19 Phase 4 OPEN set — post deferred-items follow-up):

1. **#294 (PerfScore 48, P2)** — layoutCache.get clones PosMap on cache hit. Quick win.
2. **#302 (PerfScore 36, P2)** — WS protocol JSON-only; evaluate MessagePack/CBOR (design + bench, not implementation).
3. **#306 (PerfScore 32, P2)** — `streamRowsOverWS` sequential scan→encode→write; producer goroutine + bounded channel.

All four P1 items in this cohort (#291 / #297 / #312 / #316) are now Closed. See "Phase 4 (2026-05-19) Findings — Newly Opened" table and the row-level status entries above for closure SHAs and evidence.

### Bundle-delta correction (#316)

The audit projection for #316 expected 1-2 MiB removed from the cytoscape graph chunk. The realised save is **~30 KiB**, not 1-2 MiB. Rationale: the audit conflated "plugin size" with "chunk size." After splitting cxtmenu / lasso / navigator into dynamic chunks of ~10-11 KiB each, the remaining `2749.*.js` is still 6.41 MiB because that chunk is cytoscape **core** plus the **eager** layout plugins (`fcose`, `dagre`, `spread`) that are always used by the default + GQL-shape layouts. Those are not opt-in and cannot be lazy-loaded without breaking the initial-render contract. The win is correct (never-opt-in users save ~30 KiB on the initial graph experience), but the expected magnitude was wrong. #285's chunk-budget tripwire remains the right longer-term lever — splitting fcose / dagre / spread out is its own design exercise (probably blocked on layout-strategy plugin model upstream).

### Dropped 2026-05-19 (Phase 2/3 candidates)

- **B — `runLayout.ts:65-71` partial-cache rerun does 3×O(n) (lock, layout, unlock).** Dropped. At large n the rerun cost is dominated by layout convergence; the 3×O(n) is single-digit ms. Watchlist note only.

### R1 — Phase 2 recommendation already covered

The Phase 2 recommendation to add a `BenchmarkAudit_EmitDuringSnapshot` benchmark is REDIRECTED: it is already covered by `BenchmarkAuditRing_ConcurrentAppendSnapshot` at `internal/server/audit_test.go:239`, which measures append-side throughput under a concurrent snapshot reader — the exact contention shape Phase 2 wanted to pin. No new issue filed; no doc change needed beyond this note.

### Dropped 2026-05-17 (Phase 2 candidates)

The following Phase 2 candidates were considered and dropped during Phase 3 review. They are recorded here so a future reviewer doesn't re-discover them as "new":

- **D1 — `internal/server/result_codec.go:537` no-cap `make`.** Demoted to watchlist only. `scanQueryResult` is COLD path (MCP query + tx Run); user traffic uses `streamQueryResult`. Hint may be worth a code comment; not worth a tracked issue.
- **D2 — `queryStreamReducer` push-spread `rows.push(...batch)`.** Dropped entirely. 64-batch is 1024x below V8 argv limit; premature optimization.
- **D3 — `GraphViewCytoscape` orchestrator no inline `useMemo`.** Dropped. Memoization is correctly delegated to extracted hooks per the post-#164 refactor.
- **D4 — `useOverviewData` `Promise.all` 2-3 fan-out.** Dropped. The 60s TTL cache (#237) plus 30s timeout are already in place; the fan-out is not the contention point.

## Phase 4 (2026-05-21) Findings — Reviewer Pass (--skip-issues, docs-only)

Source: `docs/audits/2026-05-21/perf-context.md`, `docs/audits/2026-05-21/perf-scan.md` (13 findings: Backend 6, Frontend 4, Infra 3), `docs/audits/2026-05-21/perf-review.md` (17 findings: P0=0, P1=4, P2=7, P3=6 — 13 scanner + 3 new + 1 bench-coverage gap split). This pass was run in `--skip-issues` mode: **no GitLab issues were filed or commented**. Cadence IDs `PERF-2026-05-21-01` through `PERF-2026-05-21-14` are reserved for the follow-up issue-creation pass.

Reviewer disposition vs. scanner:

- **Upgraded P2 → P1**: F-FE-1 (shared-clock); `lspFrameReader` byte-by-byte; bench-gate `allow_failure: true` + missing benches (meta).
- **Confirmed P1**: HIBP per-call `&http.Client{}`; metrics per-call `&http.Client{}` (consolidated into one "no `http.Transport` tuning" finding).
- **New (not in scanner)**: Sparkline + dashboard cards lack memoization (P2); `pushSynthesisedRows` two-pass row sweep (P2); no `http.Transport` tuning in tree (rolled into the metrics+HIBP P1).
- **Reverified OPEN P2 carry-overs**: #294, #302, #306 (see updated status cells in the 2026-05-19 table above).

Stack-ranked by PerfScore (descending):

| Cadence ID | PerfSeverity | PerfScore | Finding | Component | Evidence | Confidence | Status |
|---|---|---:|---|---|---|---|---|
| PERF-2026-05-21-01 | P1 | 100 | **META-BLOCKER:** `bench-gate` job is `allow_failure: true` AND five hot-path benches are missing (`BenchmarkParseProm`, `BenchmarkProjectSnapshot`, `BenchmarkHandleMetrics`, `BenchmarkLspFrameReader*`, `BenchmarkHibpHasSeen`). Until both are resolved, every suspected-confidence finding stays invisible to MR review. | CI/CD + Backend bench coverage | `.gitlab-ci.yml:472-473`; grep returns zero `Benchmark{ParseProm,ProjectSnapshot,HandleMetrics,LspFrameReader,Hibp}*` in `internal/server/*_test.go` | confidence::confirmed | OPEN (2026-05-21) — **highest-leverage closure**: lifts every downstream suspected finding into a benchable regression net. |
| PERF-2026-05-21-02 | P1 | 80 | Three independent `setInterval` pollers per SPA tab; no shared clock (F-FE-1 upgraded P2→P1). 5s metrics tick and 30s audit-donut tick alias every 30 s, doubling p95 spikes on `/api/v1/metrics` + `/api/v1/audit`. | UI polling | `src/lib/useMetricsPolling.ts:128`; `src/components/dashboard/AuditEventMixCard.tsx:124`; `src/components/ops/AuditLogPage.tsx:196` | confidence::confirmed | OPEN (2026-05-21) — fix: `usePollingClock` hub owning one `setInterval(1000)` emitting coalesced `tick:5s` / `tick:30s` events. Drops timers from O(tabs × cards) to one per tab. |
| PERF-2026-05-21-03 | P1 | 64 | Per-call `&http.Client{Timeout:…}` in two hot paths (`/api/v1/metrics` 5s-poll + HIBP login/registration/password-change); no `http.Transport` tuning anywhere in tree → default `MaxIdleConnsPerHost=2`. 50 dashboards × 5s = 600 reqs/min to ONE upstream host with only 2 reusable conns; HIBP path pays TLS handshake every login (~50-200ms wall). | Backend HTTP-out | `internal/server/handlers_metrics.go:214-219`; `internal/server/password_policy.go:169-172`; grep across `internal/server/*.go` + `cmd/server/*.go` finds zero `MaxIdleConns` / `http.Transport` tuning | confidence::confirmed | OPEN (2026-05-21) — fix: package-level `*http.Transport` via `sync.Once` (or DI through `Config`) with `MaxIdleConnsPerHost:32`, `MaxIdleConns:256`, `IdleConnTimeout:90s`, `ForceAttemptHTTP2:true`. Reuse via a singleton client. |
| PERF-2026-05-21-04 | P1 | 64 | `lspFrameReader.ReadFrame` reads LSP header **one byte at a time** with fresh `make([]byte, 1)` per loop and `append(header, buf[0])` growing slice byte-by-byte. Plus `strings.ToLower(headerStr)` alloc per frame. (Upgraded P2 → P1 in reviewer pass.) | Backend LSP bridge | `internal/server/ws_lsp.go:351-374,380` | confidence::suspected | OPEN (2026-05-21) — fix: wrap upstream `tcp` in `bufio.NewReaderSize(tcp, 4096)`; `r.ReadString('\n')` for header lines; `io.ReadFull` for body; `strconv.Atoi(bytes.TrimSpace(...))` for Content-Length. Suspected confidence pending `BenchmarkLspFrameReader_HeaderOnly` (see PERF-2026-05-21-01). |
| PERF-2026-05-21-05 | P2 | 48 | `Sparkline` rebuilds `buildData(values)` on every render + recreates `formatForTooltip(formatValue)` per render; no `React.memo`. `MetricsCards` and most `dashboard/*.tsx` lack `useMemo`/`React.memo`. 5s metrics poll → setState → re-render every dashboard child → ~8 cards × 60-sample arrays = ~500 Recharts subtree rebuilds every 5s. **NEW finding (reviewer)** — scanner missed. | UI dashboard | `src/components/dashboard/Sparkline.tsx:57-58,98,113`; `src/components/dashboard/MetricsCards.tsx` (0 memo hooks) | confidence::confirmed | OPEN (2026-05-21) — fix: (a) `React.memo` `Sparkline` keyed on stable `values` ref; (b) `useMemo` for `data = buildData(values)` and tooltip formatter inside `Sparkline`; (c) `React.memo` dashboard cards on snapshot input. Verify via React DevTools Profiler over a 5-min poll. |
| PERF-2026-05-21-06 | P2 | 36 | Schema-cache eviction is TTL-only; no per-entry LRU/`maxEntries` bound. `2 entries/graph × G graphs` resident for 120 s; G=100 graphs → ~200 entries. Promote from `perf-context.md §7` "Unknown" to tracked. | Backend schema cache | `internal/server/schema_cache.go:34,76-86,121-125` | confidence::confirmed | OPEN (2026-05-21) — fix: add hard cap (`maxEntries = 256` is plenty); LRU eviction (Go Map preserves insertion order; re-insert on hit). |
| PERF-2026-05-21-07 | P2 | 36 | Cytoscape rebuild fully destroys + reinstantiates core on every `sig` change (250 ms debounce). Streaming gate suppresses layout cost while streaming, but rebuild cost itself unmitigated at 5k+ nodes. | UI graph renderer | `src/components/results/graph/useGraphCytoscape.ts:168-347` (specifically `cy.destroy(); cytoscape({…})`) | confidence::suspected | OPEN (2026-05-21) — fix: A/B against incremental `cy.add()` / `cy.remove()` via `make perf-smoke` at n=10k. Suspected pending Cytoscape A/B bench. |
| PERF-2026-05-21-08 | P2 | 32 | `projectSnapshot` runs 11 linear `FindFamily` scans (O(F·11)) per `/api/v1/metrics` request. F is small today (~12 families) so ~132 strcmps, but asymptotic risk + no bench coverage. | Backend metrics projection | `internal/server/handlers_metrics.go:228-281`; `internal/server/promparse.go:355-362` | confidence::suspected | OPEN (2026-05-21) — fix: expose the `families map[string]*MetricFamily` already built in `ParseProm` on the `MetricFamily` return; one O(1) lookup per family. Suspected pending `BenchmarkProjectSnapshot` (see PERF-2026-05-21-01). |
| PERF-2026-05-21-09 | P2 | 24 | `pushSynthesisedRows` walks `rows` TWICE (lines 41-77 then 99-134) to first build synthetic nodes, then emit synthetic edges. Each pass rebuilds `varProps` per row. **NEW finding (reviewer)** — scanner missed. | UI graph-result synthesis | `src/lib/graphResult/pushSynthesisedRows.ts:41-134` | confidence::suspected | OPEN (2026-05-21) — fix: single sweep capturing `varProps` per row in an array of `Map<string,Record<string,unknown>>` during pass 1; reuse in pass 2. Reduces intermediate map allocs from 2N → N. Suspected pending Jest microbench on 1k synthetic-row input. |
| PERF-2026-05-21-10 | P3 | 24 | `formatCell` calls `JSON.stringify` per cell for arrays/generic objects; used by every `TableView` cell AND row-height estimator (double work). | UI cell formatter | `src/lib/cellFormat.ts:99,105` | confidence::suspected | OPEN (2026-05-21) — fix: cache stringified form on first render via column projection OR detect "small primitive cell" fast-path. Suspected pending microbench. |
| PERF-2026-05-21-11 | P3 | 16 | HTTP streaming flush cadence is hard-coded `streamFlushEvery = 64` rows; no bench established for chunk-size sensitivity. At 100k rows = 1562 flushes. | Backend result codec | `internal/server/result_codec.go:390,499` | confidence::suspected | OPEN (2026-05-21) — fix: A/B `streamFlushEvery = 64` vs 128 vs 256 via `BenchmarkStreamQueryResult_1k5Col`. Watchlist; not necessarily wrong, just unvalidated. |
| PERF-2026-05-21-12 | P3 | 12 | `projectSnapshot` per-call `make([]MetricsHistogramBucket, 0, len(...))` — heap alloc per 5 s `/metrics` request. | Backend metrics projection | `internal/server/handlers_metrics.go:237` | confidence::suspected | OPEN (2026-05-21) — fix: pool small per-request slices (`sync.Pool`). Modest; bucket count is ~12. Suspected pending `BenchmarkProjectSnapshot`. |
| PERF-2026-05-21-13 | P3 | 8 | `scanQueryResult` row slice `make([]jsontext.Value, 0)` — no capacity hint; N is known from `rows.Next()` loop ahead. Cold path (MCP `query` tool + Tx Run only). | Backend result codec | `internal/server/result_codec.go:574` | confidence::confirmed | OPEN (2026-05-21) — RE-NOTED from "Dropped 2026-05-17 D1". Cold-path watchlist; not worth a full close-and-fix, just visibility. |
| PERF-2026-05-21-14 | Info | 4 | `metricsUpstreamTimeout = 2s` is set BOTH on `client.Timeout` AND on `context.WithTimeout` of the outbound request — duplicative; the context timeout alone suffices. | Backend metrics fetcher | `internal/server/handlers_metrics.go:53,166,214-219` | confidence::confirmed | OPEN (2026-05-21) — cosmetic code-smell; no perf issue. Fold into PERF-2026-05-21-03 fix when the `*http.Transport` singleton lands. |

### Top 10 by PerfScore (2026-05-21 OPEN set, all cohorts)

1. **PERF-2026-05-21-01 (PerfScore 100, P1)** — Meta-blocker: bench-gate `allow_failure:true` + 5 missing benches. **Single highest-leverage closure.**
2. **PERF-2026-05-21-02 (PerfScore 80, P1)** — SPA shared-clock missing; 3 pollers per tab.
3. **PERF-2026-05-21-03 (PerfScore 64, P1)** — Per-call `&http.Client{}` (metrics + HIBP); no `http.Transport` tuning anywhere.
4. **PERF-2026-05-21-04 (PerfScore 64, P1)** — `lspFrameReader` byte-by-byte header read.
5. **PERF-2026-05-21-05 (PerfScore 48, P2)** — Sparkline + dashboard cards lack memoization (NEW).
6. **#294 / PERF-2026-05-19-02 (PerfScore 48, P2)** — `layoutCache.get` clones full PosMap on hit (reverified).
7. **PERF-2026-05-21-06 (PerfScore 36, P2)** — Schema-cache TTL-only; no LRU bound.
8. **PERF-2026-05-21-07 (PerfScore 36, P2)** — Cytoscape full rebuild on every `sig` change.
9. **#302 / PERF-2026-05-19-04 (PerfScore 36, P2)** — WS protocol JSON-only design exercise (reverified).
10. **#306 / PERF-2026-05-19-05 (PerfScore 32, P2)** — `streamRowsOverWS` sequential scan→encode→write (reverified).

### Meta-Blocker (2026-05-21)

`bench-gate` job at `.gitlab-ci.yml:472-473` is `allow_failure: true`, AND five hot-path benchmarks do NOT exist in the tree:

- `BenchmarkParseProm` — Prom text-exposition parser (5s-poll hot path)
- `BenchmarkProjectSnapshot` — 11× `FindFamily` projection (5s-poll hot path)
- `BenchmarkHandleMetrics` — end-to-end /metrics fetch + parse + project + JSON
- `BenchmarkLspFrameReader*` — header byte-by-byte read; case-insensitive Content-Length
- `BenchmarkHibpHasSeen` — TLS handshake on every login / password-change

**Consequence:** every `confidence::suspected` finding in the 2026-05-21 cohort (and the carry-overs that depend on these paths) is **invisible to MR review** today. A 5× regression in `ParseProm` would not fail bench-gate (no benchmark) AND even where benchmarks exist (`BenchmarkStreamQueryResult_*`, `BenchmarkStreamRowsOverWS_*`, `BenchmarkSchemaCache_*`, `BenchmarkAuditRing_*`, `BenchmarkPoolDB*`, `BenchmarkLoginLimiter_*`, `BenchmarkProfileLimiter_*`, `BenchmarkCancelReader_*`), bench-gate `allow_failure: true` means a 10 %+ delta cannot block an MR — it only emits an advisory annotation.

**Suggested cohort order** (advisory; not in scope to file in this --skip-issues pass):

1. Add the five missing benchmarks (`PERF-2026-05-21-01` part A); regenerate `bench-baseline.txt` per the 2026-05-17 cadence rule. Enables PERF-2026-05-21-03, -04, -06, -08, -12 to land safely.
2. Single `*http.Transport` singleton (`PERF-2026-05-21-03`).
3. Flip `bench-gate` to `allow_failure: false` (`PERF-2026-05-21-01` part B).
4. `bufio` rewrite of `lspFrameReader` (`PERF-2026-05-21-04`).
5. Frontend polling clock hub (`PERF-2026-05-21-02`).
6. Drop `layoutCache.get` read-side clone (#294).
7. Map-fronted family lookup in `projectSnapshot` (`PERF-2026-05-21-08`).
8. Memoize `Sparkline` + dashboard cards (`PERF-2026-05-21-05`).
9. Schema-cache LRU bound (`PERF-2026-05-21-06`).
10. `pushSynthesisedRows` single-pass (`PERF-2026-05-21-09`).
11. `streamRowsOverWS` producer/consumer split (#306).

### Severity Counts (2026-05-21)

| Severity | Count (new + reverified) | Net-new from reviewer |
|---|---:|---:|
| P0 | 0 | 0 |
| P1 | 4 (PERF-2026-05-21-01/-02/-03/-04) | 0 net-new; 3 were scanner P2 upgraded |
| P2 | 7 (PERF-2026-05-21-05/-06/-07/-08/-09 + carry-overs #294, #302, #306) | 2 net-new (PERF-2026-05-21-05 Sparkline memo; PERF-2026-05-21-09 pushSynthesisedRows two-pass) |
| P3 | 5 (PERF-2026-05-21-10/-11/-12/-13 + watchlist) | 0 |
| Info | 1 (PERF-2026-05-21-14 cosmetic) | 1 |

## Findings By Area

### App/UI (open as of 2026-05-17 Phase 4)

- #275 (P2/~50, suspected): `useGraphElements` rowsVersion rebuild guardrail — pin the cascade win from #239/#249 so a future refactor can't silently undo it.
- #284 (P3/~20): `perfMarks.ts` only observes `measure`, not `longtask` — main-thread blocks are invisible.
- #285 (P3/~25, suspected): 3.7 MiB largest async chunk; no chunk-budget tripwire in CI.
- #286 (P3/~20): `graphStatsCache` unbounded Map; entries for never-revisited graphs leak in long-running sessions.

### Backend, DB, Generated Runtime (open as of 2026-05-17 Phase 4)

- #278 (P3/~20): No `net/http/pprof` endpoint; perf debugging requires a fresh build with manual instrumentation.
- #281 (P3/~20): No `Server-Timing` headers; per-stage latency invisible in DevTools.

### CI/CD And Release (open as of 2026-05-17 Phase 4)

- #259 (P2/~50, with implementation plan now pinned as a comment): brotli precompression for SPA bundles.

### Closed in 2026-05-17 round-3 cohort (see GAP_ANALYSIS_RESOLVED.md)

- Streaming/UI memo + reducer: #239, #240, #249.
- AuditLogPage + audit ring: #243, #246.
- Backend WS row slab pool: #251.
- LSP reconnect jitter: #254.
- webpackPrefetch hints: #256.
- CSRF refresh singleflight: #257.
- Baseline regeneration: #260.

### Closed in 2026-05-16 cohort (see GAP_ANALYSIS_RESOLVED.md)

- App/UI: #234, #236, #216, #237, #222, #224 (and #213, marked no-longer-applicable on 2026-05-17 after the multi-pane editor surface was deleted).
- Backend: #217, #218, #225, #165, #219, #221.
- Needs-genapi: #238, #171, #167, #169, #163.
- CI/Release: #235.

### Closed in 2026-05-17 Phase 4 verification

- CI/CD: #229 — verified fixed via `.gitlab-ci.yml:382-398` artifact reuse; row moved out of open table.

## Bundling Recommendation (2026-05-17 Phase 4)

The streaming/audit epics from prior cohorts have all landed. Phase 4 surfaces a smaller observability-and-hygiene bundle:

Epic A — **PERF-EPIC-OBSERVABILITY** (bundle #278, #281, #284):

- `net/http/pprof` gated on `GEODE_PPROF=1`, loopback-only -> #278.
- `Server-Timing` middleware on `POST /api/v1/query` -> #281.
- `perfMarks.ts` adds `longtask` entry type + budget threshold -> #284.

Epic B — **PERF-EPIC-BUNDLE-HYGIENE** (bundle #259, #285):

- Brotli precompression at build + serving negotiation -> #259 (plan pinned as comment).
- Async chunk budget tripwire in CI -> #285.

Epic C — **PERF-EPIC-GUARDRAILS** (bundle #275, #286):

- `useGraphElements` rowsVersion rebuild regression test -> #275.
- `graphStatsCache` LRU cap -> #286.

## Bundling Recommendation (2026-05-21 Phase 4)

The 2026-05-21 cohort surfaces a coherent four-epic bundle. **Order matters** because the bench-coverage gap meta-blocker (PERF-2026-05-21-01) gates the regression-net for every other suspected-confidence finding.

Epic A — **PERF-EPIC-BENCH-NET** (PERF-2026-05-21-01) — **single highest-leverage closure**:

- Add the five missing benches: `BenchmarkParseProm`, `BenchmarkProjectSnapshot`, `BenchmarkHandleMetrics`, `BenchmarkLspFrameReader*`, `BenchmarkHibpHasSeen`.
- Regenerate `bench-baseline.txt` per the 2026-05-17 cadence rule.
- Flip `.gitlab-ci.yml:472-473` `bench-gate` to `allow_failure: false`.

Epic B — **PERF-EPIC-HTTP-OUT** (PERF-2026-05-21-03, PERF-2026-05-21-14):

- Package-level `*http.Transport` singleton via `sync.Once` (or DI through `Config`) with `MaxIdleConnsPerHost: 32`, `MaxIdleConns: 256`, `IdleConnTimeout: 90s`, `ForceAttemptHTTP2: true`.
- Wire `metricsHTTPClient` and `hibpHasSeen` to the singleton. Drop duplicative `client.Timeout` (context timeout suffices).

Epic C — **PERF-EPIC-LSP-BUFIO** (PERF-2026-05-21-04):

- `bufio.NewReaderSize(tcp, 4096)` wrapper; `ReadString('\n')` for header lines; `io.ReadFull` for body; `strconv.Atoi(bytes.TrimSpace(...))` for Content-Length.

Epic D — **PERF-EPIC-SPA-CLOCK** (PERF-2026-05-21-02, PERF-2026-05-21-05):

- `usePollingClock` hub owning one `setInterval(1000)`; coalesced `tick:5s` / `tick:30s` events.
- `React.memo` wrap on `Sparkline`, `MetricsCards`, and other `dashboard/*.tsx` cards; `useMemo` for `buildData(values)` + tooltip formatter inside `Sparkline`.

## Roadmap

Quick wins (< 1 day):

- **PERF-2026-05-21-13** — `scanQueryResult` capacity hint (cold path; ~5 LOC).
- **PERF-2026-05-21-14** — drop duplicative `client.Timeout` on metrics fetcher (cosmetic; folds into Epic B).
- **#294** — `layoutCache.get` clone removal (the stored Map is already private; ~10 LOC + test).

Medium (1-5 days):

- **PERF-EPIC-BENCH-NET (-01)** — five benchmarks + baseline regen + `allow_failure` flip (~250 LOC tests + CI tweak).
- **PERF-EPIC-HTTP-OUT (-03, -14)** — Transport singleton + wire two callers (~80 LOC + bench).
- **PERF-EPIC-LSP-BUFIO (-04)** — `bufio` rewrite + bench (~50 LOC + bench).
- **PERF-EPIC-SPA-CLOCK (-02, -05)** — `usePollingClock` hub + memo dashboard cards (~150 LOC + tests).
- **PERF-2026-05-21-06** — schema-cache LRU bound (~40 LOC + test).
- **PERF-2026-05-21-08** — `projectSnapshot` map-fronted family lookup (~30 LOC + bench).
- **PERF-2026-05-21-09** — `pushSynthesisedRows` single-pass (~60 LOC + microbench).
- **#306** — `streamRowsOverWS` producer/consumer split (~120 LOC + alloc-count contract).

Strategic (> 5 days):

- **PERF-2026-05-21-07** — Cytoscape A/B incremental `cy.add()`/`cy.remove()` vs full rebuild on `sig` change (design + perf-smoke baseline).
- **#302** — WS protocol MessagePack/CBOR design + bench (no implementation).
- **PERF-2026-05-21-11** — `streamFlushEvery` A/B at 64/128/256 (~bench + decision).

Historical (kept for trace):

- #275 — `useGraphElements` rebuild-count regression test. **Closed 2026-05-17.**
- #278 — gated pprof loopback server. **Closed 2026-05-17.**
- #284 — `perfMarks.ts` longtask observe + budget warn. **Closed 2026-05-17.**
- #286 — `graphStatsCache` LRU cap. **Closed 2026-05-17.**
- #281 — `Server-Timing` middleware. **Closed 2026-05-17.**
- #285 — bundle-budget tripwire. **Closed 2026-05-17.**
- #259 — brotli precompression. **Closed 2026-05-17.**

Strategic (> 5 days):

- Replace assumed SLOs in `docs/ARCHITECTURE.md` with production telemetry: query p95/p99, result sizes, graph property cardinality, concurrent streams, dashboard stats usage, bundle/image pull sizes.
- Add browser performance budgets for table/graph/matrix rendering: long tasks, heap delta, and first interactive after result arrival. (#284 lays the foundation.)
- Add generated-runtime benchmarks for MCP batch scheduling (#238 needs-genapi), result codec allocation, compression thresholds, and rate-limiter lock paths.
- Introduce a safe large-result UX contract: pagination, streaming backpressure, row caps, and export/download paths for data too large for interactive rendering. (#240 + #243 closed the immediate streaming gaps; the contract still needs documenting.)

## Unknowns And Confirmation Needed

- **(2026-05-21)** Every `confidence::suspected` finding in the 2026-05-21 cohort (PERF-2026-05-21-04, -07, -08, -09, -10, -11, -12) is gated on the bench-coverage net in PERF-2026-05-21-01. Until that lands, regressions in `ParseProm`, `ProjectSnapshot`, `HandleMetrics`, `lspFrameReader`, and `hibpHasSeen` cannot be detected by CI.
- **(2026-05-21)** Workload assumption: ~50 concurrent dashboards (peak) drives the PERF-2026-05-21-02 / -03 / -05 scaling math. This is a planning estimate, not a measurement; revise upward if production telemetry surfaces higher tab fan-out.
- **(2026-05-21)** No fixture exists for `BenchmarkParseProm` and `BenchmarkHandleMetrics` against a representative upstream Prom blob — the bench author should capture a real `~30 KiB` `geode` `/metrics` response into `testdata/` rather than synthesize one.
- No production telemetry was available. SLOs, RPS, graph sizes, and result distributions are inherited assumptions from `docs/ARCHITECTURE.md`.
- `2749.*.js` is the largest async chunk at ~6.4 MiB. We have not confirmed whether it is one library (Monaco language services + worker) or two co-bundled lazy targets that should be split. #285's bundle-analyzer artifact is the path to confirm.
- For #275's regression pin: needs a decision on how to spy on the 3-Map rebuild — sentinel via module-scoped counter, OR rely on Map identity stability between renders. Both work; the test author should pick one.
- For #284: Safari does not support `longtask` entries; the `observer.observe()` call must be wrapped in try/catch. Confirmed safe via spec but worth verifying in jsdom test env.
- `benchstat` baseline regenerated at 0983456 (post round-3 cohort close). Cadence rule documented above: regenerate per cohort close.
- The local Node used for synthetic harnesses was Node v20.19.2 while `package.json` requires Node >=22.14.0. Treat the frontend timings as directional evidence; re-run under the repo Node version before closing issues.
