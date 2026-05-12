package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"geodedb.com/geode-ui/internal/jwt"
)

// envFunc builds a getenv-style closure over a static map so tests can
// inject the process environment without touching os.Setenv (which would
// leak across parallel tests).
func envFunc(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

// validProfilestoreKey returns a base64-encoded 32-byte key suitable for
// GEODE_PROFILESTORE_KEY.
func validProfilestoreKey() string {
	var b [32]byte
	for i := range b {
		b[i] = byte(i + 1)
	}
	return base64.StdEncoding.EncodeToString(b[:])
}

// validJWTSecretHex returns a hex-encoded 32-byte HS256 secret.
func validJWTSecretHex() string {
	return strings.Repeat("ab", 32)
}

func TestRun_MissingJWTSecret_ExitsNonZero(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run([]string{"geode-ui"}, envFunc(nil), &stdout, &stderr)
	if code == 0 {
		t.Fatalf("run() with no -jwt-secret-hex: want non-zero exit, got %d", code)
	}
	if !strings.Contains(stderr.String(), "jwt-secret-hex") {
		t.Fatalf("run() should report the missing -jwt-secret-hex on stderr; got %q", stderr.String())
	}
}

func TestRun_ShortJWTSecret_ExitsNonZero(t *testing.T) {
	var stdout, stderr bytes.Buffer
	// 16 bytes hex => 8 raw bytes, well under the 32-byte minimum.
	code := run([]string{"geode-ui", "-jwt-secret-hex", "0011223344556677"}, envFunc(nil), &stdout, &stderr)
	if code == 0 {
		t.Fatalf("run() with short -jwt-secret-hex: want non-zero exit, got %d", code)
	}
	if stderr.Len() == 0 {
		t.Fatalf("run() with short secret should write an error to stderr")
	}
}

func TestNewApp_MissingProfilestoreKey_Errors(t *testing.T) {
	cfg := appConfig{
		listen:       "127.0.0.1:0",
		profileStore: ":memory:",
		secretHex:    validJWTSecretHex(),
		jwtTTL:       defaultJWTTTL,
		adminUsers:   "geode",
	}
	_, err := newApp(cfg, envFunc(nil)) // GEODE_PROFILESTORE_KEY unset
	if err == nil {
		t.Fatalf("newApp without GEODE_PROFILESTORE_KEY: want error, got nil")
	}
	if !strings.Contains(err.Error(), "GEODE_PROFILESTORE_KEY") {
		t.Fatalf("newApp error should name the missing env var; got %v", err)
	}
}

func TestNewApp_InvalidJWTSecret_Errors(t *testing.T) {
	cfg := appConfig{
		listen:       "127.0.0.1:0",
		profileStore: ":memory:",
		secretHex:    "zzzz", // not valid hex
		jwtTTL:       defaultJWTTTL,
		adminUsers:   "geode",
	}
	_, err := newApp(cfg, envFunc(map[string]string{"GEODE_PROFILESTORE_KEY": validProfilestoreKey()}))
	if err == nil {
		t.Fatalf("newApp with invalid hex secret: want error, got nil")
	}
}

func TestNewApp_HappyPath(t *testing.T) {
	cfg := appConfig{
		listen:        "127.0.0.1:0",
		profileStore:  filepath.Join(t.TempDir(), "profiles.db"),
		secretHex:     validJWTSecretHex(),
		jwtTTL:        defaultJWTTTL,
		adminUsers:    "geode",
		uploadDir:     t.TempDir(),
		secureCookies: true,
	}
	a, err := newApp(cfg, envFunc(map[string]string{"GEODE_PROFILESTORE_KEY": validProfilestoreKey()}))
	if err != nil {
		t.Fatalf("newApp happy path: unexpected error: %v", err)
	}
	if a == nil {
		t.Fatalf("newApp happy path: returned nil *app")
	}
	t.Cleanup(a.close)
	if a.handler == nil {
		t.Fatalf("newApp happy path: app.handler is nil")
	}
	// The assembled handler must serve the unauthenticated health probe.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	a.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /healthz through the assembled handler: want 200, got %d (body %q)", rec.Code, rec.Body.String())
	}
}

func TestNewApp_WiresMCPAuthVerifier(t *testing.T) {
	cfg := appConfig{
		listen:        "127.0.0.1:0",
		profileStore:  filepath.Join(t.TempDir(), "profiles.db"),
		secretHex:     validJWTSecretHex(),
		jwtTTL:        defaultJWTTTL,
		adminUsers:    "geode",
		uploadDir:     t.TempDir(),
		secureCookies: true,
	}
	a, err := newApp(cfg, envFunc(map[string]string{"GEODE_PROFILESTORE_KEY": validProfilestoreKey()}))
	if err != nil {
		t.Fatalf("newApp: unexpected error: %v", err)
	}
	t.Cleanup(a.close)
	// The MCP endpoint must require auth (F-AUTH-1 wiring): an
	// unauthenticated JSON-RPC POST gets rejected, not served.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	req.Header.Set("Content-Type", "application/json")
	a.handler.ServeHTTP(rec, req)
	if rec.Code == http.StatusOK {
		t.Fatalf("POST /mcp without auth: want a non-200 (auth required), got 200 — MCPAuthVerifier not wired")
	}
}

// freeTCPAddr returns a 127.0.0.1:port that was free a moment ago. There
// is an inherent (small) race between releasing it and the caller
// re-binding; acceptable for a single local test.
func freeTCPAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	return addr
}

// jwtSecret32 returns a 32-byte HS256 secret for tests.
func jwtSecret32() []byte {
	b := make([]byte, 32)
	for i := range b {
		b[i] = 0xab
	}
	return b
}

// TestServe_GracefulShutdownErrorPropagates pins Q38 / #180: serve()
// returns the http.Server.Shutdown error wrapped in errGracefulShutdown
// when an in-flight request doesn't drain within the budget — so run()
// logs it (at WARN) and exits non-zero rather than discarding it.
func TestServe_GracefulShutdownErrorPropagates(t *testing.T) {
	issuer, err := jwt.NewIssuer(jwtSecret32(), time.Hour)
	if err != nil {
		t.Fatalf("NewIssuer: %v", err)
	}

	inFlight := make(chan struct{})
	a := &app{
		issuer:         issuer,
		shutdownBudget: 50 * time.Millisecond,
		httpSrv: &http.Server{
			Addr: freeTCPAddr(t),
			Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				select {
				case <-inFlight:
				default:
					close(inFlight)
				}
				// Block well past the shutdown budget so Shutdown times out.
				time.Sleep(2 * time.Second)
				w.WriteHeader(http.StatusOK)
			}),
			ReadHeaderTimeout: time.Second,
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	serveErr := make(chan error, 1)
	go func() { serveErr <- a.serve(ctx) }()

	// Wait for the listener, then fire a request that lands in the
	// blocking handler.
	deadline := time.Now().Add(3 * time.Second)
	var up bool
	for time.Now().Before(deadline) {
		c, derr := net.DialTimeout("tcp", a.httpSrv.Addr, 50*time.Millisecond)
		if derr == nil {
			_ = c.Close()
			up = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !up {
		t.Fatal("server did not come up")
	}
	go func() { _, _ = http.Get("http://" + a.httpSrv.Addr + "/") }()
	select {
	case <-inFlight:
	case <-time.After(3 * time.Second):
		t.Fatal("request never reached the handler")
	}

	// Trigger shutdown while the request is in flight.
	cancel()
	select {
	case e := <-serveErr:
		if e == nil {
			t.Fatal("serve returned nil; expected a graceful-shutdown timeout error")
		}
		if !errors.Is(e, errGracefulShutdown) {
			t.Fatalf("serve error %v is not wrapped in errGracefulShutdown", e)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("serve did not return within 5s of shutdown")
	}
	_ = a.httpSrv.Close()
}
