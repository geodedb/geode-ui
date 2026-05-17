# Performance Gap Analysis

Last updated: 2026-05-17

Scope: app code, generated clients/servers, Go backend, React/Electron UI, CI/CD, Docker/release config, scripts, and performance-relevant docs. This review is non-destructive; product code was not changed.

## Summary

- Open performance/scalability gaps tracked in this update: 14 (10 newly opened on 2026-05-17 + 4 carried open from 2026-05-15).
- New GitLab issues created in this pass (2026-05-17): 10 — #239, #240, #243, #246, #249, #251, #254, #256, #257, #259.
- Carried-open issues: #229, #218 (closed but kept in table for cross-ref), #237 (closed but kept), #238 (closed needs-genapi), and the genapi-blocked closures (#171, #167, #169, #163).
- Resolved-and-moved-to-RESOLVED.md from the 2026-05-15 pass: #234, #235, #236, #216, #218, #237, #238, #217, #225, #222, #171, #165, #167, #169, #219, #163, #221, #224 (the 2026-05-13/15 closure cohort).
- Confirmed findings (2026-05-17): 10. Suspected findings needing workload/profiler confirmation: 0.
- Highest-risk root cause: `streamStateToResp` busts memos on every WS batch (#239), cascading reprojection/JSON.stringify/3-Map-rebuild work even after #234's row-display cap landed.

Top 5 by PerfScore (2026-05-17 open set):

1. #239 (PerfScore 100, P0) — `streamStateToResp` allocates fresh `QueryResp` per WS batch; busts TableView, JsonView, and useGraphElements memos on every frame.
2. #240 (PerfScore 100, P0) — `queryStreamReducer.state.rows` unbounded; 100k-row stream retains all rows even though display cap is 5,000.
3. #243 (PerfScore 80, P0) — AuditLogPage refetches per keystroke; server returns full 10k-entry ring with no pagination.
4. #249 (PerfScore 64, P1) — useGraphElements rebuilds 3 Maps per baseEls change (cascades from #239).
5. #251 (PerfScore 60, P1) — `streamRowsOverWS` allocates row + ptrs slabs per row; pool ptrs.

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

Baseline measurements (carried from 2026-05-15 — STALE since 2026-05-12 closure cohort that landed #217/#218/#221/#222/#225/#237):

- Go curated benchmark subset (2026-05-15):
  - Command: `GOEXPERIMENT=jsonv2 GOTOOLCHAIN=go1.26.3 timeout 5m go test -bench=. -benchmem -run='^$' -benchtime=50ms -count=1 ./internal/conn/ ./internal/server/ ./internal/jwt/ ./gen/pkg/wsx/ ./gen/pkg/oidcx/ ./gen/pkg/securex/ ./gen/pkg/gen/`
  - Notable result: `BenchmarkStreamQueryResult_PerRowAlloc` 2.948 ms/op, 147,828 B/op, 3,390 allocs/op (pre #217 close; rerun expected to show ~808 allocs/op).
- Webpack production build (2026-05-15): 96.758s compile, 99.519s shell elapsed.
- Embedded asset size (2026-05-15): `internal/ui/dist` 65M, source maps 48.78 MiB, stripped binary 85M.
  - **Post #235 close (2026-05-16):** dist drops to 16M, zero `.map` files.
- Synthetic frontend hot-path harnesses (2026-05-15):
  - Streaming reducer + table projection: 500 frames, 32k rows, 13,383.3 ms projection, +89.7 MB heap (pre #234 close).
  - High-cardinality `projectColumns`: 200 rows x 20 props, 4,001 cols, 309.7 ms (pre #236 close).

**Bench-baseline refresh recommended (2026-05-17):** the 2026-05-15 baseline is now 5 days stale and pre-dates the entire 2026-05-16 closure cohort (#217, #218, #221, #222, #225, #237, #234, #235, #236, #216, #237, #238 needs-genapi, #171 needs-genapi, #165, #167 needs-genapi, #169 needs-genapi, #219, #163 needs-genapi, #224). Recommend re-running the Go bench subset and the streaming harness against the current `main` to capture the post-closure baseline before scoring the 2026-05-17 findings' validation deltas. Suggested command:

```bash
GOEXPERIMENT=jsonv2 GOTOOLCHAIN=go1.26.3 timeout 5m go test -bench=. -benchmem -run='^$' -benchtime=100ms -count=3 \
  ./internal/conn/ ./internal/server/ ./internal/jwt/ ./gen/pkg/wsx/ ./gen/pkg/oidcx/ ./gen/pkg/securex/ ./gen/pkg/gen/ \
  | tee docs/performance/2026-05-17-baseline.bench.txt
```

## Stack-Ranked Findings

| Rank | PerfSeverity | PerfScore | Finding | Component | Evidence | Measurement | GitLab Issue | Fix Summary | Owner | SLA/Due | Status |
|---:|---|---:|---|---|---|---|---|---|---|---|---|
| 1 | P0 | 100 | `streamStateToResp` allocates fresh QueryResp every WS batch — busts TableView/JsonView/useGraphElements memos | Query stream, table renderer, JSON view, graph elements | `src/pages/QueryPage.tsx:104-111`; `src/components/results/TableView.tsx:447-450`; `src/components/results/JsonView.tsx:28-31`; `src/components/results/graph/useGraphElements.ts:91-158` | 10k rows / 64-row batches = 156 batches; equivalent of ~8s main-thread + ~80 MB allocator churn (cf. 2026-05-15 baseline 13.38s/32k rows) | [#239](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/239) | `useMemo` keyed on `stream.rowsVersion` + add rAF throttle for resp derivation | UI performance | Current sprint | confidence::confirmed, status::triage |
| 2 | P0 | 100 | `queryStreamReducer.state.rows` unbounded; display cap 5,000 but retention is full stream | Query stream reducer, Electron heap | `src/pages/queryStreamReducer.ts:79-98` | 100k-row stream: ~95% RAM reduction achievable with 25k retention cap | [#240](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/240) | Configurable retention cap (default 25k); overflow banner + server-spool export | UI performance + Backend | Current sprint | confidence::confirmed, status::triage |
| 3 | P0 | 80 | AuditLogPage refetches per keystroke; server returns full 10k-entry ring without pagination | Ops UI + audit handler | `src/components/ops/AuditLogPage.tsx:118-133`; `internal/server/handlers_audit.go:36-51` | 5-char typing burst -> 5 fetches each returning full ring | [#243](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/243) | 300ms debounce on filter inputs + server-side `limit`/`cursor` pagination | UI + Backend | Current sprint | confidence::confirmed, status::triage |
| 4 | P1 | 64 | `useGraphElements` rebuilds 3 Maps per `baseEls` change (cascades from #239) | Graph elements memo | `src/components/results/graph/useGraphElements.ts:91-158` | ~1.56M Map.set ops across a 10k-row graph stream; cascade-resolves with #239 | [#249](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/249) | Verify cascade fix from #239; defense-in-depth memo key on `stream.rowsVersion` | UI performance | Bundle with #239 | confidence::confirmed, status::triage |
| 5 | P1 | 60 | `streamRowsOverWS` allocates row + ptrs slabs per row | Backend WS sender | `internal/server/ws_query.go:377-382` | ~210 B/row pure slab overhead; ~21 MB per 100k-row stream | [#251](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/251) | Pool `ptrs` via `sync.Pool` keyed on `len(cols)`; investigate row pool if batcher copies | Backend | Bundle with PERF-EPIC-STREAM | confidence::confirmed, status::triage |
| 6 | P1 | 48 | audit ring uses `sync.Mutex`; snapshot blocks emit hot path | Backend audit ring | `internal/server/audit.go:115-120,169-197` | p99 emit latency picks up 250-500 µs spike on /audit poll-during-emit-burst | [#246](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/246) | Swap to `sync.RWMutex`; snapshot takes RLock | Backend | Next sprint | confidence::confirmed, status::triage |
| 7 | P1 | 48 | Table projection explodes high-cardinality graph properties into dense columns | Table renderer | `src/components/results/projectColumns.ts:123-135,162-229`; `src/components/results/TableView.tsx:284-300,355-395` | 200 rows x 20 unique props -> 4,001 cols, 800,200 cells, 309.7 ms, +10.5 MB | [#236](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/236) | columnBudget=64 + overflow banner + per-plan distribution | UI performance | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 8 | P1 | 48 | Matrix view renders dense O(labels^2) table cells | Matrix renderer | `src/components/results/MatrixView.tsx:146-168` | Not benchmarked in this pass; code path is dense by inspection | [#216](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/216) | Sparse/windowed matrix rendering and label-count benchmarks | UI performance | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 9 | P2 | 48 | WebSocket query cancel reader uses two goroutines per session | Backend WebSocket | `internal/server/ws_query.go:300-341` | Goroutine count at 1000 sessions: pre 2000+slack, post 1.5N | [#218](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/218) | Single-goroutine cancelReader with deadline-poison wakeup | Backend | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 10 | P2 | 36 | Dashboard graph stats run two uncached full-graph count queries | Dashboard, query API, DB | `src/lib/useOverviewData.ts:93-110`; `src/pages/DashboardPage.tsx:55-62` | Not measured against real Geode graph; suspected full graph scans | [#237](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/237) | 60s TTL client cache keyed on (connectionId, graphName) | UI | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 11 | P2 | 36 | MCP JSON-RPC batch requests execute serially | MCP engine | `gen/pkg/mcpx/engine.go:315-326,451-462` | Need fake-tool sleep benchmark; recorded upstream design | [#238](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/238) | Bounded errgroup parallel scheduler with per-tool opt-out | MCP/backend (upstream genapi) | Blocked on genapi | **Closed-as-needs-genapi (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 12 | P2 | 36 | Result streaming/cold result paths still carry row serialization allocation pressure | Result codec | `internal/server/result_codec.go:87-94,237-277` | Pre #217: 3,390 allocs/op; post: 808 allocs/op (76% reduction) | [#217](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/217) | Pooled row scratch + summary accumulator + marshalRowFast | Backend | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 13 | P2 | 32 | Login/profile limiter maps are unbounded by TTL eviction | Rate limiting | `internal/server/loginlimiter.go:215-218,316-321`; `internal/server/profilelimiter.go:94-171` | 50k unique IPs heap-bounded at 2MB with MaxEntries=1000 | [#225](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/225) | StartJanitor + MaxIdle + MaxEntries hard cap | Backend | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 14 | P2 | 32 | GraphView resize/rebuild coalescing needs regression pin | Graph renderer | `src/components/results/graph/useGraphCytoscape.ts:276,394-399` | 50 schedule calls in 5 frames -> 5 refits (rAF coalesced) | [#222](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/222) | createResizeCoalescer helper + regression test | UI performance | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 15 | P1 | 36 | LSP reconnect schedule has no jitter; thundering herd on bounce | UI LSP client | `src/lib/lsp/client.ts:28,71-89` | 100 tabs all retry at T+500/2000/6500ms wall-synchronized | [#254](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/254) | Equal-jitter strategy: delay = base/2 + random*base/2 | UI/LSP | Bundle with PERF-EPIC-INFRA | confidence::confirmed, status::triage |
| 16 | P1 | 32 | Lazy imports lack `webpackPrefetch` hints for Monaco/Cytoscape/reagraph | UI bundling | `src/pages/QueryPage.tsx:33-37`; `src/components/results/ResultPanel.tsx:14-18` | First graph tab click: 50-300 ms saved with prefetch | [#256](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/256) | Add `webpackPrefetch: true` + `webpackChunkName` magic comments | UI build/perf | Bundle with PERF-EPIC-INFRA | confidence::confirmed, status::triage |
| 17 | P2 | 60 | Production source maps are embedded and served with the SPA bundle | Release artifact, static server | `webpack.prod.js:24-25`; `internal/ui/embed.go:15-16,28-32,57-64` | Build 99.519s; dist 65M->16M after close; maps 48.78 MiB; binary 85M | [#235](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/235) | Gate `devtool` on `EMBEDDED_BUILD=1` env | Release/platform | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 18 | P2 | 60 | CI rebuilds webpack inside `go:test` instead of reusing canonical artifact | CI/CD | `.gitlab-ci.yml:236-245,324-331` | Current `npm run build` elapsed 99.519s; duplicated in pipeline | [#229](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/229) | Reuse build artifact or stub embedded UI for Go tests | CI/platform | Next CI cleanup | confidence::confirmed, status::triage |
| 19 | P1 | 80 | Streaming query table projection recomputes all accumulated rows per WebSocket batch | Query stream, table renderer | `src/pages/queryStreamReducer.ts:89-98`; `src/pages/QueryPage.tsx:325-334`; `src/components/results/TableView.tsx:441-443`; `src/components/results/projectColumns.ts:110-229` | 500 frames / 32k rows -> 13.38s projection, +89.7 MB heap | [#234](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/234) | rowDisplayCap=5000 + columnBudget=64 + NDJSON export | UI performance | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md; residual rAF-throttle gap (#234b) now tracked by #239. |
| 20 | P1 | 24 | `refreshCsrfToken()` stampede under concurrent 403s | API client | `src/api/client.ts:73-87` | Burst of 10 concurrent 403s -> 10 concurrent /api/csrf fetches | [#257](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/257) | Singleflight guard around `refreshCsrfToken` | API client | Bundle with PERF-EPIC-INFRA | confidence::confirmed, status::triage |
| 21 | P3 | 24 | HMAC body signing is still non-streaming when body limit is raised | Auth/security middleware | `gen/pkg/securex/secure.go:318-359` | 100MB custom-limit path: 908.97 ms/op, 268.46 MB/op; default cap is 1 MiB | [#171](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/171) | True streaming/replayable body strategy | Backend (upstream genapi) | Blocked on genapi | **Closed-as-needs-genapi (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 22 | P3 | 24 | `Pool.DB` uses a global mutex on read-mostly cache hits | DB pool | `internal/conn/pool.go:165-189` | RunParallel 108.9 ns/op vs serial 95.6 ns/op (post-fix) | [#165](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/165) | Swap to RWMutex; fast-path RLock | Backend/DB | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 23 | P3 | 24 | Per-route bucket takes separate snapshot and allow locks | Generated HTTP limiter | `gen/pkg/securex/secure.go:435` and generated rate-limit wrappers | Not re-benchmarked in this pass | [#167](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/167) | Add combined `AllowAndSnapshot` path | Generated backend (upstream genapi) | Blocked on genapi | **Closed-as-needs-genapi (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 24 | P3 | 24 | Stream gzip can engage on tiny TTFB flushes | HTTP compression | `gen/pkg/httpx/compress.go`; `internal/server/result_codec.go:164` | Not re-benchmarked in this pass | [#169](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/169) | Buffer first 1024 bytes; defer gzip activation | Backend (upstream genapi) | Blocked on genapi | **Closed-as-needs-genapi (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 25 | P3 | 16 | Column descriptors are marshaled per column | Result codec | `internal/server/result_codec.go:76-96` | Pre 83,127 ns/op; post 45,141 ns/op (45% faster) | [#219](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/219) | `encodeColumnDescs` reusable buffer + tokens | Backend | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 26 | P3 | 16 | gzip response wrapper allocation likely remains per request | HTTP compression | `gen/pkg/httpx/compress.go` | Not revalidated in this pass | [#163](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/163) | Pool wrapper struct + gzip writer | Backend (upstream genapi) | Blocked on genapi | **Closed-as-needs-genapi (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 27 | P3 | 16 | `driftSeen` uses a mutex for read-mostly warning dedupe | User/admin handlers | `internal/server/handlers_users.go:666-688` | RunParallel post-fix 90.39 ns/op | [#221](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/221) | Swap to RWMutex; first-sighting double-checked under write lock | Backend | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 28 | P3 | 12 | Audit log polling is visibility-gated but lacks regression pin | Ops UI | `src/components/ops/AuditLogPage.tsx:114,156` | No current regression observed | [#224](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/224) | Regression test for visibility-gated polling | UI/ops | n/a | **Closed (2026-05-16)** — see GAP_ANALYSIS_RESOLVED.md |
| 29 | P2 | 32 | No brotli for SPA bundles; gzip-only | HTTP compression | `internal/ui/embed.go:75-83` | ~30% smaller bundles on modern browsers (~1 MiB saved over the wire on the 16M post-#235 dist) | [#259](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/259) | Brotli precompression at build time + Accept-Encoding preference | Release/platform | Bundle with PERF-EPIC-INFRA | confidence::confirmed, status::triage |

## Findings By Area

### App/UI (open)

- #239 (P0/100): `streamStateToResp` busts memos every WS batch. Dominant remaining streaming cost after the 2026-05-16 closure cohort. This finding alone cascades to TableView, JsonView, and useGraphElements.
- #240 (P0/100): `queryStreamReducer.state.rows` unbounded; introduces a memory-stability risk on 100k-row Electron streams.
- #243 (P0/80): AuditLogPage refetch storm on filter keystroke + server full-ring response.
- #249 (P1/64): useGraphElements 3-Map rebuild (cascade from #239).
- #254 (P1/36): LSP reconnect missing jitter.
- #256 (P1/32): webpackPrefetch hints missing on lazy chunks.
- #257 (P1/24): `refreshCsrfToken()` lacks singleflight.

### Backend, DB, Generated Runtime (open)

- #251 (P1/60): `streamRowsOverWS` per-row slab+ptr alloc.
- #246 (P1/48): audit ring Mutex -> RWMutex.
- #243 (P0/80, cross-listed with UI): server-side audit pagination needed.

### CI/CD And Release (open)

- #229 (P2/60): CI rebuilds webpack inside `go:test`. Carried open from 2026-05-15; still actionable.
- #259 (P2/32): brotli precompression for SPA bundles.

### Closed in 2026-05-16 cohort (see GAP_ANALYSIS_RESOLVED.md)

- App/UI: #234, #236, #216, #237, #222, #224 (and #213, removed 2026-05-17 due to workspace deletion).
- Backend: #217, #218, #225, #165, #219, #221.
- Needs-genapi: #238, #171, #167, #169, #163.
- CI/Release: #235.

## Bundling Recommendation

Epic 1 — **PERF-EPIC-STREAM** (bundle #239, #249, #240, #251):

- Fix `streamStateToResp` (single useMemo + rowsVersion key) -> cascade-resolves #249.
- Add reducer retention cap -> #240.
- Pool `streamRowsOverWS` ptrs -> #251.
- Validate end-to-end with a 100k-row synthetic stream harness.

Epic 2 — **PERF-EPIC-AUDIT** (bundle #243, #246):

- Debounce filter inputs + server-side `limit`/`cursor` pagination -> #243.
- Swap audit ring Mutex to RWMutex -> #246.
- Bench: emit-during-snapshot contention.

Epic 3 — **PERF-EPIC-INFRA** (bundle #254, #256, #257, #259):

- LSP reconnect jitter -> #254.
- webpackPrefetch hints -> #256.
- CSRF refresh singleflight -> #257.
- Brotli precompression -> #259.

## Roadmap

Quick wins (< 1 day):

- #239 — `useMemo` wrap on `streamStateToResp` (5 LOC).
- #254 — equal-jitter on LSP backoff (5 LOC).
- #257 — singleflight CSRF refresh (5 LOC).
- #246 — audit ring `sync.Mutex` -> `sync.RWMutex` (3 LOC + bench).
- #256 — `webpackPrefetch: true` comments (5 LOC).

Medium (1-5 days):

- #240 — reducer retention cap + overflow surface (depends on UX decision for server-spool export).
- #243 — debounce + server pagination contract (touches API surface).
- #249 — verify #239 cascade with React profiler bench.
- #251 — pool `ptrs` (audit batcher row retention contract).
- #259 — brotli precompression + asset-serving negotiation.
- #229 — CI: stop rebuilding webpack inside `go:test`.

Strategic (> 5 days):

- Replace assumed SLOs in `docs/ARCHITECTURE.md` with production telemetry: query p95/p99, result sizes, graph property cardinality, concurrent streams, dashboard stats usage, bundle/image pull sizes.
- Add browser performance budgets for table/graph/matrix rendering: long tasks, heap delta, and first interactive after result arrival.
- Add generated-runtime benchmarks for MCP batch scheduling (#238 needs-genapi), result codec allocation, compression thresholds, and rate-limiter lock paths.
- Introduce a safe large-result UX contract: pagination, streaming backpressure, row caps, and export/download paths for data too large for interactive rendering.

## Unknowns And Confirmation Needed

- No production telemetry was available. SLOs, RPS, graph sizes, and result distributions are inherited assumptions from `docs/ARCHITECTURE.md`.
- 2026-05-15 baseline is stale (pre 2026-05-16 closure cohort); refresh before validating 2026-05-17 finding deltas. Suggested command listed under "Baseline measurements" above.
- For #243's server pagination: the `AuditQuery` shape may be generated from `geode.json` via `genapi`; confirm whether `limit`/`cursor` additions are upstream changes.
- For #251's row pool: needs an audit of `batcher.add(row)` to determine whether the row slab is retained past the next iteration.
- `benchstat` was not used locally for this review. The bounded Go benchmark pass used `-count=1` and `-benchtime=50ms`; use CI's pinned `bench-gate` flow for regression decisions.
- The local Node used for synthetic harnesses was Node v20.19.2 while `package.json` requires Node >=22.14.0. Treat the frontend timings as directional evidence; re-run under the repo Node version before closing issues.
