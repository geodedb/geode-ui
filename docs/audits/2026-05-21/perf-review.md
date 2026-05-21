# Performance Review — geode-ui (2026-05-21)

**Root:** `/data/home/benji/src/gl/gitlab.com/devnw/codepros/geode/geode-ui`
**Branch:** `main` (clean tree, HEAD `1199648`)
**Mode:** Read-only deep review. No source/issue changes. No benchmarks executed.
**Inputs:** `docs/audits/2026-05-21/perf-context.md`, `docs/audits/2026-05-21/perf-scan.md`, `bench-baseline.txt` (421 lines, 354 `Benchmark*` rows).

This pass deep-validates the scanner's 13 findings against the source, walks the streaming / graph-rebuild / metrics-projection / schema-cache hot paths, and surfaces three new issues the grep-pass missed (Sparkline/recharts re-render churn on the 5s tick, no `http.Transport` tuning anywhere in the tree, and `pushSynthesisedRows` doing two row sweeps).

---

## Severity Distribution

| Severity | Count | Notes |
|---|---:|---|
| **P0** | 0 | No production-blocking regression against current baselines. |
| **P1** | 4 | Per-tab N× server load (shared-clock); per-call `http.Client{}` for HIBP + metrics with default transport pool; bench-gate `allow_failure: true`; `lspFrameReader` byte-by-byte read. |
| **P2** | 7 | `layoutCache.get` full PosMap clone (#294); 11× `FindFamily` linear scan per /metrics; schema-cache TTL-only (no LRU bound); `streamRowsOverWS` scan→encode→write sequential (#306); Sparkline/MetricsCards lack memoization (new); `useGraphElements` baseEls identity churn (#275 guardrail only); `pushSynthesisedRows` two-pass row sweep (new). |
| **P3** | 6 | `formatCell` JSON.stringify per cell; `projectSnapshot` per-call `make([]MetricsHistogramBucket, …)`; `scanQueryResult` `make([]jsontext.Value, 0)` no cap; HMAC body buffering (#171, blocked); JSON-only WS protocol (#302); CI bundle-budget tripwire absent. |

**Total findings: 17** (13 from scanner + 3 new + bench-coverage gap split out).

---

## Top 10 Findings

| # | Severity | Finding | File:Line | Impact (estimated) | Recommended Fix |
|---:|---|---|---|---|---|
| 1 | **P1** | Three independent `setInterval` pollers per SPA tab; no shared clock; visibility-gated individually but not coalesced. | `src/lib/useMetricsPolling.ts:128`; `src/components/dashboard/AuditEventMixCard.tsx:124`; `src/components/ops/AuditLogPage.tsx:196` | At N open tabs: 3N pollers × M cards. The 5 s metrics tick and the 30 s audit-donut tick alias every 30 s, doubling p95 spike on `/api/v1/metrics` and `/api/v1/audit`. At 50 concurrent dashboards (peak), ~30 req/s base load attributable to polling alone. | Introduce a `usePollingClock` hub that owns one `setInterval(1000)` and emits coalesced `tick:5s` / `tick:30s` events; subscribers register callbacks. Drops the timer count from `O(tabs × cards)` to one per tab. |
| 2 | **P1** | Per-call `&http.Client{Timeout: …}` in two hot paths; never wires a tuned `http.Transport` → default `MaxIdleConns=100`, `MaxIdleConnsPerHost=2`. | `internal/server/handlers_metrics.go:214-219` (5s poll); `internal/server/password_policy.go:169-172` (HIBP, per login/registration/password-change). | `MaxIdleConnsPerHost=2` is the Go default. At 50 dashboards × 5 s = 600 reqs/min to ONE upstream host (`GEODE_METRICS_URL`); only 2 idle conns are reused so the rest pay TLS+TCP setup. HIBP path is even worse: TLS handshake per password validation. Wall-clock cost of TLS handshake to `api.pwnedpasswords.com` ≈ 50-200 ms. | Build one package-level `*http.Transport` via a `sync.Once` (or DI through `Config`) with `MaxIdleConnsPerHost: 32`, `MaxIdleConns: 256`, `IdleConnTimeout: 90*time.Second`, `ForceAttemptHTTP2: true`. Reuse via a singleton client. |
| 3 | **P1** | `bench-gate` job is `allow_failure: true`; ParseProm/projectSnapshot/HandleMetrics/lspFrameReader/hibpHasSeen have ZERO benchmark coverage. | `.gitlab-ci.yml:472-473`; bench-source grep finds no `BenchmarkParseProm`, `BenchmarkProjectSnapshot`, `BenchmarkHandleMetrics`, `BenchmarkLspFrameReader*`, `BenchmarkHibp*`. | All five are 5 s-poll or login-path hot routes. A 5× regression in `ParseProm` would be invisible to MR review and the gate would still pass advisorily. | (a) Add five benchmarks (table-driven; representative ~30 KiB upstream Prom blob; one HIBP fixture). (b) Regenerate `bench-baseline.txt`. (c) Flip `allow_failure: false` for bench-gate (per perf-context #1199648 commentary). |
| 4 | **P1** | `lspFrameReader.ReadFrame` reads LSP header **one byte at a time** with a fresh `make([]byte, 1)` per loop and `append(header, buf[0])` growing the slice byte-by-byte. | `internal/server/ws_lsp.go:351-374` | Per-frame: ~40-80 syscalls (header length) + `append` grow churn. LSP completion traffic is bursty (per-keystroke); 1 keystroke ≈ 1-3 frames. At an active editor session, hundreds of frames/sec × 60 syscalls = wall-clock overhead well above what a buffered reader would pay. Plus `strings.ToLower(headerStr)` is allocated per frame for case-insensitive matching. | Wrap upstream `tcp` in `bufio.NewReaderSize(tcp, 4096)`; use `r.ReadString('\n')` to consume the header lines, then a separate `io.ReadFull` for the body. Parse `Content-Length` directly with `strconv.Atoi` after `bytes.TrimSpace` — no `fmt.Sscanf` reflect path. |
| 5 | **P2** | `layoutCache.get` clones the full `PosMap` on every hit (line 61: `return { hit: 'full', positions: new Map(positions) }`). | `src/components/results/graph/layoutCache.ts:61` | At n=10k nodes a `new Map(positions)` is O(n) Map-allocate + O(n) entry copy on a hot read path. The store-side `bump(sig, new Map(positions))` ALSO clones — every layout cycle does TWO full clones. Tracked as OPEN #294. | The store-side clone is sufficient because the stored Map is then never mutated. Return the stored reference behind a `ReadonlyMap<NodeId, Position>` type and document the no-mutate contract. Or freeze in dev only. Halves per-hit allocation. |
| 6 | **P2** | `projectSnapshot` runs 11 linear `FindFamily` scans (O(F·11) where F is upstream metric-family count). | `internal/server/handlers_metrics.go:228-281`; `internal/server/promparse.go:355-362` | F is small (~12 families today) so cost is currently ~132 string comparisons per /metrics request. Risk: if upstream adds families F grows; cost is amortised at 5s poll × N tabs. **Not benched** — drift invisible. | Build a `map[string]*MetricFamily` once in `ParseProm` (the `families` map already exists in-function; expose it on `MetricFamily` return). One O(1) lookup per family. Saves ~100 strcmps per request; eliminates the linear-scan asymptotic risk. |
| 7 | **P2** | `streamRowsOverWS` scans → encodes → writes on a single goroutine; slow WS client back-pressures the SQL cursor. | `internal/server/ws_query.go:391-455` | A consumer reading at 1 frame/200 ms holds the upstream cursor open and idle for the same duration (driver does not buffer beyond its own internal). For a 100k-row stream, a stalled client extends total wall-clock proportionally. Already filed as OPEN #306. | Producer goroutine emits scanned `[]any` rows into a bounded `chan` (capacity = `wsRowBatchSize * 4`); consumer goroutine drains, encodes, writes. Bounded channel doubles as backpressure mechanism. Test contract: alloc-count parity with current pool. |
| 8 | **P2** | `Sparkline` rebuilds `buildData(values)` on every render and recreates `formatForTooltip(formatValue)` per render; no `React.memo`. `MetricsCards` (and most `dashboard/*.tsx`) lack `useMemo`/`React.memo`. | `src/components/dashboard/Sparkline.tsx:57-58,98,113`; `src/components/dashboard/MetricsCards.tsx` (0 memo hooks) | The 5 s metrics poll triggers a setState in `useMetricsPolling`, re-rendering every dashboard child. Each child renders ≥1 `Sparkline`; each `Sparkline` builds a new `data` array of length up to 60 and re-instantiates the Recharts `LineChart` subtree. At 8 cards × 60 samples = ~500 re-builds every 5 s on the dashboard. **New finding** — scanner missed this. | (a) Wrap `Sparkline` in `React.memo` keyed on a stable `values` array identity (the poller already pushes; ensure the array reference changes only when content does — currently it does because the trim creates a new array). (b) `useMemo` the `data = buildData(values)` and the tooltip formatter inside `Sparkline`. (c) `React.memo` the dashboard cards (`MetricsCards`, `ConnectionCard`, etc.) on their snapshot input. |
| 9 | **P2** | Schema cache eviction is TTL-only; no per-entry LRU/maxSize bound. | `internal/server/schema_cache.go:34,76-86,121-125` | A long-lived browser tab cycling many graph names retains every graph's labels + edge-types entry for 120 s — `2 entries/graph × G graphs`. At G=100 graphs with mixed-traffic dashboards, ~200 entries × O(label-count) strings persist; not catastrophic but the design has no upper bound. | Add a hard cap (`maxEntries = 256` is plenty for v1) with LRU eviction. Map preserves insertion order in Go; re-insert on hit. Currently filed only in `perf-context.md §7` as an "Unknown" — promote to a GitLab issue. |
| 10 | **P2** | `pushSynthesisedRows` walks `rows` TWICE (lines 41-77 then 99-134) to first build synthetic nodes, then emit synthetic edges. | `src/lib/graphResult/pushSynthesisedRows.ts:41-134` | Pure JS overhead at row build time. For a 5,000-row synthetic-pattern result it walks 10,000 rows + rebuilds `varProps` per row twice. Cost is amortised once-per-rebuild (not per WS frame) but still doubles the worker payload preparation time on the main thread. **New finding** — scanner missed. | Single sweep: capture the `varProps` per row in an array of `Map<string,Record<string,unknown>>` during pass 1, reuse it in pass 2. Reduces re-allocations of intermediate `varProps` maps from 2N to N. |

---

## Detailed Findings by Category

### Algorithms & Data Structures

| Finding | File:Line | Root Cause | Impact | How to Verify | Confidence |
|---|---|---|---|---|---|
| 11× `FindFamily` linear scan in `projectSnapshot` (O(F·11)) | `internal/server/handlers_metrics.go:228-281` | Linear scan of `[]MetricFamily` repeated for each well-known family name. | Cost amortised at 5 s × N dashboards. Bench coverage: NONE. | Add `BenchmarkProjectSnapshot` with a 32-family fixture; compare ns/op against the proposed map-fronted variant. | confirmed |
| `pushSynthesisedRows` double row sweep | `src/lib/graphResult/pushSynthesisedRows.ts:41-134` | Two passes: build synthNodes, then per-row emit synthetic edges. Each pass re-builds `varProps` map per row. | Doubles main-thread time for synthetic-pattern graph rebuilds (rare but bursty). | Jest perf bench on a 1k synthetic-row input; assert single-pass is within 30 % wall-clock of the two-pass baseline. | suspected (new) |
| `lspFrameReader` byte-by-byte read | `internal/server/ws_lsp.go:351-374` | `f.r.Read(buf=[1]byte)` then `append(header, buf[0])`. Plus `strings.ToLower(headerStr)` allocs string per frame. | Per-frame: 40-80 syscalls and `O(header-length)` slice grow. LSP completion-traffic bursts hundreds of frames/sec. | Add `BenchmarkLspFrameReader` against a 64-frame, 8 KiB-each fixture. | suspected |
| `formatCell` JSON.stringify per cell (arrays + generic objects) | `src/lib/cellFormat.ts:99,105` | Re-runs `JSON.stringify` per render per cell; `cellLines` also recomputes the length via the same path. | 25k row retention × 64 col budget × two-call height-estimate path. | Microbench: `formatCell(row[][i])` 100k cells; measure GC pause. | suspected |
| `scanQueryResult` row slice without capacity hint | `internal/server/result_codec.go:574` | `make([]jsontext.Value, 0)` — N is known from `rows.Next()` loop ahead. | Cold path (MCP + Tx Run only). Already triaged dropped 2026-05-17. | Pre-size with rough `len(cols)*estimateRowCount`; visible in PERF #234 bench. | confirmed (re-noted) |

### Memory & GC

| Finding | File:Line | Root Cause | Impact | How to Verify | Confidence |
|---|---|---|---|---|---|
| `layoutCache.get` full PosMap clone per hit | `src/components/results/graph/layoutCache.ts:61` | Defensive clone on the read side; the write side already clones. | At n=10k nodes the per-hit clone is ~10k Map entries. | Jest microbench against 10k-node sig at hit-rate 1.0; allocate-tracking via `performance.memory`. | confirmed (#294 OPEN) |
| Schema cache TTL-only (no LRU bound) | `internal/server/schema_cache.go:34,76-86` | `map[schemaCacheKey]schemaCacheEntry` grows monotonically over a 120 s window. | Bounded by graph-name cardinality × 2; large multi-graph deployments leak briefly. | Add `BenchmarkSchemaCache_HighCardinality`; record live entries count over a 5 min run. | confirmed |
| `projectSnapshot` per-call `make([]MetricsHistogramBucket, 0, len(...))` | `internal/server/handlers_metrics.go:237` | Heap alloc per 5 s /metrics request. | Modest; bucket count is ~12. Visible only at very high concurrent-dashboard count. | `BenchmarkProjectSnapshot` (proposed) — assert allocs/op. | suspected |
| `Sparkline` per-render `buildData(values)` + `formatForTooltip(...)` rebuild | `src/components/dashboard/Sparkline.tsx:57-58,98,113` | No `useMemo`; Recharts treats `data` reference change as a full re-render. | Dashboard re-renders every 5 s; cards x sparklines ≈ 8 components × 60-sample arrays. | React DevTools Profiler under metrics poll; count Sparkline commits per minute. | confirmed (new) |
| LSP `strings.ToLower(headerStr)` per frame | `internal/server/ws_lsp.go:380` | Case-insensitive Content-Length match allocates a fresh string each frame. | Same as #4 — bursty LSP. | bench in tandem with #4. | suspected |
| `streamRowsOverWS` `make([]any, len(cols))` per row | `internal/server/ws_query.go:396` | Row slab is intentionally allocated per row (batcher holds reference until flush); already a benchmarked alloc-cost (11200 allocs/op pinned post-#251). | Within established baseline. | `BenchmarkStreamRowsOverWS_AllocsPerRow` — pinned. | confirmed (within baseline) |

### I/O & Network

| Finding | File:Line | Root Cause | Impact | How to Verify | Confidence |
|---|---|---|---|---|---|
| `metricsHTTPClient` per-call `&http.Client{Timeout:2s}` (no transport pool tuning) | `internal/server/handlers_metrics.go:214-219` | Constructs a fresh `*http.Client` per request when `MetricsHTTPClient` unset; default transport's `MaxIdleConnsPerHost=2`. | 50 dashboards × 5s = 600/min to a single upstream host; only 2 conns reused. | Wireshark / `netstat -an | grep TIME_WAIT | wc -l` while polling; expect TIME_WAIT growth pre-fix. | confirmed |
| `hibpHasSeen` per-call `&http.Client{Timeout:5s}` to TLS endpoint | `internal/server/password_policy.go:169-172` | Same anti-pattern; HIBP is HTTPS. | TLS handshake added to every login / password-change. ≈50-200 ms wall-clock. | `BenchmarkHibpHasSeen` (proposed) — pre/post transport singleton. | confirmed |
| `streamRowsOverWS` no producer/consumer split | `internal/server/ws_query.go:391-455` | Scan → batcher.add → batcher.flush on one goroutine. | Slow WS client back-pressures driver cursor. | Drive a 100k-row stream with a 200 ms-throttled WS reader; measure `db.Stats().WaitCount`. | confirmed (#306) |
| Frontend pollers don't share a clock | (see Finding #1) | Three independent `setInterval`s per tab. | Server load scales `O(tabs × pollers)`. | Counter middleware on `/api/v1/metrics` over a 5-min open-tab session. | confirmed |
| Streaming `/api/v1/query` flush every 64 rows + Server-Timing trailer | `internal/server/result_codec.go:390,499` | Heuristic chosen "small enough latency, large enough not to syscall-dominate". | At 100k rows: 1562 flushes. No bench established for chunk-size sensitivity. | A/B `streamFlushEvery=64` vs 128 vs 256 via `BenchmarkStreamQueryResult_1k5Col`. | suspected (size choice is plausible but unvalidated) |

### Concurrency

| Finding | File:Line | Root Cause | Impact | How to Verify | Confidence |
|---|---|---|---|---|---|
| LSP `ReadTimeout=0` on WS upgrade | `internal/server/ws_lsp.go:143` | Relies on `IdleTimeout` upstream + `WriteTimeout=30s` for stuck-peer reaping. | A stuck reader on an open LSP session is bounded by ping-pong (30s) + write-timeout, not read-timeout. Acceptable but undocumented in the file header. | Validate by killing a TCP peer mid-session and timing cleanup. | suspected |
| Schema cache singleflight + RWMutex (steady state correct) | `internal/server/schema_cache.go:99-119` | Read-heavy path uses RLock; expired-entry deletion upgrades to writer lock with re-check. | No issue — design is correct (PERF #223). | `BenchmarkSchemaCache_Get_Parallel` already pins 0 allocs/op. | confirmed (no issue) |
| `metricsUpstreamTimeout = 2 * time.Second` request budget | `internal/server/handlers_metrics.go:53,166` | `context.WithTimeout` on the outbound request, NOT on `client.Timeout`. Per-call client construct also sets `Timeout: 2s` which is duplicative; the context timeout would suffice. | Cosmetic; no perf issue but a code-smell. | n/a | confirmed |

### Pipelining & Streaming

| Finding | File:Line | Root Cause | Impact | How to Verify | Confidence |
|---|---|---|---|---|---|
| WS query batcher sequential scan→encode→write | `internal/server/ws_query.go:391-455` | (see #7 in Top 10) | (see #7) | (see #7) | confirmed (#306) |
| `queryStreamWorker` already pipelined (parse off main thread) | `src/lib/queryStreamWorker.ts:33-47`; `src/lib/queryStream.ts:177-199` | Worker JSON.parse off main thread (PERF #297). Single-threaded worker; FIFO; postMessage seq counter. | No issue — design correct. | n/a | confirmed (working as designed) |
| Cytoscape rebuild fully replaces core on every `sig` change (250 ms debounce) | `src/components/results/graph/useGraphCytoscape.ts:168-347` | `cy.destroy(); cytoscape({…})`. Streaming gate (line 239) suppresses layout pass while streaming; cache applies positions. | Full teardown on every `sig` change is expensive at 5k+ nodes. The streaming gate mitigates the layout cost; the rebuild cost itself is unmitigated. | Cytoscape A/B bench (`make perf-smoke`) at n=10k; compare rebuild p95 against an incremental-update prototype. | suspected (incremental cy.add()/cy.remove() would likely win) |
| HTTP streaming flush size unvalidated | `internal/server/result_codec.go:390` | `streamFlushEvery = 64` (constant); no bench. | Not necessarily wrong; just unvalidated. | A/B in `result_codec_bench_test.go`. | suspected |

### Infrastructure & CI

| Finding | File:Line | Root Cause | Impact | How to Verify | Confidence |
|---|---|---|---|---|---|
| `bench-gate` `allow_failure: true` | `.gitlab-ci.yml:472-473` | Shared CI runners deemed noisy. | Regressions in pinned baseline cannot block an MR. | Decision: tighten `benchstat` threshold AND flip to `allow_failure: false`. | confirmed |
| No `http.Transport` pool tuning anywhere in tree | grep for `MaxIdleConns`/`IdleConnTimeout`/`http.Transport` in `internal/server/*.go`,`cmd/server/*.go` returns ONLY profile-CRUD config (SQL pool config, not HTTP). | The two `&http.Client{Timeout: …}` callers and any future HTTP-out code default to `MaxIdleConnsPerHost=2`. | (see Finding #2) | grep already confirmed; metrics from production. | confirmed |
| No CI bundle-budget tripwire | `webpack.prod.js` `performance.hints: 'error'` is local-only; CI does not run `npm run build` with the budget check as a gate (or grows are not surfaced in MR comments). | Async chunks `2749.*.js` ~6.4 MiB, `4111.*.js` ~3.7 MiB unmonitored. | Track over time. | Add a CI job that runs `npm run build` and `node scripts/bundle-budget-check.js` (if missing, add). | confirmed (perf-context #285) |
| Missing benchmarks for 5s-poll path + login path | absence in `internal/server/*_test.go` | No `BenchmarkParseProm`, `BenchmarkProjectSnapshot`, `BenchmarkHandleMetrics`, `BenchmarkLspFrameReader*`, `BenchmarkHibp*`. | Regressions invisible to `bench-gate`. | Add benches; regenerate baseline. | confirmed |
| No `Server-Timing` aggregator / p95 alert | `internal/server/result_codec.go:430-446` emits header per request. | No collector. | Cannot detect regressions on `/api/v1/query` post-deploy. | Add OTel exporter or simple Prometheus histogram. | confirmed (perf-context Unknowns) |

---

## Scanner Findings: Confirmed / Upgraded / Downgraded

| Scanner finding | This-pass disposition | Rationale |
|---|---|---|
| F-FE-1 — three independent SPA pollers | **Upgraded P2 → P1** | Scaling factor is `O(tabs × pollers)`; with 50 dashboards (assumed peak) the contribution to /metrics RPS is comparable to a single misconfigured client. Treat as P1. |
| F-FE-2 — `layoutCache.get` PosMap clone (#294) | **Confirmed P2** | Read evidence at `layoutCache.ts:61`. The store-side also clones, so the per-hit clone is pure overhead. |
| `lspFrameReader.ReadFrame` byte-by-byte | **Upgraded P2 → P1** | Combined with the missing bench coverage and the bursty LSP completion traffic, this is invisible to regression gating AND likely the largest per-frame syscall cost in the LSP bridge. Bench + bufio fix together. |
| HIBP `&http.Client{}` per call | **Confirmed P1** | Combined with the metrics path into "no `http.Transport` tuning in tree" — same fix. |
| `metricsHTTPClient` per-call client construct | **Confirmed P1** | (same as above) |
| `bench-gate allow_failure: true` + missing benches | **Upgraded P2 → P1** | Without bench coverage on the metrics-projection path, even Finding #2's fix lands without a regression net. Lifting `allow_failure` is structural. |
| `streamRowsOverWS` sequential (#306) | **Confirmed P2** | Design is filed, just not yet implemented. |
| `ParseProm` 11× `FindFamily` | **Confirmed P2** | F is small today; risk is asymptotic and bench-invisible. |
| Schema-cache TTL-only | **Confirmed P2** | Promote from perf-context "Unknown" to a GitLab issue. |
| `projectSnapshot` per-call slice make | **Confirmed P3** | Modest. |
| `useGraphElements.baseEls` cascade | **Confirmed P2 (guardrail only)** | Per #275 the cascade is pinned by a regression test only; no defense-in-depth memo key. |
| `formatCell` JSON.stringify | **Confirmed P3** | Outside #234 scope; cosmetic on the streaming hot path. |
| `scanQueryResult` no cap on row slice | **Confirmed P3 (re-noted)** | Already triaged D1-dropped 2026-05-17; keep on watchlist. |

### New findings (not in scanner)

1. **Sparkline + dashboard cards lack memoization** (P2). Verified via grep: zero `React.memo`/`useMemo`/`useCallback` in `Sparkline.tsx` or `MetricsCards.tsx`. Re-renders every 5 s × cards × 60-sample arrays.
2. **No `http.Transport` tuning anywhere in tree** (rolled into Finding #2). Confirmed via grep across `internal/server/*.go` + `cmd/server/*.go` — `MaxIdleConns` only appears in profile-CRUD SQL pool config, not for outbound HTTP.
3. **`pushSynthesisedRows` two-pass row sweep** (P2). Rare-but-bursty cost on the main thread; halve by single-pass.

---

## Validation Plan (per finding)

For each Top-10 finding, the bench/profile command that would close the loop:

| Top-10 # | Command | Expected delta after fix |
|---:|---|---|
| 1 | Spin 10 concurrent SPA tabs against a dev server with `pprof` enabled; capture `/metrics` request count for 5 min. | Drop from `10 × 3 = 30 pollers` to `10 × 1 = 10 pollers` on the relevant cadences. |
| 2 | Add `BenchmarkHandleMetrics_Sustained` with a 1000-iter pool-warming workload. Compare TLS-handshake count via `httptrace.ClientTrace.TLSHandshakeStart`. | 0 handshakes after warm-up; pre-fix ≈ 1 handshake/req. |
| 3 | Add the missing five benchmarks; flip `allow_failure: false`. | bench-gate becomes a real gate. |
| 4 | `BenchmarkLspFrameReader_HeaderOnly` against a 64-byte header + 8 KiB body fixture, 100k iters. | Pre-fix ns/op dominated by per-byte read; post-fix ≥ 50 % reduction. |
| 5 | Jest microbench: `layoutCache.get` against a 10k-entry PosMap, 1000 hits. Track allocs via `--expose-gc` + manual `gc()`. | Halve per-hit allocation count. |
| 6 | `BenchmarkProjectSnapshot` against a 32-family Prom blob; compare linear-scan vs map-lookup. | -50 % ns/op on the projection step (small absolute, large factor). |
| 7 | A WS load test with a deliberately-throttled reader; measure end-to-end stream time. | Producer/consumer pipeline decouples cursor close from client drain. |
| 8 | React DevTools Profiler over a 5-min metrics poll; count `Sparkline.render` commits. | Post-memo: 1 commit per 5 s; pre-memo: ~8 commits per 5 s. |
| 9 | Unit test asserting `cache.size` stays ≤ `maxEntries` under a high-cardinality churn fixture. | Bounded growth. |
| 10 | Jest microbench on a 5k synthetic-row input; assert single-pass within 60 % of current two-pass wall-clock. | -40 % wall-clock for the synthesis step. |

---

## Blockers

**None.** No P0; the four P1 findings are all unblocked code changes (or a CI-gate flip) that do not require upstream genapi/securex work. The HMAC body-buffer P3 (#171) remains genapi-blocked and is correctly out-of-scope for this pass.

The largest single risk-reducer is **#3 (bench coverage gap + `allow_failure`)** because it is the only meta-finding: every other fix is bench-invisible until #3 lands.

---

## Suggested Cohort Order (advisory; not in scope to file)

1. Add the five missing benchmarks; regenerate `bench-baseline.txt`. (Enables #2, #4, #6, #7 to land safely.)
2. Single `http.Transport` singleton, wire HIBP + metrics + future outbound. (#2)
3. Flip `bench-gate` `allow_failure: false`. (#3 closure.)
4. `bufio` rewrite of `lspFrameReader`. (#4)
5. Frontend polling clock hub. (#1)
6. `layoutCache.get` clone removal. (#5, closes #294.)
7. `projectSnapshot` map-fronted family lookup. (#6)
8. Memoize `Sparkline` + dashboard cards. (#8)
9. Schema-cache LRU bound. (#9)
10. `pushSynthesisedRows` single-pass. (#10)
11. `streamRowsOverWS` producer/consumer split. (closes #306)

---

## Notes for `/codepros:perf-review` Downstream

- Every "confidence::suspected" finding above is suspected because no bench exists. Filing #3 first converts every downstream suspected → confirmed/refuted via the benchmark.
- The Cytoscape full-rebuild-on-`sig`-change (line 47 of detailed Pipelining/Streaming table) is genuinely a "we may be incremental-update-feasible" suspicion; closing it requires a perf-smoke A/B against `cy.add()` / `cy.remove()` increments. Not in this pass's scope.
- `Server-Timing` trailer emission is sound; what's missing is the aggregator.
