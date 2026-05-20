# Geode Metrics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the upstream geode database's Prometheus `/metrics` exposition on the geode-ui Dashboard page when the operator has enabled the metrics listener on the geode server, render the meaningful metrics with charts (line/area for time series, donut for categorical) using `recharts`, and add an e2e test that proves the dashboard polls metrics end-to-end against a metrics-enabled geode test container.

**Architecture:**

```
geode (Zig)                     geode-ui (Go)              geode-ui SPA (React)
  │                                │                          │
  │  GEODE_METRICS_PORT=9090       │                          │
  │  starts internal HTTP listener │                          │
  │  ──────► /metrics              │                          │
  │  (prometheus text 0.0.4)       │                          │
  │                                │                          │
  │                                │  /api/v1/metrics          │
  │                                │  - fetches geode /metrics │
  │                                │  - parses prom text       │
  │                                │  - returns JSON           │
  │                                │  - retained 5 min ring    │
  │                                │  - 401 if !auth           │
  │                                │  - 503 if !configured     │
  │                                │                          │
  │                                │  Capability flag:        │
  │                                │    metrics_enabled       │
  │                                │  (true iff env wired)    │
  │                                │                          │
  │                                │  ◄────────────  GET ────► │
  │                                │                          │  GET /api/v1/capabilities
  │                                │                          │  (already wired)
  │                                │                          │
  │                                │                          │  GET /api/v1/metrics?since=…
  │                                │                          │  every 5s, gated on
  │                                │                          │  document.visibilityState
  │                                │                          │
  │                                │                          │  <MetricsDashboard/>
  │                                │                          │   ├ Recharts panels
  │                                │                          │   └ AuditEventMix donut
```

**Tech Stack:**

- **Server proxy:** Go (gen + handler) — stdlib only (no Prometheus parser dep; the text format is one line per metric and easy to parse).
- **Capability flag:** extends the existing `/api/v1/capabilities` payload with `metricsEnabled: bool` so the SPA can hide the Metrics card when the server is configured without `GEODE_METRICS_PORT`.
- **Frontend:** React 18, `recharts ^2.13` (new dep — ~80 KB gzipped, declarative, SVG, easy to theme via Bootstrap CSS vars), `useApiResource` for polling + abort/stale handling (already in tree), styled-components for non-Bootstrap-utility chrome.
- **Audit event mix:** computed client-side from the existing `/api/v1/audit` list (no new endpoint).
- **Compose:** `GEODE_METRICS_PORT=9090` env var + port mapping on the `geode` service in `deploy/docker-compose.test.yml`.
- **e2e:** Playwright spec (new) that runs a query, then asserts the dashboard metric cards render non-zero counters and a non-empty time-series chart.

---

## Bug-attribution check

The user's request implies an additive feature, not a bug. The check applies anyway:

- **Geode (Zig) upstream:** the `/metrics` endpoint already exists (`src/monitoring/metrics_server.zig`) and is gated on `GEODE_METRICS_PORT`. Metrics emitted (`src/monitoring/prometheus.zig`):
  - `geode_queries_total` (counter)
  - `geode_queries_failed_total` (counter)
  - `geode_query_duration_seconds` (histogram → buckets + `_sum` + `_count`)
  - `geode_connections_active` (gauge)
  - `geode_connections_total` (counter)
  - `geode_transactions_total` (counter)
  - `geode_transactions_failed_total` (counter)
  - `geode_nodes_total` (gauge)
  - `geode_edges_total` (gauge)
  - `geode_memory_bytes` (gauge)
  - …plus OTel-bridge metrics (vector ops, distributed ops) — out of scope for v1.
- **geode-ui:** missing proxy + dashboard panels — this is what this plan delivers.
- **deploy/docker-compose.test.yml:** missing `GEODE_METRICS_PORT` env + port map — this is what this plan delivers.

**No upstream geode entry needed.** This plan is entirely additive in geode-ui.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `internal/server/handlers_metrics.go` | `Metrics(w,r,_)` — fetches `http://<geode>:<metrics-port>/metrics` (configured via env), parses prom text, returns JSON-shaped `MetricsSnapshot`. | Create |
| `internal/server/handlers_metrics_test.go` | Unit tests: parse counter/gauge/histogram, propagate upstream 5xx, gracefully return 503 when not configured. | Create |
| `internal/server/promparse.go` | Stdlib Prom-text parser (counter/gauge/histogram families) — keep tight (`<200 LoC`). | Create |
| `internal/server/promparse_test.go` | Fixture-driven parser tests against canonical geode `/metrics` payloads. | Create |
| `internal/server/handlers_capabilities.go` | Add `metricsEnabled` to the `Capabilities` payload. | Modify |
| `internal/server/handlers_capabilities_test.go` | Assert the new field reflects the env wiring. | Modify |
| `internal/server/server.go` (or wherever route table is) | Register `GET /api/v1/metrics`. | Modify |
| `genapi.json` | Add `MetricsSnapshot` + `Metrics` operation so the generated client picks them up. | Modify |
| `gen/...` | Regenerate (do not hand-edit). | Generate |
| `package.json` | Add `"recharts": "^2.13.0"` to dependencies. | Modify |
| `src/lib/useMetricsPolling.ts` | Hook: polls `client.metrics()` every 5s, abort/stale via `useApiResource`, gates on `document.visibilityState`. Returns `{snapshot, history, error}`. `history` is a fixed-window ring (last 5 min) of snapshots so spark/area charts have something to render. | Create |
| `src/lib/useMetricsPolling.test.ts` | Tests: 5s cadence, hidden-tab pause, abort on unmount, ring eviction. | Create |
| `src/components/dashboard/MetricsCard.tsx` | Card shell wrapping a recharts panel — title, loading/error states, a small "view all" disclosure for raw labels. | Create |
| `src/components/dashboard/MetricsCard.test.tsx` | Tests: renders title, swallows loading vs error vs ready states, renders the chart element. | Create |
| `src/components/dashboard/QueryThroughputCard.tsx` | Line chart of QPS (derivative of `geode_queries_total`) + p50/p95/p99 derived from `geode_query_duration_seconds` buckets. | Create |
| `src/components/dashboard/QueryThroughputCard.test.tsx` | Fixture-driven: feed two snapshots 5 s apart and assert the rendered series. | Create |
| `src/components/dashboard/ConnectionsCard.tsx` | Gauge (current `geode_connections_active`) + spark-line of last 5 min. | Create |
| `src/components/dashboard/ConnectionsCard.test.tsx` | Tests for empty state + non-zero state. | Create |
| `src/components/dashboard/StorageCard.tsx` | Numeric cards: nodes total, edges total, memory bytes (human-readable). | Create |
| `src/components/dashboard/StorageCard.test.tsx` | Tests for formatting (KB / MB / GB) and graceful fallback when fields are absent. | Create |
| `src/components/dashboard/AuditEventMixCard.tsx` | Donut chart of event-type counts over the last N entries fetched from `/api/v1/audit`. | Create |
| `src/components/dashboard/AuditEventMixCard.test.tsx` | Tests: counts are correct, slices are stable across re-renders. | Create |
| `src/pages/DashboardPage.tsx` | Add the new cards behind `metricsEnabled` capability gate. | Modify |
| `src/pages/DashboardPage.test.tsx` | Assertions for: cards render when capability is on; cards are absent when capability is off. | Modify |
| `src/services/i18n/locales/en.ts` | New strings: `dashboard.metrics.title`, `dashboard.metrics.qps`, `dashboard.metrics.latencyP95`, `dashboard.metrics.connections`, `dashboard.metrics.storage`, `dashboard.metrics.auditMix`, etc. | Modify |
| `deploy/docker-compose.test.yml` | Add `GEODE_METRICS_PORT=9090` env + expose `9090:9090/tcp` on the `geode` service; add `GEODE_METRICS_URL=http://geode:9090/metrics` on the `geode-ui` service. | Modify |
| `deploy/Dockerfile` (geode-ui) | Read `GEODE_METRICS_URL` at runtime (no rebuild required). | Modify (config-only) |
| `e2e/specs/22-dashboard-metrics.spec.ts` | New Playwright spec: log in, navigate to dashboard, run a query in another tab, return to dashboard, assert metric cards rendered non-zero counts. | Create |

---

## Task 0: Prerequisite — confirm upstream geode build supports metrics

This is a verification step, NOT an implementation step. If it fails, the rest of the plan is blocked until the geode image is rebuilt with metrics linked in.

- [ ] **Step 1: Confirm the geode v0.5.19 image starts a `/metrics` listener when `GEODE_METRICS_PORT` is set.**

  ```bash
  docker run --rm -p 9090:9090 -e GEODE_METRICS_PORT=9090 \
    geode:v0.5.19 --data-dir /tmp/x --listen 0.0.0.0:3141 --log-level info &
  sleep 3
  curl -s http://localhost:9090/metrics | grep '^geode_' | head -5
  ```

  Expected: at least 5 lines of `geode_*` metrics in prom text format.
  If empty: rebuild the geode image with the monitoring module linked in.

- [ ] **Step 2: If Step 1 fails, file `docs/upstream-issues/metrics-not-linked.md` and STOP.** The rest of this plan depends on a metrics-enabled geode binary.

---

## Task 1: Prom-text parser (foundation, server-side)

**Files:**

- Create: `internal/server/promparse.go`
- Test: `internal/server/promparse_test.go`

The Prometheus text exposition format is line-oriented:

```text
# HELP geode_queries_total Total queries executed
# TYPE geode_queries_total counter
geode_queries_total 42
# HELP geode_query_duration_seconds Query duration histogram
# TYPE geode_query_duration_seconds histogram
geode_query_duration_seconds_bucket{le="0.005"} 1
geode_query_duration_seconds_bucket{le="0.01"} 3
geode_query_duration_seconds_bucket{le="+Inf"} 42
geode_query_duration_seconds_sum 0.184
geode_query_duration_seconds_count 42
```

We do NOT pull in `github.com/prometheus/common/expfmt` — it's a 2 MB transitive blob and we only need three families: counter, gauge, histogram.

- [ ] **Step 1: Write the failing parser test.**

  Fixture: `internal/server/testdata/prom-sample.txt` (paste the geode `/metrics` snippet above plus a representative full payload).

  ```go
  // internal/server/promparse_test.go
  func TestParseProm_GeodeSample(t *testing.T) {
    data, err := os.ReadFile("testdata/prom-sample.txt")
    if err != nil { t.Fatal(err) }
    fams, err := parseProm(bytes.NewReader(data))
    if err != nil { t.Fatal(err) }
    counter := findCounter(t, fams, "geode_queries_total")
    if counter.Value != 42 { t.Fatalf("want 42, got %v", counter.Value) }
    hist := findHistogram(t, fams, "geode_query_duration_seconds")
    if hist.Count != 42 || hist.Sum != 0.184 {
      t.Fatalf("hist: count=%v sum=%v", hist.Count, hist.Sum)
    }
    if len(hist.Buckets) != 3 {
      t.Fatalf("want 3 buckets, got %d", len(hist.Buckets))
    }
  }
  ```

- [ ] **Step 2: Implement `parseProm(r io.Reader) ([]MetricFamily, error)`.**

  Shape:

  ```go
  type MetricFamily struct {
    Name    string
    Help    string
    Type    string // "counter" | "gauge" | "histogram"
    Counter *float64
    Gauge   *float64
    Hist    *Histogram
  }
  type Histogram struct {
    Sum     float64
    Count   uint64
    Buckets []Bucket
  }
  type Bucket struct {
    UpperBound float64 // +Inf encoded as math.Inf(1)
    Count      uint64
  }
  ```

  Parsing rules (stdlib only):

  - `# HELP <name> <text>` → store help for that family.
  - `# TYPE <name> <type>` → start a new family.
  - `<name>_bucket{le="…"} <v>` → append to `Hist.Buckets`.
  - `<name>_sum <v>` / `<name>_count <v>` → populate `Hist.Sum` / `Hist.Count`.
  - `<name> <v>` (no `{…}`) → counter or gauge value.
  - Ignore everything else (label sets, comments without HELP/TYPE prefix).

- [ ] **Step 3: Property test for `parseProm`:** given a fixture with 1, 10, 100 metric families, parse must succeed without allocating beyond the input size by more than 2× (sanity bound).

---

## Task 2: `Metrics` HTTP handler (server proxy)

**Files:**

- Create: `internal/server/handlers_metrics.go`
- Test: `internal/server/handlers_metrics_test.go`

- [ ] **Step 1: Write the failing handler test.**

  ```go
  func TestMetrics_HappyPath(t *testing.T) {
    // Spin a fake upstream metrics server.
    upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
      _, _ = w.Write([]byte(promFixture))
    }))
    t.Cleanup(upstream.Close)
    s := newStubServerWithMetricsURL(t, upstream.URL)
    rec := httptest.NewRecorder()
    req := httptest.NewRequest(http.MethodGet, "/api/v1/metrics", nil)
    resp, err := s.Metrics(rec, req, &gentypes.Empty{})
    if err != nil { t.Fatal(err) }
    if resp.Snapshot.Queries.Total != 42 { t.Fatalf("want 42, got %v", resp.Snapshot.Queries.Total) }
  }

  func TestMetrics_NotConfigured(t *testing.T) {
    s := newStubServerNoMetricsURL(t)
    rec := httptest.NewRecorder()
    req := httptest.NewRequest(http.MethodGet, "/api/v1/metrics", nil)
    _, err := s.Metrics(rec, req, &gentypes.Empty{})
    // Must propagate as a 503 with code=METRICS_DISABLED, not a 500.
    if !errors.Is(err, ErrServiceUnavailable) { t.Fatalf("want 503, got %v", err) }
  }
  ```

- [ ] **Step 2: Implement `handlers_metrics.go`.**

  - Read `GEODE_METRICS_URL` env var at server start; store on `GraphServer.cfg`.
  - If unset: return `endpointError{status: 503, code: "METRICS_DISABLED"}`.
  - Otherwise: `http.Get(metricsURL)` with a 2 s timeout (no upstream stall on the API path).
  - Parse with `parseProm`.
  - Project the families into a stable JSON shape (`MetricsSnapshot{Queries, Connections, Transactions, Storage, Memory}`) — DO NOT leak the prom format to the SPA. The SPA wants strongly-typed fields, not a free-form map.

- [ ] **Step 3: Update `internal/server/server.go` (or equivalent) to register the route under the JWT auth chain.** The metrics surface is operator-facing and must not be public.

- [ ] **Step 4: Add `GEODE_METRICS_URL` to `internal/config/` (or wherever flags live).** Default empty (= disabled).

---

## Task 3: Capabilities flag

**Files:**

- Modify: `internal/server/handlers_capabilities.go`
- Modify: `internal/server/handlers_capabilities_test.go`
- Modify: `src/api/capabilities.ts`

- [ ] **Step 1: Write the failing capabilities test.**

  ```go
  func TestCapabilities_MetricsEnabledFlag(t *testing.T) {
    cfg := &serverConfig{ MetricsURL: "http://geode:9090/metrics" }
    s := newStubServerWithConfig(t, cfg)
    caps, err := s.Capabilities(httptest.NewRecorder(), httptest.NewRequest("GET","/api/v1/capabilities",nil), &gentypes.Empty{})
    if err != nil { t.Fatal(err) }
    if !caps.MetricsEnabled { t.Fatal("want metrics_enabled=true") }
  }
  ```

- [ ] **Step 2: Add `MetricsEnabled bool` to the `Capabilities` payload in `genapi.json`; regenerate.**

- [ ] **Step 3: Wire `Capabilities.MetricsEnabled = (s.cfg.MetricsURL != "")` in the handler.**

- [ ] **Step 4: Surface the field on the SPA side (`src/api/capabilities.ts`).**

---

## Task 4: SPA polling hook

**Files:**

- Create: `src/lib/useMetricsPolling.ts`
- Test: `src/lib/useMetricsPolling.test.ts`

- [ ] **Step 1: Write the failing test.**

  Pattern mirrors `useApiResource` callers: fake the `client.metrics()` mock, advance jest timers, assert a 5s cadence + ring growth + abort cleanup.

- [ ] **Step 2: Implement the hook.**

  Surface:

  ```ts
  type MetricsSample = { ts: number; snapshot: MetricsSnapshot }
  export function useMetricsPolling(opts?: { intervalMs?: number; historyMs?: number }): {
    latest: MetricsSnapshot | null
    history: MetricsSample[]   // bounded by historyMs (default 5 min)
    error: string | null
    loading: boolean
  }
  ```

  - 5 s poll (gated on `document.visibilityState === 'visible'`).
  - Ring buffer of samples for spark/area charts.
  - Abort on unmount + abort previous in-flight on next tick (steal `useApiResource` semantics).

---

## Task 5: Add recharts dep

- [ ] **Step 1:** `npm install recharts@^2.13`.
- [ ] **Step 2:** Confirm the production bundle size delta is < 100 KB gzipped. If it overshoots, switch to per-chart imports (`recharts/es6/chart/LineChart` etc.).
- [ ] **Step 3:** Verify `recharts` works under React 18 strict mode (the lib has a couple of known footguns with concurrent rendering; we test in `MetricsCard.test.tsx`).

---

## Task 6: `MetricsCard` shell + individual cards

**Files:** see File Structure for the full list.

For each card:

- [ ] **Step 1: Write the failing test** using fixture snapshots/history.
- [ ] **Step 2: Implement the card** (declarative recharts panel + numeric chip).
- [ ] **Step 3: Theme** via Bootstrap CSS vars + `theme.bg.subtle` so dark mode lands right out of the box (the project already wires `data-bs-theme`).

Notes on chart choice:

| Card | Chart | Data source |
|---|---|---|
| `QueryThroughputCard` | Line: QPS over time; Bars: latency percentiles | `geode_queries_total` derivative + `geode_query_duration_seconds` buckets |
| `ConnectionsCard` | Gauge + sparkline | `geode_connections_active` (gauge) + history |
| `StorageCard` | Numeric only (no chart) | `geode_nodes_total`, `geode_edges_total`, `geode_memory_bytes` |
| `AuditEventMixCard` | Donut | `/api/v1/audit` entries grouped by `event` (client-side) |

The percentile derivation is the standard linear-interpolation across histogram buckets — implement once in `src/lib/histogramPercentile.ts` with its own unit tests.

---

## Task 7: Wire into `DashboardPage`

**Files:**

- Modify: `src/pages/DashboardPage.tsx`
- Modify: `src/pages/DashboardPage.test.tsx`

- [ ] **Step 1: Write the failing tests.**
  - When `capabilities.metricsEnabled === true`, the four metric cards (`dashboard-metrics-throughput`, `dashboard-metrics-connections`, `dashboard-metrics-storage`, `dashboard-metrics-audit-mix`) render.
  - When `capabilities.metricsEnabled === false`, none of those cards render.

- [ ] **Step 2: Implement the gate** behind the capability — same pattern as the existing `adminWritable` gating.

---

## Task 8: Compose change for the e2e container

**Files:**

- Modify: `deploy/docker-compose.test.yml`
- Modify: `deploy/geode/geode-entrypoint.sh` (only if the entrypoint needs to read GEODE_METRICS_PORT)

- [ ] **Step 1:** Add to the `geode` service:

  ```yaml
  environment:
    GEODE_METRICS_PORT: "9090"
  ports:
    - "9090:9090/tcp"
  ```

- [ ] **Step 2:** Add to the `geode-ui` service:

  ```yaml
  environment:
    GEODE_METRICS_URL: "http://geode:9090/metrics"
  ```

- [ ] **Step 3:** Add a `healthcheck` against `geode`'s metrics port so dependent services don't start until `/metrics` answers 200.

---

## Task 9: e2e spec

**Files:**

- Create: `e2e/specs/22-dashboard-metrics.spec.ts`

- [ ] **Step 1: Write the failing spec.**

  Shape:

  ```ts
  test('dashboard renders geode metrics when the metrics listener is enabled', async ({ page }) => {
    await loginAsAdmin(page)
    // Drive at least one query so `geode_queries_total` advances.
    await page.goto('/query')
    await runQuery(page, 'MATCH (n) RETURN count(n)')
    await page.goto('/dashboard')

    // Throughput card renders a chart element.
    await expect(page.getByTestId('dashboard-metrics-throughput')).toBeVisible()
    await expect(page.locator('[data-testid="dashboard-metrics-throughput"] svg')).toBeVisible()

    // The "queries total" numeric chip is non-zero (we ran at least one query).
    const total = await page.locator('[data-testid="metrics-queries-total"]').textContent()
    expect(Number(total)).toBeGreaterThan(0)

    // Audit event mix donut renders at least one slice.
    await expect(page.locator('[data-testid="dashboard-metrics-audit-mix"] svg path')).not.toHaveCount(0)
  })
  ```

- [ ] **Step 2: Add to the e2e CI workflow.**
  Confirm `make e2e-up` runs cleanly with the new compose changes.

---

## Task 10: Documentation

- [ ] **Step 1:** Update `docs/OPERATIONS.md` with a "Metrics" section: how to enable, what each card shows, troubleshooting the `503 METRICS_DISABLED` path.
- [ ] **Step 2:** Update `docs/ARCHITECTURE.md` with the proxy + parser path.

---

## Risks & open questions

1. **Recharts bundle size.** First-party measurement before merging — if it exceeds 100 KB gzipped we switch to per-chart imports or fall back to stdlib SVG primitives.
2. **Histogram resolution.** geode's `geode_query_duration_seconds` may have very wide buckets (1ms / 10ms / 100ms / 1s / +Inf). p99 estimation degrades fast at wide bucket boundaries — call this out in the card with an "approximate" badge.
3. **Capability flag vs runtime probe.** A misconfigured `GEODE_METRICS_URL` (DNS resolves but server is down) returns 5xx, not a capability-off state. The card needs an explicit error state, not just a render-or-hide gate.
4. **`access_token_query` audit row spam.** The audit mix donut will be dominated by `access_token_query` if any client uses query-param tokens. Consider filtering it client-side OR adding a "system events" subgroup.
5. **OTel resource attributes.** Out of scope for v1 but we should NOT clobber the prom names — the OTel exporter prefixes / dot-converts ("geode.queries.total" vs `geode_queries_total`). Stick to underscore names in the parser.

---

## Acceptance criteria

- `make e2e-up` brings the stack online with metrics enabled.
- `curl http://localhost:9090/metrics` returns 200 with `geode_*` lines.
- The Dashboard page renders four new cards (`Throughput`, `Connections`, `Storage`, `Audit Mix`) when logged in as admin against the test stack.
- Each card renders a chart (Recharts SVG) AND a numeric chip — `MetricsCard.tsx` provides both.
- `npm test -- --testPathPattern=Metrics` passes.
- `e2e/specs/22-dashboard-metrics.spec.ts` passes against the test stack.
- Production bundle delta is < 100 KB gzipped (measured before merge).
- Capability flag honours: with `GEODE_METRICS_URL` unset, the Dashboard renders zero metrics cards and no client polls are issued.
- No new Geode (Zig) changes — the upstream binary already exposes everything we need.
