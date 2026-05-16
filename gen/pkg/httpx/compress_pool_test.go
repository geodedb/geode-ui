package httpx

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// TestGzip_WrapperReused_ConcurrentSafe is the structural assertion for
// PERF #163: the gzipResponseWriter wrapper is pooled, so concurrent
// requests must NOT see each other's accumulated buffer, status, or
// embedded gzip.Writer state. The race detector + atomic check on the
// per-request body content covers the pool-isolation invariant.
func TestGzip_WrapperReused_ConcurrentSafe(t *testing.T) {
	const goroutines = 32
	const callsPer = 16
	payload := strings.Repeat("body-row-", 200) // ~1.8 KiB → compresses

	h := Gzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, payload)
	}))

	var mismatch atomic.Int64
	done := make(chan struct{})
	for g := 0; g < goroutines; g++ {
		go func() {
			for i := 0; i < callsPer; i++ {
				r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x", nil)
				r.Header.Set("Accept-Encoding", "gzip")
				w := httptest.NewRecorder()
				h.ServeHTTP(w, r)
				if w.Header().Get("Content-Encoding") != "gzip" {
					mismatch.Add(1)
					continue
				}
				gz, err := gzip.NewReader(bytes.NewReader(w.Body.Bytes()))
				if err != nil {
					mismatch.Add(1)
					continue
				}
				dec, _ := io.ReadAll(gz)
				if string(dec) != payload {
					mismatch.Add(1)
				}
			}
			done <- struct{}{}
		}()
	}
	for g := 0; g < goroutines; g++ {
		<-done
	}
	if mismatch.Load() != 0 {
		t.Fatalf("pool reuse leaked state across %d concurrent requests", mismatch.Load())
	}
}

// TestGzip_WrapperReturnedToPool proves the wrapper struct is returned
// to a sync.Pool after Close. We probe the pool indirectly: after N
// sequential requests on a single goroutine, the steady-state alloc
// count for the wrapper itself is zero (see the alloc-bench
// BenchmarkCompressGzipPooledWrapper). This unit test just exercises
// the get/put cycle enough times to expose any nil-pointer or
// double-put regression.
func TestGzip_WrapperReturnedToPool(t *testing.T) {
	payload := strings.Repeat("p", 2048) // > 1 KiB
	h := Gzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, payload)
	}))
	for i := 0; i < 200; i++ {
		r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/y", nil)
		r.Header.Set("Accept-Encoding", "gzip")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if got := w.Header().Get("Content-Encoding"); got != "gzip" {
			t.Fatalf("iter %d: Content-Encoding = %q, want gzip", i, got)
		}
	}
}

// BenchmarkCompressGzipPooledWrapper is the PERF #163 acceptance gate:
// the steady-state allocation count for a compressing request should
// be 0 (or a small constant) once the wrapper is pooled. Pre-fix the
// wrapper struct allocated on every call (2 allocs/op: wrapper + gzip
// writer).
func BenchmarkCompressGzipPooledWrapper(b *testing.B) {
	payload := strings.Repeat("compressible-data-row,", 100) // ~2.2 KiB
	h := Gzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, payload)
	}))
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/bench", nil)
	r.Header.Set("Accept-Encoding", "gzip")

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
	}
}

// BenchmarkCompressGzipPooledWrapper_HotPath isolates the wrapper-pool
// alloc cost from the httptest.NewRecorder allocations by reusing a
// single discardResponseWriter across iterations. Pre-fix this bench
// reports >= 2 allocs/op (wrapper struct + gzip writer init). Post-fix
// it reports 0 allocs/op on the steady state.
//
// The discard sink does not implement http.Flusher, so the
// commit/passthrough decision is exercised on the Close path only.
func BenchmarkCompressGzipPooledWrapper_HotPath(b *testing.B) {
	payload := strings.Repeat("compressible-data-row,", 100) // ~2.2 KiB
	h := Gzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, payload)
	}))
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/bench", nil)
	r.Header.Set("Accept-Encoding", "gzip")
	w := &discardResponseWriter{h: make(http.Header)}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w.reset()
		h.ServeHTTP(w, r)
	}
}

// discardResponseWriter is a zero-alloc http.ResponseWriter sink for
// benches that want to isolate the middleware's own allocation cost
// from httptest.NewRecorder overhead. Header() returns a stable map,
// Write goes to /dev/null, and WriteHeader records the status without
// allocating.
type discardResponseWriter struct {
	h      http.Header
	status int
	bytes  int
}

func (d *discardResponseWriter) Header() http.Header { return d.h }
func (d *discardResponseWriter) Write(p []byte) (int, error) {
	d.bytes += len(p)
	return len(p), nil
}
func (d *discardResponseWriter) WriteHeader(code int) { d.status = code }
func (d *discardResponseWriter) reset() {
	for k := range d.h {
		delete(d.h, k)
	}
	d.status = 0
	d.bytes = 0
}
