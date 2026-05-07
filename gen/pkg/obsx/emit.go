package obsx

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// EmitAuthAttempt records an auth attempt via MetricsProvider and OTEL.
func EmitAuthAttempt(ctx context.Context, method string, ok bool) {
	status := "ok"
	if !ok {
		status = "fail"
	}
	labels := map[string]string{"method": method, "status": status}
	Metrics().IncCounter("auth.attempts.total", labels)
	if TelemetryEnabled() {
		otelAuthAttemptsTotal.Add(ctx, 1, metric.WithAttributes(
			attribute.String("method", method),
			attribute.String("status", status),
		))
	}
}

// EmitRateLimitReject records a rate limit rejection.
func EmitRateLimitReject(ctx context.Context, route string) {
	Metrics().IncCounter("ratelimit.rejections.total", map[string]string{"route": route})
	if TelemetryEnabled() {
		otelRateLimitRejectTotal.Add(ctx, 1, metric.WithAttributes(
			attribute.String("route", route),
		))
	}
}

// EmitWSConnect records a new WebSocket connection.
func EmitWSConnect(ctx context.Context, path string) {
	Metrics().IncCounter("ws.connections.total", map[string]string{"path": path})
	if TelemetryEnabled() {
		otelWSConnsTotal.Add(ctx, 1, metric.WithAttributes(attribute.String("path", path)))
		otelWSConnsActive.Add(ctx, 1, metric.WithAttributes(attribute.String("path", path)))
	}
}

// EmitWSDisconnect records a WebSocket disconnection with duration.
func EmitWSDisconnect(ctx context.Context, path string, durationMs float64) {
	Metrics().ObserveHistogram("ws.connection.duration", durationMs, map[string]string{"path": path})
	if TelemetryEnabled() {
		otelWSConnsActive.Add(ctx, -1, metric.WithAttributes(attribute.String("path", path)))
		otelWSConnDuration.Record(ctx, durationMs, metric.WithAttributes(attribute.String("path", path)))
	}
}

// EmitWSFrame records a WebSocket frame via MetricsProvider and OTEL.
func EmitWSFrame(ctx context.Context, path, direction string, n int) {
	labels := map[string]string{"path": path, "direction": direction}
	Metrics().IncCounter("ws.frames.total", labels)
	Metrics().IncCounter("ws.bytes.total", labels)
	if TelemetryEnabled() {
		attrs := metric.WithAttributes(
			attribute.String("path", path),
			attribute.String("direction", direction),
		)
		otelWSFramesTotal.Add(ctx, 1, attrs)
		otelWSBytesTotal.Add(ctx, int64(n), attrs)
	}
}

// EmitMCPToolCall records an MCP tool invocation.
func EmitMCPToolCall(ctx context.Context, tool string, durationMs float64, ok bool) {
	status := "ok"
	if !ok {
		status = "error"
	}
	labels := map[string]string{"tool": tool, "status": status}
	Metrics().IncCounter("mcp.tool.calls.total", labels)
	Metrics().ObserveHistogram("mcp.tool.duration", durationMs, labels)
	if TelemetryEnabled() {
		attrs := metric.WithAttributes(
			attribute.String("tool", tool),
			attribute.String("status", status),
		)
		otelMCPToolCallsTotal.Add(ctx, 1, attrs)
		otelMCPToolDuration.Record(ctx, durationMs, attrs)
	}
}

// EmitMCPRequest records an MCP JSON-RPC request.
func EmitMCPRequest(ctx context.Context, method string) {
	Metrics().IncCounter("mcp.requests.total", map[string]string{"method": method})
	if TelemetryEnabled() {
		otelMCPRequestsTotal.Add(ctx, 1, metric.WithAttributes(
			attribute.String("method", method),
		))
	}
}

// EmitGQLQuery records a GraphQL query execution. The operation name
// is supplied by the (possibly untrusted) GraphQL client and is
// sanitized by safeOperationLabel before being used as a metric label
// to bound cardinality. APPSEC-12.
func EmitGQLQuery(ctx context.Context, operationName string, durationMs float64, ok bool) {
	status := "ok"
	if !ok {
		status = "error"
	}
	opLabel := safeOperationLabel(operationName)
	labels := map[string]string{"operation_name": opLabel, "status": status}
	Metrics().IncCounter("gql.queries.total", labels)
	Metrics().ObserveHistogram("gql.query.duration", durationMs, labels)
	if TelemetryEnabled() {
		attrs := metric.WithAttributes(
			attribute.String("operation_name", opLabel),
			attribute.String("status", status),
		)
		otelGQLQueriesTotal.Add(ctx, 1, attrs)
		otelGQLQueryDuration.Record(ctx, durationMs, attrs)
	}
}

// maxOperationLabelLen caps the operation_name metric label so an
// attacker cannot blow out cardinality by sending arbitrarily long
// names. 64 is generous for any well-formed GraphQL identifier.
const maxOperationLabelLen = 64

// safeOperationLabel maps an attacker-controlled operationName onto a
// bounded, ASCII-only label suitable for use as a metric dimension.
// Empty input collapses to "anonymous" (the canonical GraphQL term
// for an unnamed operation); any name failing the validation falls
// back to "invalid" so cardinality stays bounded by the configured
// schema rather than by request volume. APPSEC-12.
func safeOperationLabel(name string) string {
	if name == "" {
		return "anonymous"
	}
	if len(name) > maxOperationLabelLen {
		return "invalid"
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		switch {
		case c >= 'A' && c <= 'Z':
		case c >= 'a' && c <= 'z':
		case c >= '0' && c <= '9':
		case c == '_':
		default:
			return "invalid"
		}
	}
	return name
}

// EmitGQLSubActive adjusts the active GraphQL subscription gauge.
func EmitGQLSubActive(ctx context.Context, delta int64) {
	if TelemetryEnabled() {
		otelGQLSubsActive.Add(ctx, delta)
	}
}

// EmitGQLError records a GraphQL error by type.
func EmitGQLError(ctx context.Context, errorType string) {
	Metrics().IncCounter("gql.errors.total", map[string]string{"type": errorType})
	if TelemetryEnabled() {
		otelGQLErrorsTotal.Add(ctx, 1, metric.WithAttributes(
			attribute.String("type", errorType),
		))
	}
}

// EmitPanic records a panic recovery event.
func EmitPanic(ctx context.Context) {
	Metrics().IncCounter("panics.total", nil)
	if TelemetryEnabled() {
		otelPanicsTotal.Add(ctx, 1)
	}
}
