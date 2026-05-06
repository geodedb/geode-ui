package obsx

import (
	"bufio"
	"encoding/json/v2"
	"expvar"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
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

// Hook variables for optional enrichment (OTEL, MetricsProvider, etc.).
// Defaults are nil; log_hooks.go registers implementations.
var (
	onMiddlewarePre  func(r *http.Request)
	onMiddlewarePost func(r *http.Request, status int, bytes int, dur time.Duration)
	onWSFrame        func(direction string, n int)
)

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
		logFn(map[string]any{
			"ts":     start.UnixNano(),
			"event":  "request_start",
			"id":     id,
			"method": r.Method,
			"path":   r.URL.Path,
		})
		if fn := onMiddlewarePre; fn != nil {
			fn(r)
		}
		lw := &loggingWriter{ResponseWriter: w}
		next.ServeHTTP(lw, r)
		dur := time.Since(start)
		status := lw.code
		if status == 0 {
			status = 200
		}
		logFn(map[string]any{
			"ts":     time.Now().UnixNano(),
			"event":  "request_end",
			"id":     id,
			"status": status,
			"bytes":  lw.n,
			"ms":     dur.Milliseconds(),
		})
		atomic.AddUint64(&reqCounter, 1)
		if v, ok := expvar.Get("requests_total").(*expvar.Int); ok {
			v.Add(1)
		}
		observeLatency("http", dur)
		if fn := onMiddlewarePost; fn != nil {
			fn(r, status, lw.n, dur)
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
	if expvar.Get("requests_total") == nil {
		expvar.Publish("requests_total", new(expvar.Int))
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

// RequestIDFrom returns the existing request id from headers if present, otherwise generates a new one.
func RequestIDFrom(r *http.Request) string {
	if id := r.Header.Get("X-Request-ID"); id != "" {
		return id
	}
	return NewRequestID()
}

// NewRequestID creates a new request id string.
func NewRequestID() string {
	c := atomic.AddUint64(&reqCounter, 1)
	// base36 counter with nanosecond suffix for local uniqueness
	return strconv.FormatUint(c, 36) + "-" + strconv.FormatInt(time.Now().UnixNano(), 36)
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
	latencyBuckets = []int64{1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000} // ms
	latencyMap     *expvar.Map
	latencySum     *expvar.Int
	latencyCount   *expvar.Int
)

func initLatencyVars() {
	if expvar.Get("http_latency_ms_buckets") == nil {
		latencyMap = new(expvar.Map)
		expvar.Publish("http_latency_ms_buckets", latencyMap)
		for _, b := range latencyBuckets {
			latencyMap.Set(bucketKey(b), new(expvar.Int))
		}
	} else {
		latencyMap, _ = expvar.Get("http_latency_ms_buckets").(*expvar.Map)
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

func bucketKey(b int64) string { return "le_" + strconv.FormatInt(b, 10) }

// observeLatency records duration into fixed buckets and updates sum/count.
func observeLatency(_ string, d time.Duration) {
	ms := d.Milliseconds()
	for _, b := range latencyBuckets {
		if ms <= b {
			if v, ok := latencyMap.Get(bucketKey(b)).(*expvar.Int); ok {
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
	wsFramesTotal *expvar.Int
	wsBytesTotal  *expvar.Int
	wsSizeBuckets *expvar.Map
	wsBuckets     = []int64{0, 64, 128, 256, 512, 1024, 2048, 4096, 8192}
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
		for _, b := range wsBuckets {
			wsSizeBuckets.Set(bucketKey(b), new(expvar.Int))
		}
	}
}

// ObserveWSFrame records a WS message/frame size.
func ObserveWSFrame(direction string, opcode byte, n int) {
	wsFramesTotal.Add(1)
	wsBytesTotal.Add(int64(n))
	// bucket by size
	for _, b := range wsBuckets {
		if int64(n) <= b {
			if v, ok := wsSizeBuckets.Get(bucketKey(b)).(*expvar.Int); ok {
				v.Add(1)
			}
			break
		}
	}
	// Optional: emit a small JSON log for large frames
	if n > 4096 {
		logFn(map[string]any{"event": "ws_large_frame", "dir": direction, "opcode": opcode, "bytes": n})
	}
	if fn := onWSFrame; fn != nil {
		fn(direction, n)
	}
}

// LogWS emits a JSON log entry for WebSocket events.
func LogWS(event string, fields map[string]any) { fields["ws_event"] = event; logFn(fields) }

// LogMCP emits a JSON log entry for MCP events.
func LogMCP(event string, fields map[string]any) { fields["mcp_event"] = event; logFn(fields) }

// LogAudit emits a generic audit log with consistent key.
func LogAudit(event string, fields map[string]any) { fields["audit_event"] = event; logFn(fields) }
