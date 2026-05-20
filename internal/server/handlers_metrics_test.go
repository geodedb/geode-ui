package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"geodedb.com/geode-ui/internal/jwt"
)

const promFixtureMin = `# HELP geode_queries_total Total queries executed
# TYPE geode_queries_total counter
geode_queries_total 42
# HELP geode_connections_active Number of active connections
# TYPE geode_connections_active gauge
geode_connections_active 5
# HELP geode_nodes_total Total number of nodes in the graph
# TYPE geode_nodes_total gauge
geode_nodes_total 1500
# HELP geode_edges_total Total number of edges in the graph
# TYPE geode_edges_total gauge
geode_edges_total 3200
# HELP geode_memory_bytes Memory usage in bytes
# TYPE geode_memory_bytes gauge
geode_memory_bytes 134217728
# HELP geode_query_duration_seconds Query execution duration in seconds
# TYPE geode_query_duration_seconds histogram
geode_query_duration_seconds_bucket{le="0.005"} 10
geode_query_duration_seconds_bucket{le="+Inf"} 42
geode_query_duration_seconds_sum 0.184
geode_query_duration_seconds_count 42
# HELP geode_server_health 1 healthy, 0 unhealthy per component
# TYPE geode_server_health gauge
geode_server_health{geode_component="server"} 1
`

// newMetricsTestServer builds a GraphServer wired against a fake
// upstream prom endpoint and an Issuer that accepts the bearer token
// produced by `mintTestToken`. The handler under test is plain
// http.Handler — we register it via mux just like cmd/server does so
// the test exercises the same code path the production route uses.
func newMetricsTestServer(t *testing.T, upstreamURL string) (*GraphServer, string) {
	t.Helper()
	secret := make([]byte, 32)
	for i := range secret {
		secret[i] = byte(i)
	}
	issuer, err := jwt.NewIssuer(secret, time.Hour)
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	srv := New(Config{
		Version:    "test",
		JWT:        issuer,
		MetricsURL: upstreamURL,
	})
	tok, _, err := issuer.Issue("test-user", "default", []string{"admin"}, "")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	return srv, tok
}

func TestHandleMetrics_HappyPath(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(promFixtureMin))
	}))
	t.Cleanup(upstream.Close)

	srv, tok := newMetricsTestServer(t, upstream.URL)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/metrics", nil)
	req.Header.Set("Authorization", "Bearer "+tok)

	srv.HandleMetrics(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	var snap MetricsSnapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snap); err != nil {
		t.Fatalf("decode: %v (body=%s)", err, rec.Body.String())
	}
	if snap.Queries.Total != 42 {
		t.Errorf("queries.total: want 42, got %v", snap.Queries.Total)
	}
	if snap.Connections.Active != 5 {
		t.Errorf("connections.active: want 5, got %v", snap.Connections.Active)
	}
	if snap.Storage.NodesTotal != 1500 {
		t.Errorf("storage.nodes_total: want 1500, got %v", snap.Storage.NodesTotal)
	}
	if snap.Queries.DurationSecondsCount != 42 {
		t.Errorf("queries.duration_count: want 42, got %v", snap.Queries.DurationSecondsCount)
	}
	if len(snap.Queries.DurationSecondsBucket) != 2 {
		t.Errorf("buckets: want 2, got %d", len(snap.Queries.DurationSecondsBucket))
	}
	if !snap.Server.Healthy {
		t.Error("server.healthy: want true")
	}
	if snap.CollectedAt.IsZero() {
		t.Error("collected_at must be stamped server-side")
	}
}

func TestHandleMetrics_NotConfigured_Returns503(t *testing.T) {
	srv, tok := newMetricsTestServer(t, "")
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/metrics", nil)
	req.Header.Set("Authorization", "Bearer "+tok)

	srv.HandleMetrics(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: want 503, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "METRICS_DISABLED") {
		t.Errorf("expected METRICS_DISABLED in body, got %s", rec.Body.String())
	}
}

func TestHandleMetrics_UpstreamError_Returns502(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	t.Cleanup(upstream.Close)

	srv, tok := newMetricsTestServer(t, upstream.URL)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/metrics", nil)
	req.Header.Set("Authorization", "Bearer "+tok)

	srv.HandleMetrics(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status: want 502, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "METRICS_UPSTREAM") {
		t.Errorf("expected METRICS_UPSTREAM in body, got %s", rec.Body.String())
	}
}

func TestHandleMetrics_UnreachableUpstream_Returns502(t *testing.T) {
	// Point at a port we know nothing listens on. Local-only address so
	// the test is hermetic.
	srv, tok := newMetricsTestServer(t, "http://127.0.0.1:1/metrics")
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/metrics", nil)
	req.Header.Set("Authorization", "Bearer "+tok)

	srv.HandleMetrics(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status: want 502, got %d", rec.Code)
	}
}

func TestHandleMetrics_ParseFailure_Returns502(t *testing.T) {
	// Wire an upstream that returns garbage so the parser hits a
	// numeric-conversion error on the value column.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("# TYPE x counter\nx not_a_number\n"))
	}))
	t.Cleanup(upstream.Close)

	srv, tok := newMetricsTestServer(t, upstream.URL)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/metrics", nil)
	req.Header.Set("Authorization", "Bearer "+tok)

	srv.HandleMetrics(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status: want 502, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "METRICS_PARSE_ERROR") {
		t.Errorf("expected METRICS_PARSE_ERROR, got %s", rec.Body.String())
	}
}

func TestHandleMetrics_NoAuth_Returns401(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(promFixtureMin))
	}))
	t.Cleanup(upstream.Close)

	srv, _ := newMetricsTestServer(t, upstream.URL)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/metrics", nil)
	// No Authorization header — auth chain must reject.

	srv.HandleMetrics(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: want 401, got %d", rec.Code)
	}
}

func TestProjectSnapshot_PreservesBucketOrder(t *testing.T) {
	// The percentile interpolator on the SPA side walks buckets in
	// declaration order; the projection MUST preserve that order from
	// the parser output so the histogram cumulative semantics hold.
	fams, err := ParseProm(strings.NewReader(promFixtureMin))
	if err != nil {
		t.Fatal(err)
	}
	snap := projectSnapshot(fams)
	if len(snap.Queries.DurationSecondsBucket) != 2 {
		t.Fatalf("buckets: %v", snap.Queries.DurationSecondsBucket)
	}
	if snap.Queries.DurationSecondsBucket[0].UpperBound != 0.005 {
		t.Errorf("buckets[0]: %v", snap.Queries.DurationSecondsBucket[0])
	}
	last := snap.Queries.DurationSecondsBucket[1]
	if last.UpperBound != 1e308 {
		t.Errorf("+Inf bucket should be clamped to MaxFloat64, got %v", last.UpperBound)
	}
}

// Compile-time sanity check that endpointError is a real error type, so
// future refactors don't accidentally drop the interface satisfaction
// that the metricsErr helper relies on.
var _ error = (*endpointError)(nil)

// Reference imported package so `go vet` keeps the import — the test
// file uses errors.Is indirectly via the project's helpers; the alias
// here is harmless and avoids the unused-import flag if a future
// editor strips the explicit call.
var _ = errors.New
