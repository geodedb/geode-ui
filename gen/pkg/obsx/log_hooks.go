package obsx

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

var loggerPtr atomic.Pointer[slog.Logger]

// hotPathCtx is reused for the per-request slog Enabled() / LogAttrs() calls
// where no caller-provided context is available (e.g., when emitting
// request_start/request_end from Middleware). slog handlers do not retain
// the context after the call returns, so reusing a single background context
// is safe and avoids context.Background() allocations.
var hotPathCtx = context.Background()

func init() {
	loggerPtr.Store(slog.Default())

	// Override the default log function with slog-based structured logging.
	logFn = slogLog

	// Install slog-backed fast-path emitters used by Middleware. These
	// avoid the per-request map[string]any literal allocation by passing
	// positional primitive args straight to slog.Logger.LogAttrs.
	requestStartLogFn = slogRequestStartLog
	requestEndLogFn = slogRequestEndLog

	// Replace the loggerEnabledInfo gate with a slog.Enabled check so
	// large-frame and similar opt-in events skip work when the level is
	// disabled.
	loggerEnabledInfo = loggerEnabledInfoSlog

	// Register middleware hooks for MetricsProvider and OTEL.
	onMiddlewarePre = middlewareOTELPre
	onMiddlewarePost = middlewareEnrichedPost
	onWSFrame = wsFrameEnrichedPost
}

// SetLogger configures the package-level logger. If l is nil, the call is a no-op.
func SetLogger(l *slog.Logger) {
	if l != nil {
		loggerPtr.Store(l)
	}
}

func getLogger() *slog.Logger { return loggerPtr.Load() }

// slogArgsPool reuses the []any slice that carries the map's key/value pairs
// into slog.Logger.Info. slog copies the args into its own Record before Info
// returns, so the slice can be returned to the pool immediately after the
// call. Acquired with len 0 (cap retained from prior use).
var slogArgsPool = sync.Pool{
	New: func() any { s := make([]any, 0, 32); return &s },
}

func slogLog(v map[string]any) {
	if AppName != "" {
		v["app_name"] = AppName
	}
	if AppVersion != "" {
		v["app_version"] = AppVersion
	}
	argsp := slogArgsPool.Get().(*[]any)
	args := (*argsp)[:0]
	var event string
	for k, val := range v {
		args = append(args, k, val)
		if k == "event" {
			if s, ok := val.(string); ok {
				event = s
			}
		}
	}
	if event == "" {
		event = "log"
	}
	getLogger().Info(event, args...)
	// slog has copied args into its Record; clear and return the slice.
	for i := range args {
		args[i] = nil
	}
	*argsp = args[:0]
	slogArgsPool.Put(argsp)
}

// slogRequestStartLog emits a request_start event using slog.LogAttrs which
// takes a fixed-length []slog.Attr slice that the compiler can stack-allocate
// (vs. the variadic ...any path that boxes every argument into an interface).
// The emitted fields match the legacy logJSON shape: ts, event, id, method,
// path (plus app_name / app_version when configured).
func slogRequestStartLog(start time.Time, id, method, path string) {
	logger := getLogger()
	if !logger.Enabled(hotPathCtx, slog.LevelInfo) {
		return
	}
	// 5 base attrs + up to 2 optional app_* attrs. The fixed-size array
	// keeps the slog.Attr slice on the stack.
	var buf [7]slog.Attr
	attrs := buf[:0]
	attrs = append(attrs,
		slog.Int64("ts", start.UnixNano()),
		slog.String("event", "request_start"),
		slog.String("id", id),
		slog.String("method", method),
		slog.String("path", path),
	)
	if AppName != "" {
		attrs = append(attrs, slog.String("app_name", AppName))
	}
	if AppVersion != "" {
		attrs = append(attrs, slog.String("app_version", AppVersion))
	}
	logger.LogAttrs(hotPathCtx, slog.LevelInfo, "request_start", attrs...)
}

// slogRequestEndLog emits a request_end event with the same shape as the
// legacy map-based path: ts, event, id, status, bytes, ms.
func slogRequestEndLog(id string, status, bytesWritten int, dur time.Duration) {
	logger := getLogger()
	if !logger.Enabled(hotPathCtx, slog.LevelInfo) {
		return
	}
	var buf [8]slog.Attr
	attrs := buf[:0]
	attrs = append(attrs,
		slog.Int64("ts", time.Now().UnixNano()),
		slog.String("event", "request_end"),
		slog.String("id", id),
		slog.Int("status", status),
		slog.Int("bytes", bytesWritten),
		slog.Int64("ms", dur.Milliseconds()),
	)
	if AppName != "" {
		attrs = append(attrs, slog.String("app_name", AppName))
	}
	if AppVersion != "" {
		attrs = append(attrs, slog.String("app_version", AppVersion))
	}
	logger.LogAttrs(hotPathCtx, slog.LevelInfo, "request_end", attrs...)
}

func middlewareOTELPre(r *http.Request) {
	if TelemetryEnabled() {
		otelHTTPActiveRequests.Add(r.Context(), 1, otelHTTPAttrs(r.Method, r.URL.Path, ""))
	}
}

func middlewareEnrichedPost(r *http.Request, status int, bytes int, dur time.Duration) {
	provider := Metrics()

	// Hot path: when the active provider is the default ExpvarMetrics it
	// ignores labels (the implementation discards the labels argument), so
	// we can skip the labels map allocation entirely. Custom providers
	// (e.g. a Prometheus implementation) still receive a fully populated
	// labels map below.
	var labels map[string]string
	statusStr := ""
	if _, isExpvar := provider.(*ExpvarMetrics); !isExpvar {
		statusStr = strconv.Itoa(status)
		labels = map[string]string{
			"method": r.Method,
			"route":  r.URL.Path,
			"status": statusStr,
		}
	}

	// MetricsProvider
	provider.IncCounter("http.server.request.total", labels)
	provider.ObserveHistogram("http.server.request.duration", float64(dur.Milliseconds()), labels)
	provider.ObserveHistogram("http.server.response.body_size", float64(bytes), labels)

	// OTEL (when enabled)
	if TelemetryEnabled() {
		if statusStr == "" {
			statusStr = strconv.Itoa(status)
		}
		ctx := r.Context()
		attrs := otelHTTPAttrs(r.Method, r.URL.Path, statusStr)
		otelHTTPRequestsTotal.Add(ctx, 1, attrs)
		otelHTTPRequestDuration.Record(ctx, float64(dur.Milliseconds()), attrs)
		otelHTTPResponseBodySize.Record(ctx, float64(bytes), attrs)
		if r.ContentLength > 0 {
			otelHTTPRequestBodySize.Record(ctx, float64(r.ContentLength), attrs)
		}
		otelHTTPActiveRequests.Add(ctx, -1, attrs)
	}
}

func wsFrameEnrichedPost(direction string, n int) {
	// MetricsProvider
	labels := map[string]string{"direction": direction}
	Metrics().IncCounter("ws.frames.total", labels)
	Metrics().IncCounter("ws.bytes.total", labels)

	// OTEL (when enabled)
	if TelemetryEnabled() {
		ctx := context.Background()
		attrs := metric.WithAttributes(attribute.String("direction", direction))
		otelWSFramesTotal.Add(ctx, 1, attrs)
		otelWSBytesTotal.Add(ctx, int64(n), attrs)
	}
}
