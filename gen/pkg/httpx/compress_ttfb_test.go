package httpx

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// flushingResponseRecorder embeds httptest.ResponseRecorder and
// implements http.Flusher so the bufferedGzipWriter exercise path
// actually exercises Flush(). The default ResponseRecorder does not
// implement Flusher; without this wrapper a Flush() through the gzip
// shim silently drops the call through and the bench reproduces
// nothing.
type flushingResponseRecorder struct {
	*httptest.ResponseRecorder
	flushed int
}

func (f *flushingResponseRecorder) Flush() { f.flushed++ }

func newFlushingRecorder() *flushingResponseRecorder {
	return &flushingResponseRecorder{ResponseRecorder: httptest.NewRecorder()}
}

// TestGzip_TinyHeadFlush_PassthroughPreservesLatency proves the PERF
// #169 acceptance: a streaming handler that flushes a sub-1024-byte
// JSON head (e.g. {"columns":[...],"rows":[) ships that head
// uncompressed AND without paying for the gzip-stream init cost.
//
// Before this fix the Flush() forced commitOnFlush which always
// committed to gzip, paying ~5-10us per request for the init and the
// gzip framing overhead. After: a small-buffer flush commits as
// passthrough; the response never carries Content-Encoding: gzip.
func TestGzip_TinyHeadFlush_PassthroughPreservesLatency(t *testing.T) {
	const head = `{"columns":["a","b","c"],"rows":[`
	h := Gzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, head)
		w.(http.Flusher).Flush()
	}))
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/stream", nil)
	r.Header.Set("Accept-Encoding", "gzip")
	w := newFlushingRecorder()
	h.ServeHTTP(w, r)

	if got := w.Header().Get("Content-Encoding"); got == "gzip" {
		t.Fatalf("tiny TTFB head must not engage gzip; got Content-Encoding=%q\nbody=%q", got, w.Body.String())
	}
	if got := w.Body.String(); got != head {
		t.Fatalf("body altered by gzip shim: got %q, want %q", got, head)
	}
	if w.flushed == 0 {
		t.Fatalf("downstream Flush() was never invoked")
	}
}

// TestGzip_LargeBodyAfterFlush_StillCompresses proves the
// passthrough decision is local to the flush event: if the handler
// flushes a small head and then immediately writes a body that
// crosses the 1024-byte threshold, the small head is already on the
// wire uncompressed and the rest streams uncompressed too. This is
// the documented PERF #169 tradeoff — losing gzip on the body is
// acceptable when the head was tiny because the handler signalled
// "ship now" via Flush.
//
// The alternative (suppress the Flush and engage gzip later) would
// hurt streaming TTFB just as badly as the current always-compress
// behaviour does, so the design picks passthrough.
func TestGzip_LargeBodyAfterFlush_StillUncompressedAfterTinyFlush(t *testing.T) {
	const head = `{"head":1}`              // 10 bytes; well under 1 KiB
	body := strings.Repeat("payload", 500) // ~3.5 KiB body
	h := Gzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, head)
		w.(http.Flusher).Flush()
		_, _ = io.WriteString(w, body)
	}))
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/stream", nil)
	r.Header.Set("Accept-Encoding", "gzip")
	w := newFlushingRecorder()
	h.ServeHTTP(w, r)

	if got := w.Header().Get("Content-Encoding"); got == "gzip" {
		t.Fatalf("after tiny TTFB flush, the stream must remain passthrough; got Content-Encoding=%q", got)
	}
	if !strings.HasPrefix(w.Body.String(), head) {
		t.Fatalf("body did not start with head: %q", w.Body.String())
	}
	if !strings.Contains(w.Body.String(), body) {
		t.Fatalf("body did not contain payload")
	}
}

// TestGzip_NoFlush_LargeBody_StillCompresses proves the non-flush
// happy path is unchanged: a handler that writes >1024 bytes without
// any Flush() compresses as before. PERF #169 only changes the Flush
// path; the bulk-response path is untouched.
func TestGzip_NoFlush_LargeBody_StillCompresses(t *testing.T) {
	payload := strings.Repeat("compressible-row,", 100) // ~1.6 KiB
	h := Gzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, payload)
	}))
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/bulk", nil)
	r.Header.Set("Accept-Encoding", "gzip")
	w := newFlushingRecorder()
	h.ServeHTTP(w, r)

	if got := w.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("large-body response should compress; got Content-Encoding=%q", got)
	}
	gz, err := gzip.NewReader(bytes.NewReader(w.Body.Bytes()))
	if err != nil {
		t.Fatalf("gzip.NewReader: %v", err)
	}
	dec, err := io.ReadAll(gz)
	if err != nil {
		t.Fatalf("read gzip body: %v", err)
	}
	if string(dec) != payload {
		t.Fatalf("decompressed body mismatch")
	}
}

// TestGzip_LargeBufferFlush_CompressesFromCommit proves the size
// boundary: a flush issued AFTER the buffer has accumulated 1024+
// bytes triggers gzip immediately (existing behaviour preserved).
// The TTFB passthrough is gated on the small-buffer condition.
func TestGzip_LargeBufferFlush_CompressesFromCommit(t *testing.T) {
	bigHead := strings.Repeat("X", gzipMinBytes+10) // > 1 KiB
	h := Gzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, bigHead)
		w.(http.Flusher).Flush()
	}))
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x", nil)
	r.Header.Set("Accept-Encoding", "gzip")
	w := newFlushingRecorder()
	h.ServeHTTP(w, r)

	if got := w.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("flush after big buffer must compress; got Content-Encoding=%q", got)
	}
}

// BenchmarkCompressStream_SmallHeadLargeBody measures the TTFB
// scenario before and after PERF #169: a 100-byte head flushed
// immediately, then a 16 KiB body. Pre-fix the gzip init + framing
// dominates the head latency; post-fix the head ships passthrough.
func BenchmarkCompressStream_SmallHeadLargeBody(b *testing.B) {
	const head = `{"columns":["a","b"],"rows":[`     // 30 bytes
	body := bytes.Repeat([]byte("0123456789"), 1600) // 16 KiB

	h := Gzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, head)
		w.(http.Flusher).Flush()
		_, _ = w.Write(body)
	}))
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/bench", nil)
	r.Header.Set("Accept-Encoding", "gzip")

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w := newFlushingRecorder()
		h.ServeHTTP(w, r)
	}
}
