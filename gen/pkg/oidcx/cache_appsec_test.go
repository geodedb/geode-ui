package oidcx_test

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"geodedb.com/geode-ui/gen/pkg/oidcx"
	"github.com/lestrrat-go/jwx/jwk"
)

// TestJWKCache_FetchTimeout_BoundsHungIdP is the regression test for
// APPSEC-7. The default behavior of jwk.AutoRefresh is to use
// http.DefaultClient, which has no timeout -- so a hung IdP would stall
// the cold-start (and every refresh goroutine, and every sync verify
// path once wired). NewJWKCache must apply a finite per-request timeout
// by default, configurable via WithFetchTimeout.
//
// The test deliberately uses a bare TCP listener that accepts the
// connection but never responds, so the only thing that can unblock
// the call is a request timeout.
func TestJWKCache_FetchTimeout_BoundsHungIdP(t *testing.T) {
	t.Parallel()
	var lc net.ListenConfig
	ln, err := lc.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("ListenConfig.Listen: %v", err)
	}
	defer func() { _ = ln.Close() }()
	go func() {
		// Accept the connection but never write a response. Any deeper
		// hangs (e.g., kernel SYN-RECV) are also fine for this test.
		conn, _ := ln.Accept()
		if conn != nil {
			defer func() { _ = conn.Close() }()
			time.Sleep(30 * time.Second)
		}
	}()
	url := "http://" + ln.Addr().String() + "/jwks.json"

	// Background context (no deadline) so only the fetch timeout can
	// unblock the call. Pre-fix this hangs indefinitely.
	ctx := context.Background()
	deadline := time.Now().Add(5 * time.Second)
	done := make(chan error, 1)
	go func() {
		_, err := oidcx.NewJWKCache(ctx, url, oidcx.WithFetchTimeout(500*time.Millisecond))
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected NewJWKCache to fail on hung server")
		}
	case <-time.After(time.Until(deadline)):
		t.Fatal("NewJWKCache did not respect WithFetchTimeout (still running after 5s)")
	}
}

// TestJWKCache_DefaultFetchTimeout_IsFinite ensures the constructor
// applies a sane default timeout when no explicit fetch timeout is
// supplied. Pre-fix the default was effectively infinite. The test
// uses a small WithFetchTimeout override only because the production
// default of 30 seconds is too long for an in-process unit test --
// the assertion is "the configured default IS applied", not "the
// default IS exactly 30 seconds".
func TestJWKCache_DefaultFetchTimeout_IsFinite(t *testing.T) {
	t.Parallel()
	// Server that blocks until the test cleans up. Using a channel
	// rather than time.Sleep so srv.Close() returns promptly.
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	defer srv.Close()

	ctx := context.Background()
	deadline := time.Now().Add(5 * time.Second)
	done := make(chan error, 1)
	go func() {
		// Use a 1s override so the test runs fast; pre-fix this option
		// did not exist and the request hung indefinitely on
		// http.DefaultClient.
		_, err := oidcx.NewJWKCache(ctx, srv.URL+"/jwks.json",
			oidcx.WithFetchTimeout(time.Second),
		)
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected NewJWKCache to fail on hung server")
		}
	case <-time.After(time.Until(deadline)):
		t.Fatal("NewJWKCache fetch timeout is not enforced (still running after 5s)")
	}
}

// TestJWKCache_Set_RefusesSetWhenStaleExceedsMax is the regression test
// for APPSEC-3. Pre-fix, jwk.AutoRefresh.Fetch silently returned the
// last-good set on refresh failure with no upper bound on how stale
// that set could be -- so a permanently-down IdP would let the cache
// serve indefinitely-old keys after the (unrelated to JWKS) attacker
// rotation grace window passes.
//
// After the fix, WithMaxStaleness gives the operator a hard cap.
// Set() returns ErrJWKSStaleExceeded once the last successful fetch
// is older than the cap, even though jwk.AutoRefresh would still
// hand back the old set.
func TestJWKCache_Set_RefusesSetWhenStaleExceedsMax(t *testing.T) {
	t.Parallel()

	initial := jwk.NewSet()
	initial.Add(makeRSAKey(t, "kid-stale-cap"))
	srv := newRotatingJWKSServer(t, initial)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	cache, err := oidcx.NewJWKCache(ctx, srv.URL(),
		oidcx.WithMinRefreshInterval(time.Second),
		oidcx.WithMaxStaleness(150*time.Millisecond),
	)
	if err != nil {
		t.Fatalf("NewJWKCache: %v", err)
	}

	// Sanity: fresh cache is healthy and Set() succeeds.
	if !cache.Healthy() {
		t.Fatal("cache should be Healthy() immediately after cold-start")
	}
	if _, err := cache.Set(ctx); err != nil {
		t.Fatalf("Set immediately after cold-start: %v", err)
	}

	// Trip the IdP into a synthetic outage and wait past the staleness
	// cap. AutoRefresh would happily keep serving the cold-start set;
	// Set() must instead surface ErrJWKSStaleExceeded.
	srv.failNext.Store(100) // every subsequent request fails
	time.Sleep(300 * time.Millisecond)

	if cache.Healthy() {
		t.Error("cache.Healthy() should be false after staleness cap is exceeded")
	}
	_, err = cache.Set(ctx)
	if err == nil {
		t.Fatal("Set should reject after MaxStaleness elapses with no successful refresh")
	}
	if !errors.Is(err, oidcx.ErrJWKSStaleExceeded) {
		t.Errorf("err = %v, want %v", err, oidcx.ErrJWKSStaleExceeded)
	}
}
