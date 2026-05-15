package httpx

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHeadersAndCORS(t *testing.T) {
	cfg := Config{CORSEnabled: true, CORSOrigins: []string{"https://allowed.example"}}
	base := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	h := headers(base, cfg)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x", nil)
	r.Header.Set("Origin", "https://allowed.example")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Header().Get("Strict-Transport-Security") == "" || w.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("security headers missing")
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "https://allowed.example" {
		t.Fatalf("cors not applied: %q", got)
	}
}

func TestCORS_NotAllowed(t *testing.T) {
	cfg := Config{CORSEnabled: true, CORSOrigins: []string{"https://allowed.example"}}
	base := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	h := headers(base, cfg)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x", nil)
	r.Header.Set("Origin", "https://other.example")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("unexpected CORS allow: %q", got)
	}
}

func TestCORS_PreflightAllowed(t *testing.T) {
	cfg := Config{CORSEnabled: true, CORSOrigins: []string{"https://allowed.example"}}
	base := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	h := headers(base, cfg)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodOptions, "/x", nil)
	r.Header.Set("Origin", "https://allowed.example")
	r.Header.Set("Access-Control-Request-Method", "POST")
	r.Header.Set("Access-Control-Request-Headers", "Content-Type, Authorization")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", w.Code)
	}
	if w.Header().Get("Access-Control-Allow-Origin") == "" || w.Header().Get("Access-Control-Allow-Methods") == "" {
		t.Fatalf("missing preflight headers")
	}
}

func TestCORS_PreflightDisallowed(t *testing.T) {
	cfg := Config{CORSEnabled: true, CORSOrigins: []string{"https://allowed.example"}}
	base := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	h := headers(base, cfg)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodOptions, "/x", nil)
	r.Header.Set("Origin", "https://notallowed.example")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code == http.StatusNoContent && w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("should not set CORS for disallowed origin")
	}
}

func TestCORS_DisabledIgnoresOrigins(t *testing.T) {
	cfg := Config{CORSEnabled: false, CORSOrigins: []string{"https://allowed.example"}}
	base := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	h := headers(base, cfg)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x", nil)
	r.Header.Set("Origin", "https://allowed.example")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("expected no CORS headers when disabled, got %q", got)
	}
}

// TestValidateConfig_RejectsCORSWildcard covers SEC-N5: when CORS is enabled
// and any configured origin is the literal "*", ValidateConfig must return
// ErrCORSWildcardWithCredentials. Allowing "*" is forbidden by the CORS spec
// once credentials are attached and is a common production misconfiguration;
// rejecting it at startup makes the regression discoverable in CI.
func TestValidateConfig_RejectsCORSWildcard(t *testing.T) {
	cases := []struct {
		name    string
		cfg     Config
		wantErr error
	}{
		{
			name:    "wildcard only",
			cfg:     Config{CORSEnabled: true, CORSOrigins: []string{"*"}},
			wantErr: ErrCORSWildcardWithCredentials,
		},
		{
			name:    "wildcard among explicit origins",
			cfg:     Config{CORSEnabled: true, CORSOrigins: []string{"https://ok.example", "*"}},
			wantErr: ErrCORSWildcardWithCredentials,
		},
		{
			name:    "explicit origins only is OK",
			cfg:     Config{CORSEnabled: true, CORSOrigins: []string{"https://ok.example"}},
			wantErr: nil,
		},
		{
			name:    "wildcard with CORS disabled is OK (CORS not applied)",
			cfg:     Config{CORSEnabled: false, CORSOrigins: []string{"*"}},
			wantErr: nil,
		},
		{
			name:    "empty origins, CORS enabled is OK",
			cfg:     Config{CORSEnabled: true, CORSOrigins: nil},
			wantErr: nil,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateConfig(c.cfg)
			if !errors.Is(err, c.wantErr) {
				t.Fatalf("ValidateConfig(%+v) = %v, want %v", c.cfg, err, c.wantErr)
			}
		})
	}
}

// TestWrapHandler_PanicsOnCORSWildcard locks in the startup-fail behavior of
// WrapHandler so a future refactor cannot silently downgrade to a soft-warn.
func TestWrapHandler_PanicsOnCORSWildcard(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatalf("expected WrapHandler to panic on CORS wildcard with credentials")
		}
		err, ok := r.(error)
		if !ok || !errors.Is(err, ErrCORSWildcardWithCredentials) {
			t.Fatalf("expected panic with ErrCORSWildcardWithCredentials, got %T(%v)", r, r)
		}
	}()
	cfg := Config{CORSEnabled: true, CORSOrigins: []string{"*"}}
	base := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	_ = WrapHandler(cfg, base)
}

// TestServe_ReturnsErrOnCORSWildcard verifies Serve returns the sentinel
// instead of binding the listener when CORS is misconfigured.
func TestServe_ReturnsErrOnCORSWildcard(t *testing.T) {
	cfg := Config{
		CORSEnabled: true,
		CORSOrigins: []string{"*"},
		Bind:        "127.0.0.1:0",
	}
	mux := http.NewServeMux()
	err := Serve(context.Background(), cfg, mux)
	if !errors.Is(err, ErrCORSWildcardWithCredentials) {
		t.Fatalf("Serve returned %v, want %v", err, ErrCORSWildcardWithCredentials)
	}
}
