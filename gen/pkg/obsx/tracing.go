package obsx

import (
	"fmt"
	"net/http"
	"strconv"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

var propagator = propagation.TraceContext{}

// TracingMiddleware creates an OTEL span per HTTP request with W3C trace context
// propagation. When telemetry is disabled (nil provider), it is a zero-cost passthrough.
func TracingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !TelemetryEnabled() {
			next.ServeHTTP(w, r)
			return
		}

		ctx := propagator.Extract(r.Context(), propagation.HeaderCarrier(r.Header))
		spanName := fmt.Sprintf("HTTP %s %s", r.Method, r.URL.Path)

		ctx, span := Tracer("genapi.http").Start(ctx, spanName,
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(
				semconv.HTTPRequestMethodKey.String(r.Method),
				semconv.URLPath(r.URL.Path),
			),
		)
		defer span.End()

		if r.ContentLength > 0 {
			span.SetAttributes(attribute.Int64("http.request.body.size", r.ContentLength))
		}

		// Inject trace context into response headers.
		propagator.Inject(ctx, propagation.HeaderCarrier(w.Header()))

		tw := &tracingWriter{ResponseWriter: w}
		next.ServeHTTP(tw, r.WithContext(ctx))

		status := tw.status
		if status == 0 {
			status = 200
		}
		span.SetAttributes(
			semconv.HTTPResponseStatusCode(status),
			attribute.Int("http.response.body.size", tw.written),
		)
		if status >= 500 {
			span.SetStatus(codes.Error, "HTTP "+strconv.Itoa(status))
		} else {
			span.SetStatus(codes.Ok, "")
		}
	})
}

type tracingWriter struct {
	http.ResponseWriter
	status  int
	written int
}

func (tw *tracingWriter) WriteHeader(code int) {
	tw.status = code
	tw.ResponseWriter.WriteHeader(code)
}

func (tw *tracingWriter) Write(b []byte) (int, error) {
	n, err := tw.ResponseWriter.Write(b)
	tw.written += n
	return n, err
}
