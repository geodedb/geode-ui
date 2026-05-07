package obsx

import (
	"sync"
	"sync/atomic"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	metricnoop "go.opentelemetry.io/otel/metric/noop"
	"go.opentelemetry.io/otel/trace"
	tracenoop "go.opentelemetry.io/otel/trace/noop"
)

// TelemetryProvider wraps OpenTelemetry's TracerProvider and MeterProvider.
// Deployers configure SDK exporters externally; genapi uses the OTEL API only.
type TelemetryProvider struct {
	TracerProvider trace.TracerProvider
	MeterProvider  metric.MeterProvider
}

var telemetryPtr atomic.Pointer[TelemetryProvider]

// SetTelemetry configures OTEL telemetry. Pass nil to disable.
// When non-nil, OTEL instruments are created eagerly.
func SetTelemetry(tp *TelemetryProvider) {
	telemetryPtr.Store(tp)
	if tp != nil {
		initOTELInstruments(tp.MeterProvider)
	}
}

// Telemetry returns the current TelemetryProvider, or nil if disabled.
func Telemetry() *TelemetryProvider { return telemetryPtr.Load() }

// TelemetryEnabled returns true when a TelemetryProvider is configured.
func TelemetryEnabled() bool { return telemetryPtr.Load() != nil }

// Tracer returns a named tracer. Returns a noop tracer when telemetry is disabled.
func Tracer(name string) trace.Tracer {
	if tp := telemetryPtr.Load(); tp != nil && tp.TracerProvider != nil {
		return tp.TracerProvider.Tracer(name)
	}
	return tracenoop.NewTracerProvider().Tracer(name)
}

// Meter returns a named meter. Returns a noop meter when telemetry is disabled.
func Meter(name string) metric.Meter {
	if tp := telemetryPtr.Load(); tp != nil && tp.MeterProvider != nil {
		return tp.MeterProvider.Meter(name)
	}
	return metricnoop.NewMeterProvider().Meter(name)
}

// instrumentsMu protects writes to the package-level OTEL instrument variables
// during concurrent SetTelemetry calls.
var instrumentsMu sync.Mutex

// OTEL instruments — created eagerly when SetTelemetry is called.
var (
	// HTTP
	otelHTTPRequestsTotal    metric.Int64Counter
	otelHTTPRequestDuration  metric.Float64Histogram
	otelHTTPRequestBodySize  metric.Float64Histogram
	otelHTTPResponseBodySize metric.Float64Histogram
	otelHTTPActiveRequests   metric.Int64UpDownCounter

	// WebSocket
	otelWSConnsTotal   metric.Int64Counter
	otelWSConnsActive  metric.Int64UpDownCounter
	otelWSFramesTotal  metric.Int64Counter
	otelWSBytesTotal   metric.Int64Counter
	otelWSConnDuration metric.Float64Histogram

	// MCP
	otelMCPToolCallsTotal metric.Int64Counter
	otelMCPToolDuration   metric.Float64Histogram
	otelMCPRequestsTotal  metric.Int64Counter

	// GraphQL
	otelGQLQueriesTotal  metric.Int64Counter
	otelGQLQueryDuration metric.Float64Histogram
	otelGQLSubsActive    metric.Int64UpDownCounter
	otelGQLErrorsTotal   metric.Int64Counter

	// Cross-cutting
	otelPanicsTotal          metric.Int64Counter
	otelAuthAttemptsTotal    metric.Int64Counter
	otelRateLimitRejectTotal metric.Int64Counter
)

func initOTELInstruments(mp metric.MeterProvider) {
	instrumentsMu.Lock()
	defer instrumentsMu.Unlock()
	m := mp.Meter("genapi")

	// HTTP
	otelHTTPRequestsTotal, _ = m.Int64Counter("http.server.request.total")
	otelHTTPRequestDuration, _ = m.Float64Histogram("http.server.request.duration",
		metric.WithUnit("ms"))
	otelHTTPRequestBodySize, _ = m.Float64Histogram("http.server.request.body_size",
		metric.WithUnit("By"))
	otelHTTPResponseBodySize, _ = m.Float64Histogram("http.server.response.body_size",
		metric.WithUnit("By"))
	otelHTTPActiveRequests, _ = m.Int64UpDownCounter("http.server.active_requests")

	// WebSocket
	otelWSConnsTotal, _ = m.Int64Counter("ws.connections.total")
	otelWSConnsActive, _ = m.Int64UpDownCounter("ws.connections.active")
	otelWSFramesTotal, _ = m.Int64Counter("ws.frames.total")
	otelWSBytesTotal, _ = m.Int64Counter("ws.bytes.total")
	otelWSConnDuration, _ = m.Float64Histogram("ws.connection.duration",
		metric.WithUnit("ms"))

	// MCP
	otelMCPToolCallsTotal, _ = m.Int64Counter("mcp.tool.calls.total")
	otelMCPToolDuration, _ = m.Float64Histogram("mcp.tool.duration",
		metric.WithUnit("ms"))
	otelMCPRequestsTotal, _ = m.Int64Counter("mcp.requests.total")

	// GraphQL
	otelGQLQueriesTotal, _ = m.Int64Counter("gql.queries.total")
	otelGQLQueryDuration, _ = m.Float64Histogram("gql.query.duration",
		metric.WithUnit("ms"))
	otelGQLSubsActive, _ = m.Int64UpDownCounter("gql.subscriptions.active")
	otelGQLErrorsTotal, _ = m.Int64Counter("gql.errors.total")

	// Cross-cutting
	otelPanicsTotal, _ = m.Int64Counter("panics.total")
	otelAuthAttemptsTotal, _ = m.Int64Counter("auth.attempts.total")
	otelRateLimitRejectTotal, _ = m.Int64Counter("ratelimit.rejections.total")
}

// otelHTTPAttrs builds OTEL measurement options for HTTP metrics.
func otelHTTPAttrs(method, route, status string) metric.MeasurementOption {
	return metric.WithAttributes(
		attribute.String("method", method),
		attribute.String("route", route),
		attribute.String("status_code", status),
	)
}
