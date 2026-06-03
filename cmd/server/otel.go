package main

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"geodedb.com/geode-ui/gen/pkg/obsx"
)

// startTelemetry wires OTLP trace + metric exporters (OTLP/HTTP) from the
// standard OTEL_EXPORTER_OTLP_* environment and registers them with obsx so
// geode-ui's HTTP tracing middleware and metrics instruments actually export.
//
// It is a no-op when OTEL_EXPORTER_OTLP_ENDPOINT (or the traces-specific
// override) is unset: obsx keeps returning noop tracers/meters, so
// uninstrumented deployments are unaffected and bootstrap unit tests (which
// never set the endpoint) stay offline. Mirrors the startPprofServer opt-in +
// shutdown-closure pattern in app.go.
//
// The exporters themselves read OTEL_EXPORTER_OTLP_ENDPOINT / _HEADERS /
// _PROTOCOL / _INSECURE from the process environment (an http:// endpoint is
// plaintext), so a deployer points geode-ui at the in-cluster collector via:
//
//	OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.observability.svc.cluster.local:4318
func startTelemetry(getenv func(string) string) (func(context.Context) error, error) {
	noop := func(context.Context) error { return nil }
	if getenv("OTEL_EXPORTER_OTLP_ENDPOINT") == "" &&
		getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") == "" {
		return noop, nil
	}

	ctx := context.Background()

	// service.name default; OTEL_SERVICE_NAME / OTEL_RESOURCE_ATTRIBUTES (via
	// WithFromEnv, applied last) override it.
	res, err := resource.New(ctx,
		resource.WithAttributes(attribute.String("service.name", "geode-ui")),
		resource.WithTelemetrySDK(),
		resource.WithFromEnv(),
	)
	if err != nil {
		return nil, err
	}

	traceExp, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(traceExp),
		sdktrace.WithResource(res),
	)

	metricExp, err := otlpmetrichttp.New(ctx)
	if err != nil {
		_ = tp.Shutdown(ctx)
		return nil, err
	}
	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExp)),
		sdkmetric.WithResource(res),
	)

	otel.SetTracerProvider(tp)
	otel.SetMeterProvider(mp)
	obsx.SetTelemetry(&obsx.TelemetryProvider{TracerProvider: tp, MeterProvider: mp})

	return func(c context.Context) error {
		obsx.SetTelemetry(nil)
		terr := tp.Shutdown(c)
		if merr := mp.Shutdown(c); terr == nil {
			terr = merr
		}
		return terr
	}, nil
}
