package httpx

import (
	"bufio"
	"compress/gzip"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
)

// gzipMinBytes is the smallest response body we bother compressing. Below
// this the gzip framing overhead (and the CPU cost) is not worth it; tiny
// JSON error envelopes and empty 204s fall through uncompressed.
const gzipMinBytes = 1 << 10 // 1 KiB

// gzipWriterPool recycles *gzip.Writer instances at BestSpeed so the steady
// state allocates no compressors per request. Writers are Reset onto the
// destination ResponseWriter before use and Closed (which flushes the gzip
// trailer) when the wrapped handler returns.
var gzipWriterPool = sync.Pool{
	New: func() any {
		w, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
		return w
	},
}

// gzipWrapperPool recycles gzipResponseWriter wrappers so the steady
// state allocates 0 wrapper structs per request. Each Get() returns a
// zero-initialised wrapper bound to the destination ResponseWriter via
// Reset(); Put() (called from close) resets all fields and detaches
// the underlying writer so the pool entry holds no reference to the
// previous request's body. PERF #163.
var gzipWrapperPool = sync.Pool{
	New: func() any {
		// Pre-allocate the buffer at gzipMinBytes so the buffered
		// pre-decision path never grows beyond the threshold on the
		// happy path. Larger bodies trigger a single grow at the
		// commit boundary.
		return &gzipResponseWriter{buf: make([]byte, 0, gzipMinBytes)}
	},
}

// getGzipResponseWriter takes a wrapper out of the pool and binds it
// to rw. Mirrors the *gzip.Writer Get/Reset/Put pattern that
// gzipWriterPool already uses. PERF #163.
func getGzipResponseWriter(rw http.ResponseWriter) *gzipResponseWriter {
	g := gzipWrapperPool.Get().(*gzipResponseWriter)
	g.ResponseWriter = rw
	g.status = 0
	g.wroteHeader = false
	g.decided = false
	g.gz = nil
	g.buf = g.buf[:0]
	return g
}

// putGzipResponseWriter returns g to the pool after detaching every
// reference that could outlive the request. PERF #163.
func putGzipResponseWriter(g *gzipResponseWriter) {
	if g == nil {
		return
	}
	// Drop references so the next request does not see stale state and
	// the GC can reclaim large buffers the wrapper may have grown.
	g.ResponseWriter = nil
	g.gz = nil
	// Cap the retained buffer at 64 KiB to avoid pinning oversize
	// allocations in the pool when an outlier handler wrote a giant
	// body that exceeded the gzipMinBytes pre-allocation.
	const maxRetainedBuf = 64 << 10
	if cap(g.buf) > maxRetainedBuf {
		g.buf = make([]byte, 0, gzipMinBytes)
	} else {
		g.buf = g.buf[:0]
	}
	g.status = 0
	g.wroteHeader = false
	g.decided = false
	gzipWrapperPool.Put(g)
}

// compressibleType reports whether a Content-Type names a payload that gzip
// can usefully shrink. JSON, text/*, JS, CSS, SVG, and XML compress well;
// images/video/audio and anything already content-encoded do not.
func compressibleType(ct string) bool {
	if ct == "" {
		// No declared type: the generated handlers always set
		// application/json before writing a body, so an empty type means
		// either a 204 or a hand-rolled writer. Be conservative: skip.
		return false
	}
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = ct[:i]
	}
	ct = strings.TrimSpace(strings.ToLower(ct))
	switch {
	case strings.HasPrefix(ct, "text/"):
		return true
	case ct == "application/json",
		ct == "application/javascript",
		ct == "application/xml",
		ct == "image/svg+xml":
		return true
	case strings.HasSuffix(ct, "+json"), strings.HasSuffix(ct, "+xml"):
		return true
	default:
		return false
	}
}

func clientAcceptsGzip(r *http.Request) bool {
	for _, enc := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		token := strings.TrimSpace(enc)
		if i := strings.IndexByte(token, ';'); i >= 0 {
			token = strings.TrimSpace(token[:i])
		}
		if strings.EqualFold(token, "gzip") {
			return true
		}
	}
	return false
}

// gzipResponseWriter buffers the head of the response so it can decide --
// once it knows the Content-Type and at least gzipMinBytes of body, or the
// handler returns -- whether to compress. Small responses and
// non-compressible types pass through verbatim with their original headers.
type gzipResponseWriter struct {
	http.ResponseWriter

	status      int
	wroteHeader bool // WriteHeader sent downstream (compressed or not)
	decided     bool // we have committed to gzip or pass-through
	gz          *gzip.Writer
	buf         []byte // pre-decision buffer
}

func (g *gzipResponseWriter) WriteHeader(code int) {
	if g.wroteHeader || g.decided {
		// Decision already made; honor it.
		if !g.wroteHeader {
			g.status = code
			g.ResponseWriter.WriteHeader(code)
			g.wroteHeader = true
		}
		return
	}
	g.status = code
	// 1xx/204/304 never carry a body; emit immediately, no buffering.
	if code < 200 || code == http.StatusNoContent || code == http.StatusNotModified {
		g.decided = true
		g.ResponseWriter.WriteHeader(code)
		g.wroteHeader = true
	}
	// Otherwise defer: the body bytes that follow tell us the size, and
	// Content-Type is now known.
}

func (g *gzipResponseWriter) shouldCompress() bool {
	h := g.Header()
	if h.Get("Content-Encoding") != "" {
		return false
	}
	if !compressibleType(h.Get("Content-Type")) {
		return false
	}
	return true
}

// commitMode tells commit why it was invoked, which changes the
// small-body handling.
type commitMode int

const (
	// commitOnWrite: more body may follow; only commit once we have
	// enough bytes to be worth compressing.
	commitOnWrite commitMode = iota
	// commitOnFlush: a Flush() arrived; we can no longer wait, so commit
	// now and compress if the type is right (more may still follow).
	commitOnFlush
	// commitOnClose: the handler returned; the buffer is the entire body.
	// If it is below the size floor, pass it through uncompressed.
	commitOnClose
)

// commit makes the gzip-vs-passthrough decision, flushes the pre-decision
// buffer downstream, and (if compressing) installs the pooled gzip.Writer.
//
// PERF #169: a Flush() with a sub-1024-byte buffer commits as PASSTHROUGH,
// not gzip. This is the TTFB optimisation — a streaming handler that
// emits a tiny JSON head (e.g. `{"columns":[...],"rows":[` ~30 bytes)
// and then flushes to push the head to the wire should not pay for the
// gzip-stream init cost (~5-10us). The rest of the response continues
// in passthrough mode; losing gzip on the body is the documented
// tradeoff for TTFB latency. Handlers that want gzip on a streaming
// response should buffer at least 1 KiB before flushing.
//
// A Flush() with a >= 1024-byte buffer still commits to gzip (existing
// behaviour preserved). The non-flush path (bulk responses, no
// streaming) is untouched.
func (g *gzipResponseWriter) commit(mode commitMode) {
	if g.decided {
		return
	}
	switch mode {
	case commitOnWrite, commitOnClose:
		if len(g.buf) < gzipMinBytes {
			if mode == commitOnWrite {
				return // keep buffering
			}
			// commitOnClose with a sub-floor body: pass through.
			g.decided = true
			if g.status == 0 {
				g.status = http.StatusOK
			}
			g.ResponseWriter.WriteHeader(g.status)
			g.wroteHeader = true
			if len(g.buf) > 0 {
				_, _ = g.ResponseWriter.Write(g.buf)
			}
			g.buf = nil
			return
		}
	case commitOnFlush:
		// PERF #169: TTFB passthrough. If the handler flushes with less
		// than gzipMinBytes accumulated, ship the head uncompressed and
		// stay in passthrough mode for the rest of the response. This
		// is the small-head-then-large-body acceptable-loss case
		// documented above.
		if len(g.buf) < gzipMinBytes {
			g.decided = true
			if g.status == 0 {
				g.status = http.StatusOK
			}
			// Still advertise Vary so caches key on Accept-Encoding even
			// when the body went out uncompressed; otherwise a follow-up
			// request that genuinely should have been compressed would
			// be served from the same cache entry.
			g.Header().Add("Vary", "Accept-Encoding")
			g.ResponseWriter.WriteHeader(g.status)
			g.wroteHeader = true
			if len(g.buf) > 0 {
				_, _ = g.ResponseWriter.Write(g.buf)
			}
			g.buf = nil
			return
		}
		// Buffer is >= gzipMinBytes — fall through and commit to gzip
		// exactly as the pre-PERF #169 behaviour did. This preserves
		// gzip on bulk-but-streaming responses.
	}
	g.decided = true
	if g.status == 0 {
		g.status = http.StatusOK
	}
	if g.shouldCompress() {
		h := g.Header()
		h.Set("Content-Encoding", "gzip")
		h.Add("Vary", "Accept-Encoding")
		// Content-Length, if the handler pre-set one, is now wrong.
		h.Del("Content-Length")
		g.ResponseWriter.WriteHeader(g.status)
		g.wroteHeader = true
		gz := gzipWriterPool.Get().(*gzip.Writer)
		gz.Reset(g.ResponseWriter)
		g.gz = gz
		if len(g.buf) > 0 {
			_, _ = g.gz.Write(g.buf)
		}
	} else {
		// Pass through. Still advertise Vary so caches key on it.
		g.Header().Add("Vary", "Accept-Encoding")
		g.ResponseWriter.WriteHeader(g.status)
		g.wroteHeader = true
		if len(g.buf) > 0 {
			_, _ = g.ResponseWriter.Write(g.buf)
		}
	}
	g.buf = nil
}

func (g *gzipResponseWriter) Write(p []byte) (int, error) {
	if g.decided {
		if g.gz != nil {
			return g.gz.Write(p)
		}
		if !g.wroteHeader {
			g.ResponseWriter.WriteHeader(g.statusOr200())
			g.wroteHeader = true
		}
		return g.ResponseWriter.Write(p)
	}
	g.buf = append(g.buf, p...)
	g.commit(commitOnWrite)
	return len(p), nil
}

func (g *gzipResponseWriter) statusOr200() int {
	if g.status == 0 {
		return http.StatusOK
	}
	return g.status
}

// Flush implements http.Flusher so streaming handlers still work; flushing
// forces the gzip decision (we can no longer wait to learn the size).
func (g *gzipResponseWriter) Flush() {
	g.commit(commitOnFlush)
	if g.gz != nil {
		_ = g.gz.Flush()
	}
	if f, ok := g.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (g *gzipResponseWriter) close() {
	g.commit(commitOnClose)
	if g.gz != nil {
		_ = g.gz.Close()
		g.gz.Reset(io.Discard)
		gzipWriterPool.Put(g.gz)
		g.gz = nil
	}
	if !g.wroteHeader {
		g.ResponseWriter.WriteHeader(g.statusOr200())
		g.wroteHeader = true
	}
}

// Hijack implements http.Hijacker so WebSocket upgrades and other
// connection-takeover handlers keep working when the mux is wrapped by
// Gzip. A hijacked connection bypasses compression entirely.
func (g *gzipResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := g.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("httpx: underlying ResponseWriter does not support hijacking")
	}
	g.decided = true // never compress a hijacked connection
	return hj.Hijack()
}

// Gzip wraps next with transparent response compression. It compresses only
// when the client sent Accept-Encoding: gzip, the response Content-Type is
// text-ish (JSON, text/*, JS, CSS, SVG, XML), the body is at least ~1 KiB,
// and the handler did not already set Content-Encoding. A Vary:
// Accept-Encoding header is added on every response that went through the
// compressible path so shared caches key correctly. The gzip writers are
// pooled at BestSpeed; the wrapper struct itself is pooled too (PERF #163)
// so the steady-state allocation per request is 0.
func Gzip(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !clientAcceptsGzip(r) {
			next.ServeHTTP(w, r)
			return
		}
		gw := getGzipResponseWriter(w)
		defer func() {
			gw.close()
			putGzipResponseWriter(gw)
		}()
		next.ServeHTTP(gw, r)
	})
}
