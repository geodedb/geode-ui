package httpx

import (
	"context"
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
