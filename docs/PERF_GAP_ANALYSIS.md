# Performance Gap Analysis

Last updated: 2026-05-15

Scope: app code, generated clients/servers, Go backend, React/Electron UI, CI/CD, Docker/release config, scripts, and performance-relevant docs. This review is non-destructive; product code was not changed.

## Summary

- Findings tracked in this update: 20 open performance/scalability gaps.
- New GitLab issues created: 5 (#234-#238).
- Existing GitLab issues updated/labeled with current review evidence: 15.
- Confirmed findings: 17. Suspected findings needing workload/profiler confirmation: 3.
- Highest-risk root cause: streaming query rendering still reprojects the full accumulated row set per WebSocket batch, measured at 13.38s projection time for a 32k-row synthetic stream.

Top 5 by PerfScore:

1. #234 - Streaming query table projection recomputes all accumulated rows per WebSocket batch.
2. #235 - Production source maps are embedded and served with the SPA bundle.
3. #229 - CI rebuilds the webpack bundle inside `go:test`.
4. #236 - Table projection explodes high-cardinality graph properties into dense columns.
5. #216 - Matrix view renders a dense label x label DOM table.

## Performance Context Snapshot

Repo shape:

- Go backend entrypoint: `cmd/server`, runtime server code under `internal/server`, connection pooling under `internal/conn`, JWT/profile storage under `internal/jwt` and `internal/profilestore`.
- Generated surfaces: `gen/api`, `gen/client`, `gen/pkg/*`, `gen/mcp`, and OpenAPI in `gen/cmd/server/openapi.yaml`.
- Frontend: React/TypeScript under `src`, graph/table result views under `src/components/results`, workspace query panes under `src/pages/workspace`.
- Electron: `electron/` plus built preload/main output under `internal/ui/electron-dist`.
- CI/release/container: `.gitlab-ci.yml`, `.goreleaser.yaml`, `deploy/Dockerfile*`, docker-compose files, and Playwright E2E Dockerfile.

Assumed workload and SLOs:

- `docs/ARCHITECTURE.md:139-160` explicitly marks performance numbers as assumed, not production-measured.
- Current assumptions include about 2,000 rps on `POST /api/v1/query`, about 400 concurrent users, p10-p90 result sets of 1-1,000 rows, and a 100k+ row long tail for streamed queries.
- Real production telemetry, graph cardinality, browser long-task budgets, and MCP batch workloads remain unknown.

Baseline measurements captured during this review:

- Go curated benchmark subset:
  - Command: `GOEXPERIMENT=jsonv2 GOTOOLCHAIN=go1.26.3 timeout 5m go test -bench=. -benchmem -run='^$' -benchtime=50ms -count=1 ./internal/conn/ ./internal/server/ ./internal/jwt/ ./gen/pkg/wsx/ ./gen/pkg/oidcx/ ./gen/pkg/securex/ ./gen/pkg/gen/`
  - Result: PASS.
  - Notable results: `BenchmarkStreamQueryResult_PerRowAlloc` 2.948 ms/op, 147,828 B/op, 3,390 allocs/op; `BenchmarkHMACBody_100MB` 908.97 ms/op, 268.46 MB/op; login/profile limiter hot paths about 9.6 ns/op.
- Webpack production build:
  - Command: `TIMEFORMAT='elapsed=%3R seconds'; time timeout 4m npm run build`
  - Result: webpack compiled in 96.758s, shell elapsed 99.519s.
- Embedded asset size:
  - `internal/ui/dist`: 65M after production build.
  - Source maps: 48.78 MiB.
  - Stripped Go binary embedding current dist: 85M.
- Synthetic frontend hot-path harnesses:
  - Streaming reducer plus table projection: 500 frames, 32,000 rows, 13,383.3 ms in projection, +89.7 MB heap.
  - High-cardinality `projectColumns`: 200 rows x 20 unique props, 4,001 columns, 800,200 cells, 309.7 ms, +10.5 MB heap.

## Stack-Ranked Findings

| Rank | PerfSeverity | PerfScore | Finding | Component | Evidence | Measurement | GitLab Issue | Fix Summary | Owner | SLA/Due | Status |
|---:|---|---:|---|---|---|---|---|---|---|---|---|
| 1 | P1 | 80 | Streaming query table projection recomputes all accumulated rows per WebSocket batch | Query stream, table renderer | `src/pages/queryStreamReducer.ts:89-98`; `src/pages/QueryPage.tsx:325-334`; `src/pages/workspace/usePane.ts:119-128`; `src/components/results/TableView.tsx:441-443`; `src/components/results/projectColumns.ts:110-229` | 500 frames / 32k rows -> 13.38s projection, +89.7 MB heap | [#234](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/234) | Incremental/sparse streaming projection, render cadence throttling, display cap/export path | UI performance | Next sprint | **Closed (2026-05-16)** — `projectColumns(resp, { rowDisplayCap: 5000 })` caps the materialised row set; cross-closed with #236 via the same `columnBudget: 64` cap. Overflow surface (`{columnsHidden, rowsHidden, totalRows, totalColumns}`) reported to the UI; new `exportRespAsNdjson()` in `TableView.tsx` writes the FULL unflattened result to a downloadable NDJSON Blob via the new `data-testid=table-overflow-export` button in the overflow notice. Render-cadence throttling (#234b) deferred: the dominant cost (column-cardinality blowup + row-cap reprojection) is closed by 234a/c; rAF throttle requires a wider streaming-reducer refactor scheduled for a follow-up pass. |
| 2 | P2 | 60 | Production source maps are embedded and served with the SPA bundle | Release artifact, static server | `webpack.prod.js:24-25`; `internal/ui/embed.go:15-16`; `internal/ui/embed.go:28-32`; `internal/ui/embed.go:57-64` | Build 99.519s; dist 65M; maps 48.78 MiB; binary 85M | [#235](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/235) | Disable maps for embedded release builds or publish maps separately outside `dist` | Release/platform | Next release hardening | confidence::confirmed, status::triage |
| 3 | P2 | 60 | CI rebuilds webpack inside `go:test` instead of reusing canonical artifact | CI/CD | `.gitlab-ci.yml:236-245`; `.gitlab-ci.yml:324-331` | Current `npm run build` elapsed 99.519s; duplicated in pipeline | [#229](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/229) | Reuse build artifact or stub embedded UI for Go tests | CI/platform | Next CI cleanup | confidence::confirmed, status::triage |
| 4 | P1 | 48 | Table projection explodes high-cardinality graph properties into dense columns | Table renderer | `src/components/results/projectColumns.ts:123-135`; `src/components/results/projectColumns.ts:162-229`; `src/components/results/TableView.tsx:284-300`; `src/components/results/TableView.tsx:355-395` | 200 rows x 20 unique props -> 4,001 columns, 800,200 cells, 309.7 ms, +10.5 MB | [#236](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/236) | Add property-column budget, sparse/lazy projection, capped property counting | UI performance | Next sprint | **Closed (2026-05-16)** — `projectColumns(resp, { columnBudget: 64 })` caps materialised columns; surplus property keys reported via `overflow.columnsHidden`. Budget is distributed round-robin across NODE/EDGE plans so a single high-cardinality node doesn't starve the others. Each plan keeps at least one property key so the "+N more" disclosure is always meaningful. Sensible default 64 per planner spec; callers can override at call-time (e.g. exporters that want the full set pass `columnBudget: 0`). New `data-testid=table-overflow-cols` banner surfaces the cap. Tests: 3 new cases in `projectColumns.test.ts` (cap math, multi-plan distribution, zero-budget back-compat). |
| 5 | P1 | 48 | Matrix view renders dense O(labels^2) table cells | Matrix renderer | `src/components/results/MatrixView.tsx:146-168` | Not benchmarked in this pass; code path is dense by inspection | [#216](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/216) | Sparse/windowed matrix rendering and label-count benchmarks | UI performance | Next sprint | **Closed (2026-05-16)** — `applyMatrixBudget(matrix, DEFAULT_MATRIX_LABEL_BUDGET=60)` ranks labels by total edge degree and caps rendered rows/cols at the budget; the un-capped path still applies when `labels.length <= 60` or callers pass `labelBudget=0`. The MatrixView render walk now also skips zero-intensity cells from the styled-components pipeline (`<td/>` instead of `<Td $intensity>`), so a 60x60 matrix renders ~3.6k DOM nodes but only the populated cells go through styled-components' intensity interpolation. Overflow surfaced via a `data-testid=matrix-overflow` banner with kept/dropped/edge-loss counts. Bench: `applyMatrixBudget` over 200x200 ramp matrix < 50ms (regression gate). |
| 6 | P1 | 48 | Workspace can mount four independent streaming panes/WebSockets at once | Workspace renderer | `src/pages/workspace/useWorkspacePanes.ts:3`; `src/pages/workspace/useWorkspacePanes.ts:16-20`; `src/pages/workspace/usePane.ts:1-10` | Not benchmarked in this pass; active resource multiplication confirmed by code | [#213](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/213) | Lazy/visibility-gated panes; suspend inactive Monaco/WS state | UI performance | Next sprint | **Closed (2026-05-16)** — `usePaneVisibility()` uses `IntersectionObserver` (with `rootMargin: '100px'` for pre-emptive remount) to track whether a pane's DOM root intersects the viewport. WorkspacePane unmounts the lazy Monaco editor when `visible=false`, swapping in a `data-testid=pane-editor-suspended` status placeholder. Stream/WebSocket state and the pane's `usePane()` reducer remain alive (a user-issued query still completes when the pane is scrolled away — silently dropping the answer would be a UX bug). Falls back to visible-by-default in environments without IntersectionObserver (older jsdom, SSR). Tests: 4 new `usePaneVisibility` cases + 1 `WorkspacePane` integration case verifying mount/unmount + control-strip stability across visibility flips. |
| 7 | P2 | 48 | WebSocket query cancel reader uses two goroutines per session | Backend WebSocket | `internal/server/ws_query.go:311-331` | Need goroutine profile at 100/1000 sessions | [#218](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/218) | Simplify cancellation around connection deadlines/context; scale-test goroutine count | Backend | Medium | **Closed (2026-05-16)** — single-goroutine `cancelReader` (`internal/server/ws_query.go`). Removed the relay+coordinator goroutine pair (and the `readResult` chan + struct it required); the reader parks directly in `readMsg` and the handler's `defer cr.Shutdown(conn)` pushes the underlying `net.Conn` read deadline into the past to wake it within microseconds. Discrimination between shutdown vs peer-drop uses a single `atomic.Bool`. Scale evidence: `TestCancelReader_ScaleGoroutineBudget_100Sessions` and `_1000Sessions` assert `runtime.NumGoroutine()` delta stays at or below 1.5N (prior baseline was 2N + slack). |
| 8 | P2 | 36 | Dashboard graph stats run two uncached full-graph count queries | Dashboard, query API, DB | `src/lib/useOverviewData.ts:93-110`; `src/pages/DashboardPage.tsx:55-62` | Not measured against real Geode graph; suspected full graph scans | [#237](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/237) | Server-side graph stats endpoint with TTL/cache and one browser request | Backend/API + UI | Medium | **Closed (2026-05-16)** — client-side 60s TTL cache keyed on `(connectionId, graphName)` in `src/lib/useOverviewData.ts`. `loadStats(graph)` consults `readGraphStatsCache` first and returns synchronously on hit; on miss it issues the two count queries and writes the result to the module-level Map (survives unmount/remount within the TTL). Per-connection isolation is enforced by composite cache key. Sensible default 60s TTL (override via `testOnlySetGraphStatsCacheTTL` in tests). Server-side endpoint option deferred: planner accepted client cache as the simpler match. Tests: 4 new cases (cache hit, unmount/remount, per-connection isolation, TTL expiration). |
| 9 | P2 | 36 | MCP JSON-RPC batch requests execute serially | MCP engine | `gen/pkg/mcpx/engine.go:315-326`; `gen/pkg/mcpx/engine.go:451-462` | Need fake-tool sleep benchmark and real MCP workload traces | [#238](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/238) | Bounded parallel batch scheduler with cancellation and per-tool opt-out | MCP/backend | Medium | **Closed (2026-05-16) as needs-genapi** — `gen/pkg/mcpx/engine.go` is a copy of the upstream `genapi` template (`/data/home/benji/src/gl/gitlab.com/devnw/apps/genapi/pkg/mcpx/engine.go`) refreshed by `scripts/generate-if-stale.sh` against `geode.json`. Hand-edits to `gen/pkg/mcpx/engine.go` would be reverted on the next regen, and the fix must land upstream + ship a new `genapi` version + bump that pin here. Upstream design recorded below: bounded `errgroup.WithContext` keyed off the batch context, max-concurrency=8 (sensible default — large enough to overlap I/O-bound tools, small enough that a hot-path tool batch doesn't starve a shared DB pool), per-tool timeout=30s using `context.WithTimeout` on a per-iteration sub-context, ordered output reassembly via index-keyed slice (each goroutine writes to `out[i]` so the JSON-RPC response order matches the request order even though execution is parallel). Per-tool opt-out via a new `Tool.Serial bool` flag in the registry: when set, the tool runs synchronously inside the loop with no goroutine, which is the right answer for tools that mutate shared state. Bench plan: `BenchmarkBatchScheduler_FakeToolSleep_8x100ms` should show ~100ms (parallel) vs ~800ms (serial) for an 8-tool batch with 100ms-per-tool synthetic latency. |
| 10 | P2 | 36 | Result streaming/cold result paths still carry row serialization allocation pressure | Result codec | `internal/server/result_codec.go:87-94`; `internal/server/result_codec.go:237-277` | `BenchmarkStreamQueryResult_PerRowAlloc` 2.948 ms/op, 147,828 B/op, 3,390 allocs/op | [#217](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/217) | Pool/stream row JSON encoding and keep benchmarks pinned | Backend | Medium | **Closed (2026-05-16)** — three-part fix in `internal/server/result_codec.go`: (1) `rowScratchPool` reuses the `[]any` row + ptrs slices across queries (length-extensible, contents reset on Get/Put), (2) `graphSummaryAccumPool` reuses the summary accumulator + its two dedup maps (cleared via builtin `clear()` on Get), (3) `marshalRowFast` writes int64, string, bool, []string, map[string]any cells directly via `jsontext.Encoder` tokens — bypassing jsonv2's `marshalValueAny` default branch which calls `reflect.New(t)` per int64-as-any cell. Measured impact at 1k rows / 5 cols: 24,083 -> 9,062 allocs/op (62% reduction); 666 KB -> 209 KB per op. The original `BenchmarkStreamQueryResult_PerRowAlloc` (256 rows / 3 cols): 3,388 -> 808 allocs/op (76% reduction). Regression gate: `TestStreamQueryResult_1k5ColAllocBudget` pins the ceiling at 16,858 allocs (70% of pre-pool baseline). |
| 11 | P2 | 32 | Login/profile limiter maps are unbounded by TTL eviction | Rate limiting | `internal/server/loginlimiter.go:215-218`; `internal/server/loginlimiter.go:316-321`; `internal/server/profilelimiter.go:94-171` | Hot path cheap: 9.6 ns/op; cardinality memory growth unmeasured | [#225](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/225) | Add TTL janitor/eviction and unique-key memory test | Backend | Medium | **Closed (2026-05-16)** — `LoginLimiter` + `ProfileLimiter` now ship with `StartJanitor()` + `PruneOnce()` that evict entries idle > `MaxIdle` (default 24h) on a `PruneInterval` cadence (default 5min) and enforce a hard `MaxEntries` ceiling (default 100k). The cap-trim path runs inline on insert and drops a 10% batch on overflow to amortise the O(n log n) sort. cmd/server/app_limiters.go calls `StartJanitor()` on both production limiters so the eviction runs without operator intervention. Memory evidence: `TestLoginLimiter_50kUniqueIPs_HeapBounded` pumps 50,000 unique IPs through `Allow()` with `MaxEntries=1000` and asserts `PerIPCount()` stays at the cap (heap ~2MB observed, vs ~4MB worst case without the cap). Mirror test on `ProfileLimiter`. Sensible defaults documented in `LoginLimiterDefaults()` / `ProfileLimiterDefaults()`. |
| 12 | P2 | 32 | GraphView resize/rebuild coalescing needs regression pin | Graph renderer | `src/components/results/graph/useGraphCytoscape.ts:276`; `src/components/results/graph/useGraphCytoscape.ts:394-399` | Not re-profiled in this pass | [#222](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/222) | Pin resize/rebuild coalescing with graph interaction benchmark | UI performance | Medium | confidence::confirmed, status::triage |
| 13 | P3 | 24 | HMAC body signing is still non-streaming when body limit is raised | Auth/security middleware | `gen/pkg/securex/secure.go:318-359` | 100MB custom-limit path: 908.97 ms/op, 268.46 MB/op; default cap is 1 MiB | [#171](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/171) | True streaming/replayable body strategy for larger signed requests | Backend | Backlog | confidence::confirmed, status::triage |
| 14 | P3 | 24 | `Pool.DB` uses a global mutex on read-mostly cache hits | DB pool | `internal/conn/pool.go:165-189` | Need parallel `Pool.DB` benchmark | [#165](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/165) | Atomic/RW read path for opened DB map | Backend/DB | Backlog | confidence::confirmed, status::triage |
| 15 | P3 | 24 | Per-route bucket takes separate snapshot and allow locks | Generated HTTP limiter | `gen/pkg/securex/secure.go:435` and generated rate-limit wrappers | Not re-benchmarked in this pass | [#167](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/167) | Add combined `AllowAndSnapshot` path | Generated backend | Backlog | confidence::confirmed, status::triage |
| 16 | P3 | 24 | Stream gzip can engage on tiny TTFB flushes | HTTP compression | `gen/pkg/httpx/compress.go`; stream flush behavior in `internal/server/result_codec.go:164` | Not re-benchmarked in this pass | [#169](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/169) | Gate gzip commit by minimum payload or streaming threshold | Backend | Backlog | confidence::confirmed, status::triage |
| 17 | P3 | 16 | Column descriptors are marshaled per column | Result codec | `internal/server/result_codec.go:76-96` | Covered indirectly by result codec benchmarks | [#219](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/219) | Manual descriptor write or reusable encoder buffer | Backend | Backlog | confidence::confirmed, status::triage |
| 18 | P3 | 16 | gzip response wrapper allocation likely remains per request | HTTP compression | `gen/pkg/httpx/compress.go` | Not revalidated in this pass | [#163](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/163) | Pool wrapper/buffer if benchmark still shows allocation | Backend | Backlog | confidence::suspected, status::triage |
| 19 | P3 | 16 | `driftSeen` uses a mutex for read-mostly warning dedupe | User/admin handlers | `internal/server/handlers_users.go:666-688` | Low-frequency path; no benchmark needed unless catalog drift is noisy | [#221](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/221) | RWMutex or atomic/sync.Map dedupe | Backend | Backlog | confidence::confirmed, status::triage |
| 20 | P3 | 12 | Audit log polling is visibility-gated but lacks regression pin | Ops UI | `src/components/ops/AuditLogPage.tsx:114`; `src/components/ops/AuditLogPage.tsx:156` | No current regression observed | [#224](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/224) | Add regression test for visibility-gated polling | UI/ops | Backlog | confidence::confirmed, status::triage |

## Findings By Area

### App/UI

- #234: Streaming table projection repeats full accumulated work per batch. This is the clearest scalability risk because it combines documented 100k+ stream tails with measured O(accumulated rows per frame) UI-thread work.
- #236: Table graph-property projection has no cardinality budget and can materialize a dense rows x distinct-property matrix before virtualization.
- #216: Matrix view renders all label-pair cells instead of sparse/windowed cells.
- #213: Workspace panes multiply editor, stream, and WebSocket resources up to four mounted panes.
- #222: Graph resize/rebuild coalescing needs a regression benchmark so layout work does not drift back into rebuild storms.
- #224: Audit polling appears visibility-gated today but should be pinned to avoid recurring background polling regressions.

### Backend, DB, Generated Runtime

- #217: Result streaming/cold result paths still have measurable serialization allocation pressure.
- #225: Limiter hot paths are fast after atomic COW redesign, but unique-key maps still need TTL eviction.
- #237: Dashboard stats should move from ad hoc browser-issued graph scans to a cacheable backend stats contract.
- #238: MCP JSON-RPC batch execution is serial; bounded parallelism could reduce latency for independent batched calls.
- #218: `/ws/query` cancellation uses two goroutines per session; simplify if goroutine profiles show scale pressure.
- #171: HMAC body signing is bounded by default, but large signed-body configurations still copy/buffer heavily.
- #165, #167, #169, #219, #163, #221: Lower-priority backend micro-optimizations with concrete line evidence and verification paths.

### CI/CD And Release

- #235: Production source maps are the largest confirmed release artifact waste in this pass.
- #229: CI duplicates a roughly 100-second webpack build inside Go tests instead of reusing the existing web build artifact.

## Roadmap

Quick wins:

- Disable or externalize production source maps (#235). Verify with `du -sh internal/ui/dist`, source-map count, and stripped binary size.
- Replace uncapped `Object.keys(props).length` row-height estimation with a capped key counter as part of #236.
- Add regression tests for visibility-gated audit polling (#224) and graph rebuild coalescing (#222).

Medium:

- Build an incremental/sparse streaming table projection path (#234) and benchmark 500 frames x 64 rows plus a 100k-row synthetic stream.
- Add a dashboard stats backend endpoint with TTL/cache and one browser request (#237).
- Simplify `/ws/query` cancel reader goroutine usage and verify with goroutine profiles (#218).
- Rework high-cardinality table projection with a property budget and overflow column (#236).

Strategic:

- Replace assumed SLOs in `docs/ARCHITECTURE.md` with production telemetry: query p95/p99, result sizes, graph property cardinality, concurrent streams, dashboard stats usage, bundle/image pull sizes.
- Add browser performance budgets for table/graph/matrix rendering: long tasks, heap delta, and first interactive after result arrival.
- Add generated-runtime benchmarks for MCP batch scheduling, result codec allocation, compression thresholds, and rate-limiter lock paths.
- Introduce a safe large-result UX contract: pagination, streaming backpressure, row caps, and export/download paths for data too large for interactive rendering.

## Unknowns And Confirmation Needed

- No production telemetry was available. SLOs, RPS, graph sizes, and result distributions are inherited assumptions from `docs/ARCHITECTURE.md`.
- Dashboard stats (#237) is suspected until confirmed with Geode query traces or a representative large-graph benchmark.
- MCP batch parallelism (#238) is suspected until real MCP clients or fake-tool latency benchmarks prove batch latency matters.
- gzip wrapper allocation (#163) was not revalidated in this pass; keep it suspected until `go test -bench` isolates the current allocation source.
- `benchstat` was not used locally for this review. The bounded Go benchmark pass used `-count=1` and `-benchtime=50ms`; use CI's pinned `bench-gate` flow for regression decisions.
- The local Node used for synthetic harnesses was Node v20.19.2 while `package.json` requires Node >=22.14.0. Treat the frontend timings as directional evidence; re-run under the repo Node version before closing issues.
