# Performance Context — geode-ui

**Root:** `/data/home/benji/src/gl/gitlab.com/devnw/codepros/geode/geode-ui`
**Platform:** GitLab (remote `git@gitlab.com:devnw/codepros/geode/geode-ui.git`)
**Branch:** `main` (clean tree, HEAD `1199648`)
**Languages:** Go (server, backend), TypeScript / React (SPA), Zig (sibling `geode` DB — out of repo)

---

## 1. Services & Entrypoints

| Service | Entrypoint / Handler | Type | Path |
|---|---|---|---|
| geode-ui HTTP server (main listener) | `run` / `newApp` / `serve` | HTTP/1.1+WS, `:8080` | `cmd/server/main.go:11`, `cmd/server/app.go:190,357` |
| Route registration | `registerRoutes` | mux assembly | `cmd/server/app_routes.go:58-152` |
| pprof (opt-in, loopback-only) | `startPprofServer` (`GEODE_PPROF=1`) | HTTP, `127.0.0.1:6060` | `cmd/server/pprof.go:100-134` |
| REST: streaming query | `(*GraphServer).Query` — `POST /api/v1/query` | streaming JSON | `internal/server/handlers_query.go:54-97` |
| REST: metrics proxy | `(*GraphServer).HandleMetrics` — `GET /api/v1/metrics` | upstream-proxy → Prom-text → JSON projection | `internal/server/handlers_metrics.go:141-208` |
| REST: audit log | `(*GraphServer).HandleAudit*` — `GET /api/v1/audit` | in-memory ring snapshot | `internal/server/handlers_audit.go` |
| REST: profiles CRUD | genapi-emitted under `/api/v1/profiles/*` | per-actor limited | `internal/server/handlers_profiles*.go` |
| REST: auth login / CSRF / logout | `HandleLogin` / `HandleCSRF` / `HandleLogout` | per-IP limited; ≥250 ms latency floor on fail | `internal/server/handlers_auth.go:448`, `cmd/server/app_routes.go:72-79` |
| REST: schema cache | genapi-emitted `/api/v1/graphs/*` | 120 s TTL singleflight | `internal/server/schema_cache.go:34` |
| WS: query streaming | `genws`-emitted `/ws/query` | WebSocket frames | `internal/server/ws_query.go`, `gen/pkg/wsx/ws.go` |
| WS: LSP bridge | `RegisterLspWS` — `/ws/lsp` | WebSocket ↔ TCP bridge | `internal/server/ws_lsp.go:141-156`, `cmd/server/app_routes.go:115-121` |
| MCP JSON-RPC | `genmcp.HandleMCPHTTP` — `POST /mcp` | one tool: `query` | `cmd/server/app_routes.go:135-137`, `internal/server/mcp.go` |
| SPA shell | `ui.Handler()` + `WithSPASecurityHeaders` | embedded webpack bundle | `cmd/server/app_routes.go:139-149`, `internal/ui/embed.go` |
| Frontend metrics polling | `useMetricsPolling` (5 s tick, visibility-gated) | client poll | `src/lib/useMetricsPolling.ts:31-156` |
| Frontend audit donut | `AuditEventMixCard` (30 s tick) | client poll | `src/components/dashboard/AuditEventMixCard.tsx:42-132` |
| Frontend audit page | `AuditLogPage` (5 s `setInterval` + 300 ms debounce) | client poll | `src/components/ops/AuditLogPage.tsx:131,196` |
| Graph render | `useGraphCytoscape` + `useLayoutWorker` | Cytoscape + Web Worker | `src/components/results/graph/*` |
| Stream parse worker | `queryStreamWorker` (offloaded JSON.parse) | Web Worker | `src/lib/queryStreamWorker.ts` |

Upstream services (e2e topology, `deploy/docker-compose.test.yml`):
- `geode` (QUIC `3141`, Prom `9090`/host `9093`) — the database.
- `geode-init` — one-shot seeder.
- `geode-mcp` (`8090`) — MCP HTTP bridge.
- `geode-lsp` (`2087`) — LSP-over-TCP via socat.
- `geode-ui` (`8080`) — this server.
No Postgres or Neo4j in-tree; SQLite is used only for the profile store (`/var/lib/geode-ui/profiles.db`, `cmd/server/app.go:78`).

## 2. Workload Characteristics

| Parameter | Value | Source | Confidence |
|---|---|---|---|
| SLO Latency (upstream query p50) | ~10 ms | `docs/ARCHITECTURE.md:156` | assumed (no telemetry) |
| Steady-state RPS (`POST /api/v1/query`) | ~2 000 rps | `docs/ARCHITECTURE.md:149`, `geode.json:21,53` | assumed; aligned with route `rateLimit` |
| Burst concurrency | ~400 concurrent users | `docs/ARCHITECTURE.md:151`, `geode.json:22` | assumed |
| Result-set distribution | p10–p90 1–1 000 rows, long tail to 100k+ | `docs/ARCHITECTURE.md:153-155` | assumed |
| Per-IP RPS / burst | 50 / 100 | `geode.json:23-24` | confirmed config |
| Login limiter | 5 rps per IP, burst 10, 5-fail / 15-min lockout | `internal/server/loginlimiter.go:92-93` | confirmed |
| Profile-CRUD limiter | 0.5 rps (30/min) per actor, burst 10 | `internal/server/profilelimiter.go:39,56,87` | confirmed |
| Connection pool (per profile) | 64 open / 16 idle / 5 min lifetime / 25 s idle | `internal/conn/pool.go:28-32,48-55` | confirmed |
| REST write timeout | 60 s (`restWriteTimeout`) | `cmd/server/app.go:34` | confirmed |
| Read-header timeout | 5 s | `cmd/server/app.go:300` | confirmed |
| Idle timeout | configured via `hcfg.IdleTimeout` (genapi) | `cmd/server/app.go:305` | confirmed |
| `/api/v1/query` per-request timeout default | 30 s (`req.TimeoutMs` overridable) | `internal/server/handlers_query.go:59-63,151-155` | confirmed |
| `/api/v1/metrics` upstream timeout | 2 s | `internal/server/handlers_metrics.go:53` | confirmed |
| WS query batch | 64 rows / frame | `internal/server/ws_query.go:39` | confirmed |
| WS LSP write timeout | 30 s; max frame/message 16 MiB; ping 30 s | `internal/server/ws_lsp.go:141-145` | confirmed |
| HTTP streaming flush cadence | every 64 rows | `internal/server/result_codec.go:390` | confirmed |
| Max body bytes (per route) | 524 288 query / 4 096 tx / 1 048 576 default | `geode.json:54,113`, `geode.json:13` | confirmed |
| Bundle budget (webpack) | `performance.hints: 'error'`, 1 MiB asset / 1.5 MiB entry | `docs/ARCHITECTURE.md:159-160` | confirmed |
| Schema cache TTL | 120 s | `internal/server/schema_cache.go:34` | confirmed |
| Graph stats client cache TTL | 60 s, 32-entry LRU | `src/lib/useOverviewData.ts:73,70` | confirmed |
| Metrics poll cadence | 5 s, 5-min history ring, visibility-gated | `src/lib/useMetricsPolling.ts:31-32,82-86` | confirmed |
| Audit donut cadence | 30 s, 200-entry sample | `src/components/dashboard/AuditEventMixCard.tsx:36,42` | confirmed |
| Audit page cadence | 5 s `setInterval` + 300 ms debounce | `src/components/ops/AuditLogPage.tsx:131,196` | confirmed |

## 3. Performance Model (Hypothesized Hot Components)

| Component | Resource | Why | File:Line |
|---|---|---|---|
| `POST /api/v1/query` streaming | CPU + Net + GC | 2 000 rps SLO; row-scan + JSON encode + flush every 64 rows; long-tail 100k-row streams | `internal/server/handlers_query.go:54-97`, `internal/server/result_codec.go:385-499` |
| `streamRowsOverWS` row batcher | CPU + GC | per-row scan + JSON marshal; 64-row WS frames; closed alloc-count contract (`#251`) | `internal/server/ws_query.go:268-377` |
| Prom-text proxy + projection | CPU (parse) + Net (outbound 2 s) | called every 5 s × concurrent dashboards; bufio scan + family lookup | `internal/server/handlers_metrics.go:166-198`, `internal/server/promparse.go:85-125` |
| Audit ring snapshot | CPU + RAM (10k-entry ring) | Now `sync.RWMutex` (#246); polled at 5 s / 30 s from SPA | `internal/server/audit.go:115-120,169-197` |
| Schema cache singleflight | CPU + Net (cold) | 120 s TTL; cold misses fan out to upstream `SHOW LABELS / EDGES / INDEXES` | `internal/server/schema_cache.go` |
| `/api/v1/metrics` (SPA → server → upstream) | Net + Latency | One outbound GET per 5 s per visible tab; 2 s timeout | `src/lib/useMetricsPolling.ts:31`, `internal/server/handlers_metrics.go:53` |
| Cytoscape graph render | CPU (main thread) + Mem | 400+ node target; rebuild debounced 250 ms; layout offloaded to Web Worker | `src/components/results/graph/useGraphCytoscape.ts:335`, `src/components/results/graph/useLayoutWorker.ts:109` |
| WS JSON.parse worker | CPU (worker) + Net (postMessage) | offloaded per #297; transferable Float32Array layout positions per #291 | `src/lib/queryStreamWorker.ts`, `src/components/results/graph/layoutWorker.ts:120` |
| Stream reducer + table projection | CPU + Mem | retention cap 25 000 rows; column budget 64; rAF coalesce | `src/pages/queryStreamReducer.ts`, `src/components/results/projectColumns.ts` |
| Login latency floor | CPU (dummy compare) + wall time | 250 ms floor on every login failure (anti-timing-channel) | `internal/server/handlers_auth.go:448` |
| HMAC body signing | CPU + Mem | non-streaming up to body cap; 100 MiB path = 908 ms / 268 MiB/op (`#171`) | `gen/pkg/securex/secure.go:318-359` |
| Embedded SPA chunks | Bundle bytes | `2749.*.js` ~6.4 MiB, `4111.*.js` ~3.7 MiB (`#285`); no CI bundle gate | `internal/ui/dist/*` (build artifact) |

## 4. External Dependencies

| Dependency | Type | Connection Pooling | Timeout | Path |
|---|---|---|---|---|
| `geode` (QUIC, port 3141) via geode-client-go | SQL-like driver | per-profile `*sql.DB`, 64 open / 16 idle | per-query 30 s default | `internal/conn/pool.go:28-55`, `internal/server/handlers_query.go:59-63` |
| `geode` Prometheus listener (`GEODE_METRICS_URL`) | HTTP/1.1 | `http.Client{Timeout:2s}` (no pool tuning) | 2 s upstream cap | `internal/server/handlers_metrics.go:214-219` |
| Upstream LSP TCP (`-lsp-upstream`, default `127.0.0.1:3142`) | TCP via `net.DialTimeout` | per-connection (1 dial per WS upgrade) | 5 s dial, 30 s write | `internal/server/ws_lsp.go:143-156` |
| SQLite profile store (`/var/lib/geode-ui/profiles.db`) | local file | `database/sql` default | none documented | `cmd/server/app.go:78,229` |
| JWT revocation persistence | SQLite RW handle (shared with profile store) | n/a | swept every 10 min | `cmd/server/app.go:248`, `app.go:365` |

## 5. Baseline Measurements

| Benchmark | Command | Result | Date |
|---|---|---|---|
| Go curated bench set | `make bench-gate` → `scripts/bench-gate.sh` | committed at `bench-baseline.txt` (421 lines, ~360 `Benchmark*` rows; e.g. `BenchmarkPoolDBContention` ~140-170 ns/op, 0 allocs) | 2026-05-17 (regenerated by `0983456`) |
| Perf-smoke (Cytoscape A/B) | `make perf-smoke` (drives Playwright `/dev/graph-bench`) | results JSON at `docs/performance/<date>-perf-smoke.results.json`; layoutMs p95 budget < 2 500 ms (`docs/performance/2026-05-15-cytoscape-perf-optimization-status.md:84,94`) | 2026-05-15 |
| Webpack production build | `npm run build` (with `EMBEDDED_BUILD=1`) | `internal/ui/dist` ~16 MiB; `2749.*.js` ~6.4 MiB, `4111.*.js` ~3.7 MiB, `vendors.*.js` ~542 KiB, `main.*.js` ~223 KiB | 2026-05-17 |
| Streaming reducer / table projection | jest (`queryStreamReducer.test.ts::retention cap`, `QueryPage.streamMemo.test.tsx::PERF-2026-05-17-02`) | retention cap 25 000 rows; rAF-coalesced respDerivation; pre-#234 13.38 s/32 k now historical | 2026-05-17 |

CI: GitLab CI `bench-gate` job (`.gitlab-ci.yml`, `test` stage, `allow_failure: true`) compares against `bench-baseline.txt` via `benchstat`; fails (advisorily) on >10 % delta in ns/op / B/op / allocs/op.

Not run in this pass: no benchmarks were executed (task forbids it).

## 6. Available Profiling Tools

| Tool | Available | Version |
|---|---|---|
| `go` | yes | go1.26.3 linux/amd64 |
| `node` | yes | v22.14.0 |
| `npm` | yes | 10.9.2 |
| `benchstat` (`~/go/bin/benchstat`) | yes | local install |
| `perf` (`/usr/bin/perf`) | yes | system |
| `pprof` (Go toolchain) | yes (via `go tool pprof`) | bundled with go1.26.3 |
| `hyperfine` | no | not on PATH |
| `clinic` / `node --prof` | not verified | Node 22 supports `--prof` natively |
| `pprof` HTTP endpoint | opt-in only (`GEODE_PPROF=1`), loopback-only on `127.0.0.1:6060` | `cmd/server/pprof.go:42` |

## 7. Unknowns & Assumptions

- **No production telemetry exists.** Every SLO/RPS/burst/result-size number above is inherited from `docs/ARCHITECTURE.md:139-160` and explicitly marked *assumed, pending real measurement*. Workload distributions for: streamed long-tail (100k+ row) frequency; concurrent WS streams per server; MCP batch workload shape; graph property cardinality; browser long-task budgets — all unknown.
- **No `Server-Timing` regression telemetry yet.** Headers are emitted by `streamQueryResult` (`internal/server/result_codec.go:430-446`, `#281` closed via `912be6d`), but no aggregated p50/p95 is collected or alerted on.
- **`/api/v1/metrics` projects only well-known families.** Multi-component gauges collapse to the first observation (`internal/server/promparse.go:30-33`); per-graph or per-profile cardinality from upstream is not surfaced.
- **No CI bundle-budget tripwire.** `#285` (3.7 MiB largest async chunk) is the highest-PerfScore P3 open item; growth in `4111.*.js` or `2749.*.js` is invisible to MRs today.
- **HMAC body signing scales poorly past the 1 MiB default body cap** (`#171`, blocked on upstream genapi).
- **Schema-cache eviction is TTL-only**; no per-graph LRU bound — a long-lived browser tab cycling many graph names will keep all of them resident for 120 s each.
- **Frontend pollers don't share a clock.** A single SPA tab issues one /metrics fetch every 5 s, one /audit fetch every 5 s (when on the audit page), and one /audit fetch every 30 s (dashboard); N tabs ≈ N× server work — no client-side coalescing.
- **LSP bridge has `ReadTimeout=0`** (`internal/server/ws_lsp.go:143`) — relies on `IdleTimeout` upstream for stuck-peer reaping.
- **Login latency floor (250 ms)** is an intentional anti-timing-channel tax that caps `POST /api/v1/auth/login` throughput on the failure path to ≤4 rps per goroutine, independent of the 20 rps rate-limit configured in `geode.json:43`.
- **Build context** is unusual: `deploy/Dockerfile` reaches across siblings to `../geode-client-go/` and `../geode/zig-out/bin/geode`. Profiling builds outside the docker-compose stack requires the same sibling layout.
