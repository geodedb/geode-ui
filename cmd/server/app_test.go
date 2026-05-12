package main

import (
	"bytes"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
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
