package ui

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// BenchmarkEmbedHandler_StaticHit measures the per-request overhead of
// serving an existing static asset from the embedded SPA. PERF-2026-05-
// 13-02 / GAP-022 / PSR-F5 (#103): pre-fix the handler called
// fs.Stat(sub, clean) on every request; this bench pins the post-fix
// allocation-and-time profile after the FileInfo cache lands.
//
// We pick /favicon.ico (small, incompressible, no gzip path) so the
// measurement isolates the Stat-cache effect from the gzip pool.
func BenchmarkEmbedHandler_StaticHit(b *testing.B) {
	h, err := Handler()
	if err != nil {
		b.Fatalf("Handler: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/favicon.ico", nil)
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
	}
}
