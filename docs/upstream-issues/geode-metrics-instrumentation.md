# Upstream bug: Geode metrics instrumentation gap

**Filed:** 2026-05-21 (Bug 3, geode-ui bug-fix bundle)
**Target repo:** Geode (sibling checkout — Zig)
**Target file (likely):** `src/monitoring/metrics_server.zig`
**Severity:** Medium (cosmetic for now; production-blocking once SREs build alerts on these series)
**geode-ui pipeline status:** Healthy — sample / parser / projection / SPA polling are all verified end-to-end and the wire shape matches the parser. **No change required in geode-ui.**

## Symptom

The geode-ui Dashboard's Prometheus-proxy cards (`/api/v1/metrics`) show:

| Family | Reported value |
|---|---|
| `geode_server_uptime` | advances (process wall-time) |
| `geode_server_health{component=server}` | constant `1` |
| `geode_queries_total` | **0** (does not advance even after queries run) |
| `geode_queries_failed_total` | **0** |
| `geode_query_duration_seconds_*` (histogram) | empty (sum=0, count=0, only `+Inf` bucket present) |
| `geode_connections_active` | **0** |
| `geode_connections_total` | **0** |
| `geode_transactions_total` | **0** |
| `geode_transactions_failed_total` | **0** |
| `geode_nodes_total` | **0** |
| `geode_edges_total` | **0** |
| `geode_memory_bytes` | **0** |
| `geode_transport_connection_count{transport=quic}` | **0** |

A live capture saved as `internal/server/testdata/prom-geode-sample.txt` in the geode-ui repo demonstrates the issue: every family is **declared** (HELP / TYPE headers present, body line with value `0`) but **never increments under load**.

## Reproduction

1. Bring up the dev compose stack: `make e2e-up` (geode-ui repo).
2. Log in via `/login` and run a handful of queries on the Query page.
3. Curl the upstream metrics endpoint directly from inside the compose net:
   ```sh
   docker exec -it deploy-geode-1 curl -s http://localhost:9090/metrics
   ```
4. Observe that `geode_queries_total`, `geode_queries_failed_total`, `geode_query_duration_seconds_*`, `geode_connections_*`, and `geode_transactions_*` all remain at `0` despite the SPA having driven traffic through the wire.

If the families came back **non-zero** after step 3, the SPA dashboard would render them correctly (the wire shape is already covered end-to-end by `internal/server/testdata/prom-geode-sample.txt` + `ParseProm` + `projectSnapshot` + `useMetricsPolling`).

## Root cause hypothesis

The Geode metrics emitter declares every family in its exposition output but the corresponding instrumentation hooks are not yet wired in:

- **Query path** (`src/query/*.zig`): `queries_total++` / `queries_failed_total++` / `query_duration_seconds.observe(elapsed)` calls are missing at the query-statement boundary.
- **Connection layer** (`src/transport/quic_server.zig` or similar): `connections_active.set(n)` / `connections_total++` / `transport_connection_count{transport="quic"}.set(n)` calls are missing at QUIC accept / close.
- **Transaction layer** (`src/tx/*.zig`): `transactions_total++` / `transactions_failed_total++` calls are missing at commit/rollback.
- **Storage layer** (`src/storage/*.zig`): `nodes_total.set(graph.node_count())` / `edges_total.set(graph.edge_count())` not fed; almost certainly the storage subsystem already tracks these — needs a gauge emitter at scrape time.
- **Memory** (`src/runtime/allocator.zig`): `memory_bytes.set(arena_bytes())` not fed; `process.statvfs` / `arena.queryCapacity()` likely already available.

The fact that every family has its HELP/TYPE declared suggests the metrics-emitter scaffold landed but the call sites were never wired through. A grep for the family names should find them only in `src/monitoring/metrics_server.zig` (the registration site) and nowhere else.

## Suggested fix (upstream, Geode repo)

For each family, add the matching emission point at the natural code location:

```zig
// src/query/handler.zig — at the end of query_execute()
metrics.geode_queries_total.inc();
if (failed) metrics.geode_queries_failed_total.inc();
metrics.geode_query_duration_seconds.observe(elapsed_seconds);
```

```zig
// src/transport/quic_server.zig — on accept / on close
metrics.geode_connections_total.inc();
metrics.geode_connections_active.set(active_count);
```

```zig
// src/tx/coordinator.zig — at commit / rollback boundaries
metrics.geode_transactions_total.inc();
if (rolled_back) metrics.geode_transactions_failed_total.inc();
```

```zig
// src/monitoring/metrics_server.zig — at scrape time, ahead of write
metrics.geode_nodes_total.set(storage.nodeCount());
metrics.geode_edges_total.set(storage.edgeCount());
metrics.geode_memory_bytes.set(runtime.arenaBytes());
metrics.geode_transport_connection_count.set(transport.activeQuicCount());
```

## Validation plan (after upstream lands)

1. `make e2e-up`, log in to the SPA, run a query.
2. `docker exec deploy-geode-1 curl -s http://localhost:9090/metrics | grep -E '^geode_(queries|connections|transactions|nodes|edges|memory)'` — values should be non-zero and matching the workload.
3. The Dashboard's four metric cards (Query throughput / Connections / Storage / Server health) should reflect the same numbers.
4. The advisory banner the SPA renders when **all counters are zero** (see [SPA hardening](#spa-hardening-already-landed) below) should disappear.

## SPA hardening (already landed)

The geode-ui side ships a small advisory banner alongside this report so the operator's experience is not "the dashboard is broken" but "the upstream emitter is incomplete":

- Detection: every numeric metric is `0` AND uptime > 60s. This avoids firing on a fresh server with no traffic yet.
- Surface: a one-line dismissible banner above the metrics cards linking back to this document.
- Implementation: `src/components/dashboard/MetricsUpstreamAdvisory.tsx`.

The banner is hardcoded to disappear automatically once the upstream emits any non-zero counter, so no follow-up SPA work is required after the Zig-side fix lands.

## Cross-references

- geode-ui sample of the empty-counters exposition: `internal/server/testdata/prom-geode-sample.txt`
- geode-ui parser: `internal/server/promparse.go::ParseProm`
- geode-ui projection: `internal/server/handlers_metrics.go::projectSnapshot`
- geode-ui hook: `src/lib/useMetricsPolling.ts`
- Dashboard 2026-05-21 audit context: `docs/audits/2026-05-21/perf-context.md` (Bug 3 detail under "Suspected hot paths" + "Observability gaps")
- Original audit triage for this bug-fix bundle: `docs/bug-fixes/2026-05-21-dashboard-auth-bundle/triage.md` (§ "Bug 3 — Dashboard metrics don't advance")
