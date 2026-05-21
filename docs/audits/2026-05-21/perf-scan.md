# Performance Scan — geode-ui (2026-05-21)

**Root:** `/data/home/benji/src/gl/gitlab.com/devnw/codepros/geode/geode-ui`
**Branch:** `main` (clean tree, HEAD `1199648`)
**Mode:** read-only investigation; no benchmarks executed (per task constraints).

This pass is a grep-first perf-scanner against the hot-path map in `docs/audits/2026-05-21/perf-context.md`. It confirms or reopens red-flag patterns and audits the validity of `bench-baseline.txt` against the current code paths. No source code or GitLab issues were modified.

---

## Counts at a glance

| Category | Findings | Confirmed | Suspected |
|---|---:|---:|---:|
| Backend (Go) | 6 | 4 | 2 |
| Frontend (TS/React) | 4 | 3 | 1 |
| Infra / CI / bench | 3 | 3 | 0 |
| **Total** | **13** | **10** | **3** |

All findings tagged `confidence::confirmed` or `confidence::suspected`. None require source-code changes here; downstream `/codepros:perf-review` or `/codepros:gap-analysis` decides whether to file a GitLab issue.

---

## PERF_GAP_ANALYSIS.md status

`docs/PERF_GAP_ANALYSIS.md` (last updated 2026-05-19, closure cohort): all 7 Phase-4 (2026-05-19) cadence items closed by 2026-05-19. Three OPEN carry-over items remain on the gap surface, all P2:

| Issue | Summary | Status this pass |
|---|---|---|
| [#294](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/294) — layoutCache.get clones full PosMap on every hit | OPEN; quick win | **REVERIFIED** at `src/components/results/graph/layoutCache.ts:61` — still cloning. See F-FE-2 below. |
| [#302](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/302) — WS protocol JSON-only; design + bench MessagePack/CBOR | OPEN; design exercise | No new evidence; tracked. |
| [#306](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/306) — `streamRowsOverWS` sequential scan → encode → write | OPEN; producer-goroutine + bounded channel design | Confirmed scan/encode/write are sequential at `internal/server/ws_query.go:391-455`. |

No previously-Resolved row was re-opened by this scan. **No new blockers.**

---

## Red-Flag Patterns

| Pattern | File:Line | Code Snippet | Impact | Confidence |
|---|---|---|---|---|
| HMAC body signing buffers the full body up to 1 MiB cap (non-streaming) — closed-as-needs-genapi but still on the wire | `gen/pkg/securex/secure.go:318-359` | (read-only, no snippet — body buffered into single byte slice for HMAC) | 100 MiB custom-limit path = 908 ms/op, 268 MiB/op (#171 bench) | confidence::confirmed |
| `lspFrameReader.ReadFrame` reads the LSP header **one byte at a time** with a fresh 1-byte `make([]byte, 1)` per loop and `append(header, buf[0])` grows the slice byte-by-byte | `internal/server/ws_lsp.go:351-374` | `buf := make([]byte, 1)` then `for { f.r.Read(buf); header = append(header, buf[0]); ... }` | Per-frame syscall × header-length (~40-80 bytes) + slice-grow churn; multiplied across every LSP→WS message | confidence::suspected (no bench coverage; verify with `BenchmarkLspFrameReader` against a real LSP completion-traffic capture) |
| HIBP path constructs a fresh `&http.Client{Timeout: 5s}` per call when `policy.HIBPClient == nil` — no connection-pool reuse across password validations | `internal/server/password_policy.go:169-172` | `client := policy.HIBPClient; if client == nil { client = &http.Client{Timeout: 5 * time.Second} }` | TLS handshake + new TCP conn every login/registration / password change; default config does not wire `HIBPClient` from `cmd/server/app.go` | confidence::confirmed |
| `streamRowsOverWS` sequential scan → encode → write (no producer/consumer split) | `internal/server/ws_query.go:391-455` | scan → batcher.add → batcher.flush all on the same goroutine | I/O latency stalls scan; tail-latency on a slow client back-pressures the cursor | confidence::confirmed (already filed as #306, OPEN) |
| `ParseProm` + `projectSnapshot` do **11 linear `FindFamily` scans** over the metric-family slice per `/api/v1/metrics` request (one per `if f := FindFamily(...)` block) | `internal/server/handlers_metrics.go:228-281`, `internal/server/promparse.go:355-362` | `for i := range fams { if fams[i].Name == name { return &fams[i] } }` ×11 | Polled every 5 s per visible SPA tab × concurrent dashboards; modest CPU but **no bench coverage** | confidence::suspected |
| `metricsHTTPClient` returns `&http.Client{Timeout: 2*time.Second}` constructed every call when not configured — no connection pooling for the 5s-poll path | `internal/server/handlers_metrics.go:214-219` | `return &http.Client{Timeout: metricsUpstreamTimeout}` | Per-request transport build; small wins compared to upstream poll but no `http.Transport.MaxIdleConns` tuning anywhere in tree | confidence::confirmed |

---

## Build & Runtime Config

| Finding | File:Line | Category | Impact | Confidence |
|---|---|---|---|---|
| `bench-gate` job is `allow_failure: true` in CI — perf regressions are advisory, not blocking | `.gitlab-ci.yml` (bench-gate job per perf-context note); `bench-baseline.txt` | Regression gate | A >10 % delta in ns/op / B/op / allocs/op does not fail an MR | confidence::confirmed |
| **No benchmarks** cover `ParseProm`, `projectSnapshot`, `HandleMetrics`, or `lspFrameReader.ReadFrame` — three of these are 5s-poll hot paths | `internal/server/*_test.go` (absence) | Bench coverage gap | Regressions in metrics-poll or LSP framing are invisible to `bench-gate` | confidence::confirmed |
| Schema cache eviction is TTL-only; no per-graph LRU bound (already noted in context but no GitLab issue) | `internal/server/schema_cache.go:34,76-86` | Memory hygiene | A long-lived browser tab cycling many graph names retains all of them for 120 s each | confidence::confirmed (matches PERF_GAP_ANALYSIS.md `Unknowns` section but currently un-filed) |

---

## Language-Specific Issues

### Go

| Finding | File:Line | Best Practice | Impact | Confidence |
|---|---|---|---|---|
| `lspFrameReader` uses byte-by-byte `Read([]byte{x1})` instead of `bufio.Reader.ReadString('\n')` or `bufio.NewReader.ReadSlice` | `internal/server/ws_lsp.go:351-374` | Use buffered I/O for line-oriented protocols | Per-byte read + slice-grow + 1-byte buffer alloc per byte (potentially per-call alloc with escape analysis) | confidence::suspected |
| `projectSnapshot` reuses `s.Queries.DurationSecondsBucket = make([]MetricsHistogramBucket, 0, len(...))` on every call (cold-path heap alloc per /metrics poll) | `internal/server/handlers_metrics.go:237` | Pool small per-request slices for the 5s-poll hot path | Modest; would be visible only at high concurrent-dashboard count | confidence::suspected |
| `scanQueryResult` line `rowJSON := make([]jsontext.Value, 0)` — no capacity hint | `internal/server/result_codec.go:574` | Pre-size when N is known (rows.Next loop ahead) | Cold path (MCP `query` tool + Tx Run); already triaged as D1 watchlist 2026-05-17 | confidence::confirmed (recorded in PERF_GAP_ANALYSIS.md as **Dropped 2026-05-17** — re-noting to keep visibility) |

### TypeScript / React

| Finding | File:Line | Best Practice | Impact | Confidence |
|---|---|---|---|---|
| **F-FE-1 — Three independent `setInterval` pollers per SPA tab; no shared clock** | `src/lib/useMetricsPolling.ts:128` (5 s), `src/components/dashboard/AuditEventMixCard.tsx:124` (30 s), `src/components/ops/AuditLogPage.tsx:196` (5 s) | Coalesce pollers on a single timer + visibility-gated dispatcher | N tabs × N pollers; server load scales linearly with open dashboards. The 5 s metrics tick and 30 s audit-donut tick can drift into the same wall-clock instant, doubling p95 spikes | confidence::confirmed |
| **F-FE-2 — `layoutCache.get` clones full `PosMap` on every hit** (already tracked as OPEN [#294](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/294)) | `src/components/results/graph/layoutCache.ts:61` | Return a frozen / readonly view; cache-write side already clones via `bump(... new Map(positions))` | At n=10k nodes, the per-hit clone is the entire layout snapshot in a Map; reverify with profiler once #294 lands | confidence::confirmed |
| `formatCell` calls `JSON.stringify` per cell for arrays / generic objects — used by every `TableView` cell and the row-height estimator (twice the work) | `src/lib/cellFormat.ts:99,105` | Cache stringified form on first render via the column projection, OR detect "small primitive cell" fast-path | 25 k retention cap × up to 64 columns; long-tail in `JsonView` switch | confidence::suspected (no current bench; was outside the PERF #234/#236 closure scope) |
| `useGraphElements.baseEls` rebuild still rotates `nodeDataById` / `edgeDataById` / `nodeLabelBuckets` identities on every `baseEls` change — guardrail test [#275](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/275) landed but the cascade still has no cheap "rowsVersion-only" key | `src/components/results/graph/useGraphElements.ts:91-158` | Defense-in-depth memo key (PERF_GAP_ANALYSIS.md "Quick wins") | Cascade win from #239 / #249 is currently pinned only by the regression test; a future refactor could regress silently if the test is weakened | confidence::confirmed (matches #275 Resolved-2026-05-17 entry; the regression test is now the only guardrail) |

---

## Bench-baseline.txt validity

`bench-baseline.txt` is 421 lines (~360 `Benchmark*` rows), regenerated 2026-05-17 via commit `0983456` after the round-3 closure cohort. Coverage check vs. the hot-path map:

| Hot path | Bench in baseline | Drift risk |
|---|---|---|
| `streamQueryResult` row codec | `BenchmarkStreamQueryResult_1k5Col`, `BenchmarkStreamQueryResult_PerRowAlloc` | Low — pinned at 808-809 allocs/op |
| `streamRowsOverWS` WS row sender | `BenchmarkStreamRowsOverWS_AllocsPerRow` | Low — pinned at ~11 200 allocs/op (post-#251 pool) |
| Audit ring under concurrent append+snapshot | `BenchmarkAuditRing_ConcurrentAppendSnapshot` | Low — covers the RWMutex contract |
| Schema cache read path | `BenchmarkSchemaCache_Get_Parallel` | Low — 0 allocs/op steady-state |
| Pool DB contention | `BenchmarkPoolDB{Contention,Serial}` | Low |
| Login + profile limiters | `BenchmarkLoginLimiter_Allow_Parallel`, `BenchmarkProfileLimiter_Allow_Parallel` | Low |
| Cancel-reader per-session | `BenchmarkCancelReader_PerSessionOverhead` | Low (post-#218 1-goroutine path) |
| **`ParseProm` text-exposition parse** | **MISSING** | High — 5 s-poll hot path with no regression coverage |
| **`projectSnapshot` (11 × `FindFamily`)** | **MISSING** | High — same as above |
| **`HandleMetrics` end-to-end** | **MISSING** | High — outbound HTTP fetch + parse + project + JSON encode |
| **`lspFrameReader.ReadFrame` byte-by-byte read** | **MISSING** | Medium — LSP traffic is bursty completion edits |
| **`HIBP hibpHasSeen` cold http.Client construct** | **MISSING** | Low — out-of-band password-set path |

**Verdict:** baseline is **still valid for every benchmarked path**. The four `MISSING` rows are coverage gaps, not staleness — they would be additions in a future bench-baseline regeneration cohort, not invalidations of the current pin.

The bench-gate `allow_failure: true` flag remains the structural weakness: even where a regression would be detected, it cannot block an MR today.

---

## Top 5 Perf Red Flags

Ranked by impact × confidence × addressability (no PerfScore math — see `codepros:perf-scoring` for the canonical scoring framework, applied downstream).

| Rank | Finding | File:Line | Suspected Impact |
|---:|---|---|---|
| 1 | Three independent `setInterval` pollers per SPA tab; no shared clock | `src/lib/useMetricsPolling.ts:128`, `src/components/dashboard/AuditEventMixCard.tsx:124`, `src/components/ops/AuditLogPage.tsx:196` | Scales linearly with open tabs; server load and tail latency multiply per dashboard |
| 2 | `layoutCache.get` clones full `PosMap` on every hit | `src/components/results/graph/layoutCache.ts:61` | At n=10k, full Map clone per cache hit dominates the layout warm-rerun path |
| 3 | `lspFrameReader.ReadFrame` reads LSP header byte-by-byte with per-byte 1-byte `make` + `append` | `internal/server/ws_lsp.go:351-374` | Per-byte syscall + slice-grow churn across every LSP message; no bench coverage means regressions are invisible |
| 4 | `HandleMetrics` allocates a fresh `&http.Client{...}` per request when `MetricsHTTPClient` is nil; no `http.Transport.MaxIdleConns` tuning | `internal/server/handlers_metrics.go:214-219`, `internal/server/password_policy.go:169-172` | TLS handshake + new TCP conn for every 5 s upstream poll AND every HIBP check; pool reuse never engages |
| 5 | `bench-gate` is `allow_failure: true` AND `ParseProm` / `projectSnapshot` / `HandleMetrics` / `lspFrameReader` have **no benchmark** | `.gitlab-ci.yml` bench-gate job; `internal/server/*_test.go` (absence) | Regressions in 5 s-poll path and LSP framing path cannot fail an MR even if benched |

---

## Blockers

None. This scan is non-destructive and finds no PERF P0/P1 regression against the current `bench-baseline.txt` pin. The three OPEN P2 carry-overs from the 2026-05-19 cohort (#294, #302, #306) are quick-win territory and unblocked by upstream.

`/codepros:perf-review` (the agent-driven follow-up) should be the next step to assign PerfScores, file or update GitLab issues for any new findings not already tracked, and decide whether the bench-gate `allow_failure: true` flag is itself ready to flip.
