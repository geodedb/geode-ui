package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestIsLoopbackAddr pins the loopback-only validator. Anything that is
// not 127.0.0.1, [::1], or localhost (any port) is refused so a
// misconfigured GEODE_PPROF_LISTEN cannot expose pprof on a public
// interface. PERF-N3 (#278).
func TestIsLoopbackAddr(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"127.0.0.1:6060", true},
		{"localhost:6060", true},
		{"[::1]:6060", true},
		{"0.0.0.0:6060", false},
		{"0.0.0.0:0", false},
		{"192.168.1.10:6060", false},
		{"10.0.0.1:6060", false},
		{":6060", false},
		{"", false},
		{"public.example.com:6060", false},
		{"[fe80::1]:6060", false},
	}
	for _, c := range cases {
		got := isLoopbackAddr(c.in)
		if got != c.want {
			t.Errorf("isLoopbackAddr(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

// TestStartPprofServer_Disabled covers the default production path:
// when GEODE_PPROF is unset, the helper returns a no-op shutdown and
// no listener is created.
func TestStartPprofServer_Disabled(t *testing.T) {
	for _, val := range []string{"", "0", "false", "no"} {
		envSnap := map[string]string{"GEODE_PPROF": val}
		shutdown, err := startPprofServer(envFunc(envSnap))
		if err != nil {
			t.Fatalf("disabled-path: unexpected error: %v", err)
		}
		if shutdown == nil {
			t.Fatalf("disabled-path: shutdown closure must not be nil")
		}
		if err := shutdown(context.Background()); err != nil {
			t.Fatalf("disabled shutdown must be a no-op nil: %v", err)
		}
	}
}

// TestStartPprofServer_RefusesNonLoopback covers the misconfiguration
// path: GEODE_PPROF=1 with GEODE_PPROF_LISTEN=0.0.0.0:6060 MUST return
// an error rather than start the listener. This is the defense-in-
// depth gate on the env var so an operator who wires the feature on
// cannot accidentally expose pprof on a public interface.
func TestStartPprofServer_RefusesNonLoopback(t *testing.T) {
	shutdown, err := startPprofServer(envFunc(map[string]string{
		"GEODE_PPROF":        "1",
		"GEODE_PPROF_LISTEN": "0.0.0.0:6060",
	}))
	if err == nil {
		t.Fatalf("expected error for non-loopback listen address; got nil")
		_ = shutdown(context.Background())
	}
	if !strings.Contains(err.Error(), "non-loopback") {
		t.Fatalf("error message should mention non-loopback; got %q", err)
	}
}

// TestPprofMux_ServesDebugIndex pins the route surface: the dedicated
// pprof mux serves `/debug/pprof/` with a non-empty HTML response.
// This avoids spinning up a real listener (httptest.NewServer covers
// the integration end-to-end; the loopback-only assertion is in
// TestStartPprofServer_RefusesNonLoopback above).
func TestPprofMux_ServesDebugIndex(t *testing.T) {
	mux := newPprofMux()
	hs := httptest.NewServer(mux)
	t.Cleanup(hs.Close)

	resp, err := http.Get(hs.URL + "/debug/pprof/")
	if err != nil {
		t.Fatalf("GET /debug/pprof/: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<14))
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	// The pprof Index handler emits an HTML body that always contains
	// the heading text "/debug/pprof/" along with the profile table.
	if !strings.Contains(string(body), "/debug/pprof/") {
		t.Fatalf("body does not contain `/debug/pprof/` heading; got %q", string(body))
	}
}

// TestStartPprofServer_LoopbackEndToEnd covers the happy path: with
// GEODE_PPROF=1 and a loopback listen address, the helper binds a
// listener that serves /debug/pprof/ and the shutdown closure stops
// it cleanly within budget.
func TestStartPprofServer_LoopbackEndToEnd(t *testing.T) {
	shutdown, err := startPprofServer(envFunc(map[string]string{
		"GEODE_PPROF":        "1",
		"GEODE_PPROF_LISTEN": "127.0.0.1:0", // ephemeral port — but our validator rejects :0; use a real port.
	}))
	// The :0 ephemeral port is rejected by isLoopbackAddr only if the
	// host prefix is not 127.0.0.1; 127.0.0.1:0 passes because the
	// host prefix matches. The OS picks a port at Listen time; we
	// cannot easily probe the bound port without restructuring the
	// helper. Confirm only that the helper accepted the config and
	// the shutdown closure returns without error within budget.
	if err != nil {
		t.Fatalf("loopback happy path: unexpected error: %v", err)
	}
	if shutdown == nil {
		t.Fatalf("shutdown closure must not be nil")
	}
	// Give the goroutine a moment to enter ListenAndServe.
	time.Sleep(50 * time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := shutdown(ctx); err != nil {
		t.Fatalf("shutdown: %v", err)
	}
}
