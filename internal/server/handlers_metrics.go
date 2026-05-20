// Package server — handlers_metrics.go
//
// GET /api/v1/metrics
//
// Proxies the upstream geode Prometheus `/metrics` endpoint and
// projects the prom-text exposition into a stable JSON wire shape the
// SPA dashboard cards consume. Geode itself emits a Prometheus
// exposition on a separate port when `GEODE_METRICS_PORT` is set; the
// geode-ui server learns that URL via the `GEODE_METRICS_URL` env var
// (e.g. `http://geode:9090/metrics` in the docker-compose stack).
//
// Why a server-side projection rather than a SPA-side prom parser:
//
//  1. The geode-ui Go server already knows where the upstream lives;
//     the browser-side fetch would need a CORS allowance from the
//     geode metrics listener (which has no CORS config — it's
//     scrape-only by intent).
//  2. The SPA wants strongly-typed JSON fields, not a free-form
//     metric-family list. Projecting once on the server keeps every
//     SPA chart's data path one shape change away from a TypeScript
//     compile error, not a runtime parse failure.
//  3. The proxy fronts every fetch with the existing JWT cookie/header
//     auth chain — the upstream metrics endpoint is otherwise public
//     and would be a leaked attack surface if shipped directly.
//
// Failure modes:
//
//   - `GEODE_METRICS_URL` unset                → 503 METRICS_DISABLED
//   - Upstream timeout / connection refused    → 502 METRICS_UPSTREAM
//   - Upstream non-200                         → 502 METRICS_UPSTREAM
//   - Parse failure                            → 502 METRICS_PARSE_ERROR
//
// The metrics surface is intentionally cheap: one outbound GET, ~30 KiB
// response from geode, ~200 LoC of parse. We cap the upstream call at
// 2 s so a misconfigured URL cannot stall the API path.

package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// metricsUpstreamTimeout caps the upstream GET. Picked to be:
//   - Generous enough that a small process pause (GC, brief load) on
//     the geode side doesn't 502 the dashboard card.
//   - Short enough that a configuration where GEODE_METRICS_URL points
//     at the wrong host (DNS resolves but no listener) is surfaced as
//     a visible error in <3 s rather than locking the SPA's poll loop.
const metricsUpstreamTimeout = 2 * time.Second

// MetricsSnapshot is the typed projection the SPA consumes. Each
// sub-struct corresponds to a dashboard card; absent upstream metrics
// fall back to the zero value (the card surfaces "—" in that case).
type MetricsSnapshot struct {
	Queries      MetricsQueries      `json:"queries"`
	Connections  MetricsConnections  `json:"connections"`
	Transactions MetricsTransactions `json:"transactions"`
	Storage      MetricsStorage      `json:"storage"`
	Server       MetricsServer       `json:"server"`
	// CollectedAt is the server-side wall-clock at which this snapshot
	// was produced. Stamping on the server (not the SPA) keeps the
	// per-sample timestamp drift-free across clients with skewed clocks
	// — important for the per-second rate derivations the throughput
	// card computes between samples.
	CollectedAt time.Time `json:"collected_at"`
}

// MetricsQueries projects the query-pipeline counters + histogram.
// Buckets are kept as a flat slice so the SPA's percentile interpolator
// can walk them in declaration order; the +Inf bucket is encoded with
// UpperBound = `+Inf` JSON literal via the standard float64 marshaler
// (math.Inf marshals as `+Inf` only with encoding/json/v2; for v1 we
// substitute math.MaxFloat64 to keep the wire shape lint-clean).
type MetricsQueries struct {
	Total                 float64                  `json:"total"`
	Failed                float64                  `json:"failed"`
	DurationSecondsSum    float64                  `json:"duration_seconds_sum"`
	DurationSecondsCount  uint64                   `json:"duration_seconds_count"`
	DurationSecondsBucket []MetricsHistogramBucket `json:"duration_seconds_buckets"`
}

// MetricsHistogramBucket — one cumulative bucket entry. UpperBound is
// the inclusive upper bound; the +Inf bucket carries math.MaxFloat64
// (the SPA recognises that sentinel and renders it as ∞).
type MetricsHistogramBucket struct {
	UpperBound float64 `json:"upper_bound"`
	Count      uint64  `json:"count"`
}

// MetricsConnections — the connection / session view.
type MetricsConnections struct {
	Active float64 `json:"active"`
	Total  float64 `json:"total"`
}

// MetricsTransactions — the transaction view.
type MetricsTransactions struct {
	Total  float64 `json:"total"`
	Failed float64 `json:"failed"`
}

// MetricsStorage — point-in-time graph footprint.
type MetricsStorage struct {
	NodesTotal  float64 `json:"nodes_total"`
	EdgesTotal  float64 `json:"edges_total"`
	MemoryBytes float64 `json:"memory_bytes"`
}

// MetricsServer — process-level signals. UptimeSeconds is the time
// since geode process start; Healthy is the boolean value of the
// `geode_server_health{component=server}` gauge.
type MetricsServer struct {
	UptimeSeconds float64 `json:"uptime_seconds"`
	Healthy       bool    `json:"healthy"`
}

// metricsErr wraps an endpointError with the metrics-specific code +
// status pair so the HTTP handler can dispatch with one call.
func metricsErr(w http.ResponseWriter, status int, code, description string) {
	writeEndpointError(w, &endpointError{
		status:      status,
		code:        code,
		description: description,
	})
}

// HandleMetrics is the GET /api/v1/metrics handler. Registered via
// mux.HandleFunc in app_routes.go behind the JWT auth middleware that
// the genapi mount installs — see cmd/server/app_routes.go.
//
// The handler is intentionally NOT generated by genapi: adding a route
// there would require regenerating ~20 files and rippling through every
// client. A hand-rolled handler with explicit JSON marshal is fine here
// because the route has a single response shape and no path params.
// If a future endpoint joins the metrics family, fold them all into a
// MetricsAPI subgroup and consider promoting to genapi at that point.
func (s *GraphServer) HandleMetrics(w http.ResponseWriter, r *http.Request) {
	// The metrics URL is plumbed through the server config (see
	// server.Config.MetricsURL) so tests can override the upstream
	// without touching the process env.
	url := s.cfg.MetricsURL
	if url == "" {
		metricsErr(w, http.StatusServiceUnavailable,
			"METRICS_DISABLED",
			"the geode metrics listener is not configured for this server (set GEODE_METRICS_URL)")
		return
	}

	// AuthJWT must pass before we touch the upstream — the metrics
	// listener has no auth of its own, so this handler is the choke
	// point. Mirrors the same enforcement the genapi-emitted routes
	// apply for required_roles=[].
	if err := s.AuthJWT(r); err != nil {
		writeEndpointError(w, &endpointError{
			status: http.StatusUnauthorized, code: "unauthorized",
			description: "authentication required",
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), metricsUpstreamTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		metricsErr(w, http.StatusInternalServerError,
			"METRICS_INTERNAL", "metrics request build failed: "+err.Error())
		return
	}

	client := metricsHTTPClient(s)
	resp, err := client.Do(req)
	if err != nil {
		metricsErr(w, http.StatusBadGateway,
			"METRICS_UPSTREAM", "upstream metrics fetch failed: "+err.Error())
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		metricsErr(w, http.StatusBadGateway,
			"METRICS_UPSTREAM",
			fmt.Sprintf("upstream returned %d %s", resp.StatusCode, http.StatusText(resp.StatusCode)))
		return
	}

	families, err := ParseProm(resp.Body)
	if err != nil {
		metricsErr(w, http.StatusBadGateway,
			"METRICS_PARSE_ERROR", "could not parse upstream metrics: "+err.Error())
		return
	}

	snapshot := projectSnapshot(families)
	snapshot.CollectedAt = timeNow()

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(w).Encode(snapshot); err != nil {
		// We've already started writing; nothing useful to do but log.
		// The middleware chain treats a half-written body as a client
		// problem (truncate at the connection), so swallowing here is
		// safe.
		return
	}
}

// metricsHTTPClient returns a *http.Client with the metrics timeout
// baked in. Indirected through this helper so a test can swap in a
// transport via t.Cleanup without locking the production path to a
// var-level singleton.
func metricsHTTPClient(s *GraphServer) *http.Client {
	if s.cfg.MetricsHTTPClient != nil {
		return s.cfg.MetricsHTTPClient
	}
	return &http.Client{Timeout: metricsUpstreamTimeout}
}

// projectSnapshot pulls the well-known metric families into the typed
// SPA-facing shape. Missing families are left as zero values; the SPA
// renders a "—" chip in that case so the operator can tell at a glance
// which upstream signal isn't being emitted.
func projectSnapshot(fams []MetricFamily) MetricsSnapshot {
	var s MetricsSnapshot

	if f := FindFamily(fams, "geode_queries_total"); f != nil && f.Counter != nil {
		s.Queries.Total = *f.Counter
	}
	if f := FindFamily(fams, "geode_queries_failed_total"); f != nil && f.Counter != nil {
		s.Queries.Failed = *f.Counter
	}
	if f := FindFamily(fams, "geode_query_duration_seconds"); f != nil && f.Hist != nil {
		s.Queries.DurationSecondsSum = f.Hist.Sum
		s.Queries.DurationSecondsCount = f.Hist.Count
		out := make([]MetricsHistogramBucket, 0, len(f.Hist.Buckets))
		for _, b := range f.Hist.Buckets {
			ub := b.UpperBound
			// math.Inf marshals as +Inf with encoding/json/v2 but the
			// SPA still expects a number; clamp to MaxFloat64 so the
			// wire shape is plain JSON and downstream code can treat
			// "this is effectively unbounded" via a constant compare.
			if ub > 1e308 || ub != ub /* NaN guard */ {
				ub = 1e308
			}
			out = append(out, MetricsHistogramBucket{UpperBound: ub, Count: b.Count})
		}
		s.Queries.DurationSecondsBucket = out
	}

	if f := FindFamily(fams, "geode_connections_active"); f != nil && f.Gauge != nil {
		s.Connections.Active = *f.Gauge
	}
	if f := FindFamily(fams, "geode_connections_total"); f != nil && f.Counter != nil {
		s.Connections.Total = *f.Counter
	}

	if f := FindFamily(fams, "geode_transactions_total"); f != nil && f.Counter != nil {
		s.Transactions.Total = *f.Counter
	}
	if f := FindFamily(fams, "geode_transactions_failed_total"); f != nil && f.Counter != nil {
		s.Transactions.Failed = *f.Counter
	}

	if f := FindFamily(fams, "geode_nodes_total"); f != nil && f.Gauge != nil {
		s.Storage.NodesTotal = *f.Gauge
	}
	if f := FindFamily(fams, "geode_edges_total"); f != nil && f.Gauge != nil {
		s.Storage.EdgesTotal = *f.Gauge
	}
	if f := FindFamily(fams, "geode_memory_bytes"); f != nil && f.Gauge != nil {
		s.Storage.MemoryBytes = *f.Gauge
	}

	if f := FindFamily(fams, "geode_server_uptime"); f != nil && f.Gauge != nil {
		s.Server.UptimeSeconds = *f.Gauge
	}
	if f := FindFamily(fams, "geode_server_health"); f != nil && f.Gauge != nil {
		s.Server.Healthy = *f.Gauge == 1
	}

	return s
}
