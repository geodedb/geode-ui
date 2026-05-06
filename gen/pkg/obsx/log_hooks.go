package obsx

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

var loggerPtr atomic.Pointer[slog.Logger]

func init() {
	loggerPtr.Store(slog.Default())

	// Override the default log function with slog-based structured logging.
	logFn = slogLog

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

func slogLog(v map[string]any) {
	if AppName != "" {
		v["app_name"] = AppName
	}
	if AppVersion != "" {
		v["app_version"] = AppVersion
	}
	args := make([]any, 0, len(v)*2)
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
}

func middlewareOTELPre(r *http.Request) {
	if TelemetryEnabled() {
		otelHTTPActiveRequests.Add(r.Context(), 1, otelHTTPAttrs(r.Method, r.URL.Path, ""))
	}
}

func middlewareEnrichedPost(r *http.Request, status int, bytes int, dur time.Duration) {
	statusStr := strconv.Itoa(status)
	labels := map[string]string{
		"method": r.Method,
		"route":  r.URL.Path,
		"status": statusStr,
	}

	// MetricsProvider
	Metrics().IncCounter("http.server.request.total", labels)
	Metrics().ObserveHistogram("http.server.request.duration", float64(dur.Milliseconds()), labels)
	Metrics().ObserveHistogram("http.server.response.body_size", float64(bytes), labels)

	// OTEL (when enabled)
	if TelemetryEnabled() {
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
