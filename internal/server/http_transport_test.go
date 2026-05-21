package server

import (
	"net/http"
	"testing"
	"time"
)

// TestSharedOutboundTransport_SingletonIdentity pins PERF-2026-05-21-03
// (Item 6, 2026-05-21 audit): every caller in the server package
// resolves to the SAME *http.Transport instance, so TLS handshakes
// and keep-alive connections are reused across the metrics-poll and
// HIBP-fetch paths rather than reset per call.
func TestSharedOutboundTransport_SingletonIdentity(t *testing.T) {
	a := sharedOutboundTransport()
	b := sharedOutboundTransport()
	if a == nil {
		t.Fatal("sharedOutboundTransport() returned nil")
	}
	if a != b {
		t.Fatalf("sharedOutboundTransport() returned distinct instances %p != %p", a, b)
	}
}

// TestSharedOutboundTransport_PoolSizing pins the tuning rationale
// documented in http_transport.go. Regressing any of these defaults
// silently puts the connection pool back at the Go default
// (MaxIdleConnsPerHost=2) which is what PERF-2026-05-21-03 fixed.
func TestSharedOutboundTransport_PoolSizing(t *testing.T) {
	tr := sharedOutboundTransport()
	if tr.MaxIdleConns != 100 {
		t.Errorf("MaxIdleConns=%d want 100", tr.MaxIdleConns)
	}
	if tr.MaxIdleConnsPerHost != 16 {
		t.Errorf("MaxIdleConnsPerHost=%d want 16 (default 2 was the regression)", tr.MaxIdleConnsPerHost)
	}
	if tr.IdleConnTimeout != 90*time.Second {
		t.Errorf("IdleConnTimeout=%v want 90s", tr.IdleConnTimeout)
	}
	if !tr.ForceAttemptHTTP2 {
		t.Error("ForceAttemptHTTP2 must be true so h2 reuse compounds the keep-alive win")
	}
}

// TestNewSharedClient_ShareTransport pins that two clients built via
// newSharedClient with different per-call timeouts STILL share the
// underlying transport. This is the property that lets the metrics
// (2s) and HIBP (5s) paths cohabit a single TLS-warm pool.
func TestNewSharedClient_ShareTransport(t *testing.T) {
	c1 := newSharedClient(2 * time.Second)
	c2 := newSharedClient(5 * time.Second)
	if c1.Transport != c2.Transport {
		t.Fatal("newSharedClient must share the package transport across all callers")
	}
	if c1.Timeout == c2.Timeout {
		t.Fatalf("timeouts must remain per-call distinct (c1=%v c2=%v)", c1.Timeout, c2.Timeout)
	}
	// And the shared transport must be a *http.Transport, not the
	// untuned http.DefaultTransport.
	tr, ok := c1.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("Transport=%T want *http.Transport", c1.Transport)
	}
	if tr.MaxIdleConnsPerHost == 2 {
		t.Fatal("transport is at the Go default MaxIdleConnsPerHost=2; tuning was lost")
	}
}

// TestHIBPDefaultClient_SingletonAndShared pins that the HIBP fallback
// client is process-global AND that it wraps the shared transport.
func TestHIBPDefaultClient_SingletonAndShared(t *testing.T) {
	a := hibpDefaultClient()
	b := hibpDefaultClient()
	if a != b {
		t.Fatalf("hibpDefaultClient() must be a singleton; got %p != %p", a, b)
	}
	if a.Transport != sharedOutboundTransport() {
		t.Fatal("hibpDefaultClient must wrap sharedOutboundTransport()")
	}
}

// TestMetricsHTTPClient_SingletonAndShared pins that the production
// metrics-poll path resolves to a singleton client that wraps the
// shared transport, and that test injection via cfg.MetricsHTTPClient
// still overrides without touching the production singleton.
func TestMetricsHTTPClient_SingletonAndShared(t *testing.T) {
	s := New(Config{Version: "test"})

	a := metricsHTTPClient(s)
	b := metricsHTTPClient(s)
	if a != b {
		t.Fatalf("metricsHTTPClient(production) must be a singleton; %p != %p", a, b)
	}
	if a.Transport != sharedOutboundTransport() {
		t.Fatal("metricsHTTPClient must wrap sharedOutboundTransport() in the production path")
	}
	if a.Timeout != metricsUpstreamTimeout {
		t.Errorf("Timeout=%v want %v", a.Timeout, metricsUpstreamTimeout)
	}

	// Injection still wins.
	injected := &http.Client{Timeout: 7 * time.Second}
	s2 := New(Config{Version: "test", MetricsHTTPClient: injected})
	if got := metricsHTTPClient(s2); got != injected {
		t.Fatalf("cfg.MetricsHTTPClient override ignored; got %p want %p", got, injected)
	}
}
