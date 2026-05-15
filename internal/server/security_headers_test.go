package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestPermissionsPolicyAppliedGlobally asserts that Permissions-Policy is
// emitted on every response, including API responses, because the directive
// is short and harmless and protects every browser-served surface.
func TestPermissionsPolicyAppliedGlobally(t *testing.T) {
	t.Parallel()
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	h := WithPermissionsPolicy(inner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/healthz", nil)
	h.ServeHTTP(rec, req)

	got := rec.Header().Get("Permissions-Policy")
	if got == "" {
		t.Fatalf("Permissions-Policy header missing on API response")
	}
	for _, want := range []string{"camera=()", "microphone=()", "geolocation=()", "interest-cohort=()"} {
		if !strings.Contains(got, want) {
			t.Errorf("Permissions-Policy missing %q; got %q", want, got)
		}
	}
}

// TestCSPAppliedToSPAResponses asserts the SPA wrapper adds CSP and COOP
// to HTML responses (the SPA path).
func TestCSPAppliedToSPAResponses(t *testing.T) {
	t.Parallel()
	htmlInner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("<!DOCTYPE html><html></html>"))
	})
	h := WithSPASecurityHeaders(htmlInner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	h.ServeHTTP(rec, req)

	csp := rec.Header().Get("Content-Security-Policy")
	if csp == "" {
		t.Fatalf("Content-Security-Policy header missing on SPA response")
	}
	wantDirectives := []string{
		"default-src 'self'",
		"script-src 'self' 'wasm-unsafe-eval'",
		"style-src 'self' 'unsafe-inline'",
		"worker-src 'self' blob:",
		"connect-src 'self' wss:",
		"img-src 'self' data:",
		"font-src 'self' data:",
		"frame-ancestors 'none'",
		"base-uri 'none'",
		"form-action 'self'",
		"object-src 'none'",
	}
	for _, d := range wantDirectives {
		if !strings.Contains(csp, d) {
			t.Errorf("CSP missing directive %q; got %q", d, csp)
		}
	}

	coop := rec.Header().Get("Cross-Origin-Opener-Policy")
	if coop != "same-origin" {
		t.Errorf("Cross-Origin-Opener-Policy=%q want %q", coop, "same-origin")
	}
}

// TestCSPNotAppliedToJSONResponses asserts the SPA wrapper does NOT add CSP
// to non-HTML responses (e.g. when the inner handler emits application/json).
// The wrapper sniffs Content-Type after the inner writes.
func TestCSPNotAppliedToJSONResponses(t *testing.T) {
	t.Parallel()
	jsonInner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	h := WithSPASecurityHeaders(jsonInner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/some-asset.json", nil)
	h.ServeHTTP(rec, req)

	if csp := rec.Header().Get("Content-Security-Policy"); csp != "" {
		t.Errorf("CSP unexpectedly applied to JSON response: %q", csp)
	}
	// COOP should also be skipped for JSON.
	if coop := rec.Header().Get("Cross-Origin-Opener-Policy"); coop != "" {
		t.Errorf("COOP unexpectedly applied to JSON response: %q", coop)
	}
}

// TestAccessTokenDeprecation asserts the SEC-F5 (#71) wrapper emits
// Deprecation/Sunset/Link headers when (and only when) ?access_token=
// is present on the request URL.
func TestAccessTokenDeprecation(t *testing.T) {
	t.Parallel()
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h := WithAccessTokenDeprecation(inner)

	t.Run("emits headers when query token is present", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(
			http.MethodGet, "/api/v1/whoami?access_token=t", nil,
		)
		h.ServeHTTP(rec, req)
		if got := rec.Header().Get("Deprecation"); got != "true" {
			t.Errorf("Deprecation=%q want %q", got, "true")
		}
		if got := rec.Header().Get("Sunset"); got != AccessTokenSunsetDate {
			t.Errorf("Sunset=%q want %q", got, AccessTokenSunsetDate)
		}
		if got := rec.Header().Get("Link"); !strings.Contains(got, `rel="deprecation"`) {
			t.Errorf("Link header missing deprecation link: %q", got)
		}
	})

	t.Run("no headers when no query token", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/whoami", nil)
		req.Header.Set("Authorization", "Bearer abc")
		h.ServeHTTP(rec, req)
		if got := rec.Header().Get("Deprecation"); got != "" {
			t.Errorf("Deprecation header unexpectedly set: %q", got)
		}
		if got := rec.Header().Get("Sunset"); got != "" {
			t.Errorf("Sunset header unexpectedly set: %q", got)
		}
	})
}

// TestSPAImplicitHTML asserts that when the inner handler does not set a
// Content-Type (the typical embed.FS FileServer path serving index.html),
// the wrapper detects HTML by sniffing the body and applies CSP+COOP.
func TestSPAImplicitHTML(t *testing.T) {
	t.Parallel()
	// Mimic the SPA fallback handler — write HTML body without explicitly
	// setting Content-Type, so net/http's DetectContentType determines it.
	htmlInner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<!DOCTYPE html><html><body></body></html>"))
	})
	h := WithSPASecurityHeaders(htmlInner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	h.ServeHTTP(rec, req)

	if csp := rec.Header().Get("Content-Security-Policy"); csp == "" {
		t.Fatalf("CSP missing for implicit-HTML SPA response")
	}
	if coop := rec.Header().Get("Cross-Origin-Opener-Policy"); coop != "same-origin" {
		t.Errorf("COOP=%q want same-origin for implicit HTML", coop)
	}
}
