package obsx

import (
	"bufio"
	"context"
	"encoding/json/v2"
	"expvar"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

var (
	reqCounter uint64

	// AppName is the application name included in logs.
	AppName string
	// AppVersion is the application version included in logs.
	AppVersion string
)

// logFn is the package-level structured log function.
// Defaults to logJSON; log_hooks.go overrides with slog-based logging.
var logFn = logJSON

// requestStartLogFn and requestEndLogFn are the per-request fast-path log
// emitters used by Middleware. They avoid the per-event map[string]any literal
// allocation by accepting positional, primitive arguments. log_hooks.go swaps
// these to slog-backed implementations at init.
var (
	requestStartLogFn = defaultRequestStartLog
	requestEndLogFn   = defaultRequestEndLog
)

// Hook variables for optional enrichment (OTEL, MetricsProvider, etc.).
// Defaults are nil; log_hooks.go registers implementations.
var (
	onMiddlewarePre  func(r *http.Request)
	onMiddlewarePost func(r *http.Request, status int, bytes int, dur time.Duration)
	onWSFrame        func(direction string, n int)
)

// requests_total counter is published at init() and cached so the hot path
// avoids a per-request expvar.Get + interface assertion.
var requestsTotal *expvar.Int

// loggingWriterPool reuses loggingWriter instances across requests. The
// loggingWriter is reset on each acquisition so it never leaks state between
// handlers.
var loggingWriterPool = sync.Pool{
	New: func() any { return new(loggingWriter) },
}

// SetAppInfo configures the application identity for logging.
func SetAppInfo(name, version string) {
	AppName = name
	AppVersion = version
}

// Middleware adds a request id, emits JSON logs on start/end, and exposes basic counters and latency histograms.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := RequestIDFrom(r)
		w.Header().Set("X-Request-ID", id)
		start := time.Now()
		requestStartLogFn(start, id, r.Method, r.URL.Path)
		if fn := onMiddlewarePre; fn != nil {
			fn(r)
		}
		lw := loggingWriterPool.Get().(*loggingWriter)
		lw.ResponseWriter = w
		lw.code = 0
		lw.n = 0
		next.ServeHTTP(lw, r)
		dur := time.Since(start)
		status := lw.code
		if status == 0 {
			status = 200
		}
		bytesWritten := lw.n
		// Reset before returning to pool so we never hold a reference to
		// the underlying ResponseWriter across requests.
		lw.ResponseWriter = nil
		lw.code = 0
		lw.n = 0
		loggingWriterPool.Put(lw)
		requestEndLogFn(id, status, bytesWritten, dur)
		atomic.AddUint64(&reqCounter, 1)
		if requestsTotal != nil {
			requestsTotal.Add(1)
		}
		observeLatency("http", dur)
		if fn := onMiddlewarePost; fn != nil {
			fn(r, status, bytesWritten, dur)
		}
	})
}

type loggingWriter struct {
	http.ResponseWriter
	code int
	n    int
}

// WriteHeader captures the status code for logging.
func (l *loggingWriter) WriteHeader(statusCode int) {
	l.code = statusCode
	l.ResponseWriter.WriteHeader(statusCode)
}

// Write counts written bytes for logging.
func (l *loggingWriter) Write(b []byte) (int, error) {
	n, err := l.ResponseWriter.Write(b)
	l.n += n
	return n, err
}

// Flush proxies http.Flusher when supported by the underlying writer.
func (l *loggingWriter) Flush() {
	if f, ok := l.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack proxies http.Hijacker for WebSocket upgrades and similar use cases.
func (l *loggingWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if h, ok := l.ResponseWriter.(http.Hijacker); ok {
		return h.Hijack()
	}
	return nil, nil, fmt.Errorf("hijack not supported")
}

// Push proxies http.Pusher when available (HTTP/2 server push); otherwise returns ErrNotSupported.
func (l *loggingWriter) Push(target string, opts *http.PushOptions) error {
	if p, ok := l.ResponseWriter.(http.Pusher); ok {
		return p.Push(target, opts)
	}
	return http.ErrNotSupported
}

func init() {
	// initialize expvar counters
	if v, ok := expvar.Get("requests_total").(*expvar.Int); ok && v != nil {
		requestsTotal = v
	} else {
		requestsTotal = new(expvar.Int)
		expvar.Publish("requests_total", requestsTotal)
	}
	initLatencyVars()
	initWSMetrics()
}

func logJSON(v map[string]any) {
	if AppName != "" {
		v["app_name"] = AppName
	}
	if AppVersion != "" {
		v["app_version"] = AppVersion
	}
	_ = json.MarshalWrite(os.Stdout, v)
	_, _ = os.Stdout.Write([]byte("\n"))
}

// defaultRequestStartLog is the pre-slog fallback used when log_hooks.go has
// not yet swapped in slogRequestStartLog. It mirrors the legacy logJSON path
// so the JSON shape is identical.
func defaultRequestStartLog(start time.Time, id, method, path string) {
	logJSON(map[string]any{
		"ts":     start.UnixNano(),
		"event":  "request_start",
		"id":     id,
		"method": method,
		"path":   path,
	})
}

// defaultRequestEndLog is the pre-slog fallback used when log_hooks.go has
// not yet swapped in slogRequestEndLog.
func defaultRequestEndLog(id string, status, bytesWritten int, dur time.Duration) {
	logJSON(map[string]any{
		"ts":     time.Now().UnixNano(),
		"event":  "request_end",
		"id":     id,
		"status": status,
		"bytes":  bytesWritten,
		"ms":     dur.Milliseconds(),
	})
}

// RequestIDFrom returns the existing request id from headers if present, otherwise generates a new one.
func RequestIDFrom(r *http.Request) string {
	if id := r.Header.Get("X-Request-ID"); id != "" {
		return id
	}
	return NewRequestID()
}

// NewRequestID creates a new request id string. The encoding is
// "<base36-counter>-<base36-unix-nanos>". Implemented with stack-allocated
// scratch buffers so the only heap allocation is the returned string itself
// (a single allocation per call, vs. the prior format/concat path which
// allocated three).
func NewRequestID() string {
	c := atomic.AddUint64(&reqCounter, 1)
	var counterBuf [16]byte
	var nanosBuf [16]byte
	cb := strconv.AppendUint(counterBuf[:0], c, 36)
	nb := strconv.AppendInt(nanosBuf[:0], time.Now().UnixNano(), 36)
	out := make([]byte, 0, len(cb)+1+len(nb))
	out = append(out, cb...)
	out = append(out, '-')
	out = append(out, nb...)
	return string(out)
}

// VarsHandler returns /debug/vars gated by an auth function. If auth returns false, 401.
func VarsHandler(auth func(*http.Request) bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if auth != nil && !auth(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		expvar.Handler().ServeHTTP(w, r)
	})
}

// Histogram state and observation
var (
	latencyBuckets    = []int64{1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000} // ms
	latencyBucketKeys = makeBucketKeys(latencyBuckets)                             // pre-computed "le_<n>" labels
	latencyBucketVars = make([]*expvar.Int, len(latencyBuckets))                   // hoisted per-bucket counters
	latencyMap        *expvar.Map
	latencySum        *expvar.Int
	latencyCount      *expvar.Int
)

func makeBucketKeys(buckets []int64) []string {
	out := make([]string, len(buckets))
	for i, b := range buckets {
		out[i] = "le_" + strconv.FormatInt(b, 10)
	}
	return out
}

func initLatencyVars() {
	if expvar.Get("http_latency_ms_buckets") == nil {
		latencyMap = new(expvar.Map)
		expvar.Publish("http_latency_ms_buckets", latencyMap)
		for i, key := range latencyBucketKeys {
			v := new(expvar.Int)
			latencyMap.Set(key, v)
			latencyBucketVars[i] = v
		}
	} else {
		latencyMap, _ = expvar.Get("http_latency_ms_buckets").(*expvar.Map)
		// Repopulate the cached *expvar.Int slice from the live map so we
		// avoid the per-observation Get + type assertion on the hot path.
		for i, key := range latencyBucketKeys {
			if v, ok := latencyMap.Get(key).(*expvar.Int); ok {
				latencyBucketVars[i] = v
			}
		}
	}
	if expvar.Get("http_latency_ms_sum") == nil {
		latencySum = new(expvar.Int)
		expvar.Publish("http_latency_ms_sum", latencySum)
	} else {
		latencySum, _ = expvar.Get("http_latency_ms_sum").(*expvar.Int)
	}
	if expvar.Get("http_latency_ms_count") == nil {
		latencyCount = new(expvar.Int)
		expvar.Publish("http_latency_ms_count", latencyCount)
	} else {
		latencyCount, _ = expvar.Get("http_latency_ms_count").(*expvar.Int)
	}
}

// observeLatency records duration into fixed buckets and updates sum/count.
func observeLatency(_ string, d time.Duration) {
	ms := d.Milliseconds()
	for i, b := range latencyBuckets {
		if ms <= b {
			if v := latencyBucketVars[i]; v != nil {
				v.Add(1)
			}
			break
		}
	}
	latencySum.Add(ms)
	latencyCount.Add(1)
}

// WS metrics
var (
	wsFramesTotal  *expvar.Int
	wsBytesTotal   *expvar.Int
	wsSizeBuckets  *expvar.Map
	wsBuckets      = []int64{0, 64, 128, 256, 512, 1024, 2048, 4096, 8192}
	wsBucketKeys   = makeBucketKeys(wsBuckets)
	wsBucketVars   = make([]*expvar.Int, len(wsBuckets))
	_largeFrameCtx = context.Background() // reused for level-gate checks
)

func initWSMetrics() {
	if expvar.Get("ws_frames_total") == nil {
		wsFramesTotal = new(expvar.Int)
		expvar.Publish("ws_frames_total", wsFramesTotal)
	}
	if expvar.Get("ws_bytes_total") == nil {
		wsBytesTotal = new(expvar.Int)
		expvar.Publish("ws_bytes_total", wsBytesTotal)
	}
	if expvar.Get("ws_msg_bytes_buckets") == nil {
		wsSizeBuckets = new(expvar.Map)
		expvar.Publish("ws_msg_bytes_buckets", wsSizeBuckets)
		for i, key := range wsBucketKeys {
			v := new(expvar.Int)
			wsSizeBuckets.Set(key, v)
			wsBucketVars[i] = v
		}
	} else {
		wsSizeBuckets, _ = expvar.Get("ws_msg_bytes_buckets").(*expvar.Map)
		for i, key := range wsBucketKeys {
			if v, ok := wsSizeBuckets.Get(key).(*expvar.Int); ok {
				wsBucketVars[i] = v
			}
		}
	}
}

// ObserveWSFrame records a WS message/frame size.
func ObserveWSFrame(direction string, opcode byte, n int) {
	wsFramesTotal.Add(1)
	wsBytesTotal.Add(int64(n))
	// bucket by size
	for i, b := range wsBuckets {
		if int64(n) <= b {
			if v := wsBucketVars[i]; v != nil {
				v.Add(1)
			}
			break
		}
	}
	// Optional: emit a small JSON log for large frames
	if n > 4096 {
		// Only build the map when slog (or the default JSON logger) will
		// actually emit Info-level output; otherwise the work is wasted.
		if loggerEnabledInfo() {
			logFn(map[string]any{"event": "ws_large_frame", "dir": direction, "opcode": opcode, "bytes": n})
		}
	}
	if fn := onWSFrame; fn != nil {
		fn(direction, n)
	}
}

// loggerEnabledInfo reports whether the active logger will emit Info events.
// Returns true when the default (logJSON) logger is in use because that path
// always writes; the slog hook in log_hooks.go overrides the implementation
// to consult slog.Logger.Enabled.
var loggerEnabledInfo = func() bool { return true }

// loggerEnabledInfoSlog is the slog-backed implementation installed by
// log_hooks.go.
func loggerEnabledInfoSlog() bool {
	return getLogger().Enabled(_largeFrameCtx, slog.LevelInfo)
}

// LogWS emits a JSON log entry for WebSocket events.
func LogWS(event string, fields map[string]any) { fields["ws_event"] = event; logFn(fields) }

// LogMCP emits a JSON log entry for MCP events.
func LogMCP(event string, fields map[string]any) { fields["mcp_event"] = event; logFn(fields) }

// LogAudit emits a generic audit log with consistent key.
func LogAudit(event string, fields map[string]any) { fields["audit_event"] = event; logFn(fields) }
