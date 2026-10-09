package server

import (
	"database/sql"
	"database/sql/driver"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// PERF-2026-05-11-01 / F1 (#128): server-side schema-discovery cache.
// These tests exercise the cache hit path, singleflight collapsing,
// TTL expiry, and profile-mutation invalidation.

func labelsDriver() *fakeDriver {
	return &fakeDriver{rows: map[string]fakeResult{
		"RETURN DISTINCT labels(n)": {
			cols: []string{"l"},
			rows: [][]driver.Value{{`["User"]`}, {`["Role"]`}},
		},
	}}
}

func edgeTypesDriver() *fakeDriver {
	return &fakeDriver{rows: map[string]fakeResult{
		"RETURN DISTINCT type(r)": {
			cols: []string{"t"},
			rows: [][]driver.Value{{"HAS_ROLE"}, {"OWNS"}},
		},
	}}
}

func callLabels(t *testing.T, s *GraphServer) []string {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/graphs/default/labels", nil)
	resp, err := s.Labels(rec, req, &gentypes.GraphParam{Graph: "default"})
	if err != nil {
		t.Fatalf("Labels: %v", err)
	}
	return resp.Labels
}

func callEdgeTypes(t *testing.T, s *GraphServer) []string {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/graphs/default/edge-types", nil)
	resp, err := s.EdgeTypes(rec, req, &gentypes.GraphParam{Graph: "default"})
	if err != nil {
		t.Fatalf("EdgeTypes: %v", err)
	}
	return resp.Types
}

func TestSchemaCache_LabelsHitDoesNotQueryDB(t *testing.T) {
	d := labelsDriver()
	s := newStubServer(t, "fake_schema_cache_labels", d)

	got1 := callLabels(t, s)
	if want := []string{"Role", "User"}; !equalStrings(got1, want) {
		t.Fatalf("Labels[1]=%v want %v", got1, want)
	}
	if n := d.queries.Load(); n != 1 {
		t.Fatalf("after first Labels: queries=%d want 1", n)
	}
	// Second call within TTL must be served from cache — no new query.
	got2 := callLabels(t, s)
	if !equalStrings(got1, got2) {
		t.Fatalf("Labels[2]=%v want %v (cache should return same value)", got2, got1)
	}
	if n := d.queries.Load(); n != 1 {
		t.Fatalf("after second Labels: queries=%d want 1 (cache miss leaked to DB)", n)
	}
}

func TestSchemaCache_EdgeTypesHitDoesNotQueryDB(t *testing.T) {
	d := edgeTypesDriver()
	s := newStubServer(t, "fake_schema_cache_edges", d)

	got1 := callEdgeTypes(t, s)
	if want := []string{"HAS_ROLE", "OWNS"}; !equalStrings(got1, want) {
		t.Fatalf("EdgeTypes[1]=%v want %v", got1, want)
	}
	if n := d.queries.Load(); n != 1 {
		t.Fatalf("after first EdgeTypes: queries=%d want 1", n)
	}
	got2 := callEdgeTypes(t, s)
	if !equalStrings(got1, got2) {
		t.Fatalf("EdgeTypes[2]=%v want %v", got2, got1)
	}
	if n := d.queries.Load(); n != 1 {
		t.Fatalf("after second EdgeTypes: queries=%d want 1", n)
	}
}

func TestSchemaCache_ConcurrentMissesCollapse(t *testing.T) {
	// Block the loader until all goroutines have entered, then assert
	// exactly one upstream query was issued (singleflight collapse).
	d := labelsDriver()
	s := newStubServer(t, "fake_schema_cache_singleflight", d)

	const n = 16
	var wg sync.WaitGroup
	start := make(chan struct{})
	wg.Add(n)
	for range n {
		go func() {
			defer wg.Done()
			<-start
			_ = callLabels(t, s)
		}()
	}
	close(start)
	wg.Wait()
	if q := d.queries.Load(); q != 1 {
		t.Fatalf("concurrent misses: queries=%d want 1 (singleflight should collapse)", q)
	}
}

func TestSchemaCache_TTLExpiryReQueries(t *testing.T) {
	d := labelsDriver()
	s := newStubServer(t, "fake_schema_cache_ttl", d)

	// Inject a controllable clock before any cache use.
	now := time.Unix(1_700_000_000, 0)
	cache := s.schemaCacheRef()
	cache.now = func() time.Time { return now }

	_ = callLabels(t, s)
	if q := d.queries.Load(); q != 1 {
		t.Fatalf("after first Labels: queries=%d want 1", q)
	}
	// Still within TTL: cached.
	now = now.Add(schemaCacheTTL - time.Second)
	_ = callLabels(t, s)
	if q := d.queries.Load(); q != 1 {
		t.Fatalf("within TTL: queries=%d want 1", q)
	}
	// Past TTL: must re-query.
	now = now.Add(2 * time.Second)
	_ = callLabels(t, s)
	if q := d.queries.Load(); q != 2 {
		t.Fatalf("after TTL expiry: queries=%d want 2", q)
	}
}

func TestSchemaCache_ProfileMutationInvalidates(t *testing.T) {
	d := labelsDriver()
	s := newStubServer(t, "fake_schema_cache_invalidate", d)

	_ = callLabels(t, s)
	if q := d.queries.Load(); q != 1 {
		t.Fatalf("after first Labels: queries=%d want 1", q)
	}
	// Simulate a profile mutation landing (create/update/delete all call
	// this hook from the profiles CRUD handlers).
	s.invalidateSchemaCache()
	_ = callLabels(t, s)
	if q := d.queries.Load(); q != 2 {
		t.Fatalf("after invalidate: queries=%d want 2 (cache should be cleared)", q)
	}
}

func TestSchemaCache_KeyedByProfileAndGraph(t *testing.T) {
	// Different profiles / graphs / kinds must not share a cache slot.
	cache := newSchemaCache()
	var calls int
	loader := func() ([]string, error) { calls++; return []string{"X"}, nil }

	_, _ = cache.getOrLoad(schemaCacheKey{profile: "a", graph: "g1", kind: schemaCacheKindLabels}, loader)
	_, _ = cache.getOrLoad(schemaCacheKey{profile: "a", graph: "g1", kind: schemaCacheKindLabels}, loader)    // hit
	_, _ = cache.getOrLoad(schemaCacheKey{profile: "b", graph: "g1", kind: schemaCacheKindLabels}, loader)    // miss (profile)
	_, _ = cache.getOrLoad(schemaCacheKey{profile: "a", graph: "g2", kind: schemaCacheKindLabels}, loader)    // miss (graph)
	_, _ = cache.getOrLoad(schemaCacheKey{profile: "a", graph: "g1", kind: schemaCacheKindEdgeTypes}, loader) // miss (kind)
	if calls != 4 {
		t.Fatalf("loader calls=%d want 4 (distinct keys must not collide)", calls)
	}
}

func newSchemaBenchServer(b *testing.B, name string, d *fakeDriver) *GraphServer {
	b.Helper()
	// The testing framework re-invokes a Benchmark function several times
	// with a growing N; registerFakeDriver is a no-op after the first
	// registration, so the *sql.DB returned here may be backed by an
	// earlier *fakeDriver instance. That's fine for measurement (the
	// cache lives on the GraphServer, freshly constructed each call), but
	// it means we can't reliably inspect this call's `d.queries`. Cache
	// hit-rate is asserted by the TestSchemaCache_* unit tests instead.
	registerFakeDriver(name, d)
	db, err := sql.Open(name, "")
	if err != nil {
		b.Fatalf("sql.Open: %v", err)
	}
	b.Cleanup(func() { _ = db.Close() })
	return New(Config{Version: "bench", Pool: &stubPool{db: db}})
}

// BenchmarkLabels measures the steady-state (cache-warm) cost of
// GET /api/v1/graphs/{graph}/labels. The first iteration warms the
// cache; the remaining b.N-1 iterations are served from the in-memory
// TTL cache with no upstream round-trip (PERF-2026-05-11-01 / F1 / #128).
func BenchmarkLabels(b *testing.B) {
	d := labelsDriver()
	s := newSchemaBenchServer(b, "bench_schema_labels", d)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/graphs/default/labels", nil)
	param := &gentypes.GraphParam{Graph: "default"}
	// Warm the cache before timing so the benchmark reflects the hot path.
	rec0 := httptest.NewRecorder()
	if _, err := s.Labels(rec0, req, param); err != nil {
		b.Fatalf("warm Labels: %v", err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		rec := httptest.NewRecorder()
		if _, err := s.Labels(rec, req, param); err != nil {
			b.Fatalf("Labels: %v", err)
		}
	}
}

// BenchmarkEdgeTypes mirrors BenchmarkLabels for the edge-types endpoint.
func BenchmarkEdgeTypes(b *testing.B) {
	d := edgeTypesDriver()
	s := newSchemaBenchServer(b, "bench_schema_edges", d)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/graphs/default/edge-types", nil)
	param := &gentypes.GraphParam{Graph: "default"}
	rec0 := httptest.NewRecorder()
	if _, err := s.EdgeTypes(rec0, req, param); err != nil {
		b.Fatalf("warm EdgeTypes: %v", err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		rec := httptest.NewRecorder()
		if _, err := s.EdgeTypes(rec, req, param); err != nil {
			b.Fatalf("EdgeTypes: %v", err)
		}
	}
}
