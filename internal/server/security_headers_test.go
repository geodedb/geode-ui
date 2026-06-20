package server

import (
	"bytes"
	"log/slog"
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
		"connect-src 'self'",
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

// TestCSPDirective_ConnectSrcOmitsWildcardWss pins SEC-NEW (#266): the
// connect-src directive must NOT enumerate the bare "wss:" scheme token,
// which would allow XHR/fetch/WebSocket connections to *any* origin over
// wss. Same-origin wss:// is already covered by 'self', so the wildcard
// scheme is a defense-in-depth regression risk with no functional gain.
//
// The test inspects the CSPDirective constant directly rather than going
// through the wrapper, so a future refactor that splits the directive
// can't silently re-introduce the wildcard.
func TestCSPDirective_ConnectSrcOmitsWildcardWss(t *testing.T) {
	t.Parallel()
	if !strings.Contains(CSPDirective, "connect-src 'self'") {
		t.Fatalf("CSPDirective missing connect-src 'self' anchor; got %q", CSPDirective)
	}
	// A literal " wss:" or " wss; " (the trailing-delimiter forms used in
	// the original directive) must not appear in connect-src or any other
	// directive — there is no production path that needs cross-origin wss.
	for _, bad := range []string{" wss:;", " wss:\n", " wss: "} {
		if strings.Contains(CSPDirective+";", bad) {
			t.Errorf("CSPDirective contains forbidden wildcard wss token %q; got %q",
				bad, CSPDirective)
		}
	}
	// Belt-and-braces: the connect-src directive specifically must end at
	// 'self' (followed by directive-terminator `;`) and not enumerate a
	// scheme wildcard.
	if !strings.Contains(CSPDirective, "connect-src 'self';") {
		t.Errorf("connect-src not terminated immediately after 'self'; "+
			"a non-'self' source has been re-introduced. got %q", CSPDirective)
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

// TestCSPOverridesInheritedStrictDefault_SPA pins the production regression
// where genapi v0.11.1's httpx.WrapHandler began emitting a global
// `Content-Security-Policy: default-src 'none'` on EVERY response. Because
// the SPA security wrapper previously applied its permissive policy only
// when the header was empty (set-if-empty), the SPA HTML document shipped
// `default-src 'none'`, the browser blocked main.*.js / vendors.*.js / CSS,
// and the SPA never booted (all UI e2e specs failed).
//
// The wrapper MUST OVERRIDE the inherited strict default on HTML responses
// with the permissive SPA directive so the app's own bundle loads.
func TestCSPOverridesInheritedStrictDefault_SPA(t *testing.T) {
	t.Parallel()
	htmlInner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("<!DOCTYPE html><html></html>"))
	})
	h := WithSPASecurityHeaders(htmlInner)

	rec := httptest.NewRecorder()
	// Simulate the global httpx.WrapHandler header already on the response
	// before the SPA handler runs.
	rec.Header().Set("Content-Security-Policy", "default-src 'none'")
	rec.Header().Set("Cross-Origin-Opener-Policy", "unsafe-none")
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	h.ServeHTTP(rec, req)

	csp := rec.Header().Get("Content-Security-Policy")
	if strings.Contains(csp, "default-src 'none'") {
		t.Fatalf("inherited strict CSP not overridden on SPA HTML; got %q", csp)
	}
	if csp != CSPDirective {
		t.Fatalf("SPA CSP = %q, want permissive CSPDirective %q", csp, CSPDirective)
	}
	for _, d := range []string{
		"default-src 'self'",
		"script-src 'self' 'wasm-unsafe-eval'",
		"style-src 'self' 'unsafe-inline'",
	} {
		if !strings.Contains(csp, d) {
			t.Errorf("SPA CSP missing directive %q; got %q", d, csp)
		}
	}
	if coop := rec.Header().Get("Cross-Origin-Opener-Policy"); coop != COOPDirective {
		t.Errorf("COOP=%q want %q (inherited value must be overridden)", coop, COOPDirective)
	}
}

// TestCSPPreservesInheritedStrictDefault_NonHTML pins the other half of the
// SEC-0023 hardening: the strict global `default-src 'none'` default emitted
// by httpx.WrapHandler MUST be preserved on non-HTML (API JSON / asset)
// responses. The SPA wrapper must not globally weaken CSP.
func TestCSPPreservesInheritedStrictDefault_NonHTML(t *testing.T) {
	t.Parallel()
	jsonInner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	h := WithSPASecurityHeaders(jsonInner)

	rec := httptest.NewRecorder()
	rec.Header().Set("Content-Security-Policy", "default-src 'none'")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/healthz", nil)
	h.ServeHTTP(rec, req)

	if csp := rec.Header().Get("Content-Security-Policy"); csp != "default-src 'none'" {
		t.Fatalf("strict CSP not preserved on JSON response; got %q", csp)
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

// TestAccessTokenDeprecation_EmitsAuditEvent_SEC_NEW_6 pins SEC-NEW-6
// (#206): the WithAccessTokenDeprecation wrapper must emit an
// audit_event=access_token_query record whenever it encounters a request
// using the deprecated ?access_token= query fallback. The audit emission
// is rate-limited per source (path) to avoid log floods; the implementation
// is exercised with a manual clock injection so the test is deterministic.
func TestAccessTokenDeprecation_EmitsAuditEvent_SEC_NEW_6(t *testing.T) {
	t.Cleanup(resetAuditRing())
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	// Reset the limiter state so prior tests don't suppress emission.
	resetAccessTokenAuditLimiter()
	t.Cleanup(resetAccessTokenAuditLimiter)

	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h := WithAccessTokenDeprecation(inner)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/whoami?access_token=t", nil)
	req.Header.Set("User-Agent", "test-agent/1.0")
	h.ServeHTTP(rec, req)

	out := buf.String()
	if !strings.Contains(out, `"event":"access_token_query"`) {
		t.Fatalf("SEC-NEW-6 #206: missing access_token_query audit event\nlog: %s", out)
	}
	if !strings.Contains(out, `"path":"/api/v1/whoami"`) {
		t.Fatalf("SEC-NEW-6 #206: access_token_query audit missing path field\nlog: %s", out)
	}
	if !strings.Contains(out, `"user_agent":"test-agent/1.0"`) {
		t.Fatalf("SEC-NEW-6 #206: access_token_query audit missing user_agent field\nlog: %s", out)
	}
}

// TestAccessTokenDeprecation_RateLimitsAuditEmission_SEC_NEW_6 pins that
// repeated requests using the deprecated query parameter from the same
// path do NOT each fire an audit emission — the implementation uses a
// per-path token bucket to cap noise. The first request emits; the
// immediately-following one is suppressed.
func TestAccessTokenDeprecation_RateLimitsAuditEmission_SEC_NEW_6(t *testing.T) {
	t.Cleanup(resetAuditRing())
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	resetAccessTokenAuditLimiter()
	t.Cleanup(resetAccessTokenAuditLimiter)

	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := WithAccessTokenDeprecation(inner)
	for i := 0; i < 5; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/whoami?access_token=t", nil)
		h.ServeHTTP(rec, req)
	}
	out := buf.String()
	got := strings.Count(out, `"event":"access_token_query"`)
	// Exact upper bound is implementation-detail (1 per path per window),
	// but more than 2 here is a regression — the limiter is too generous.
	if got < 1 {
		t.Fatalf("SEC-NEW-6 #206: rate-limited audit emitted %d times, want >=1 (limiter starved everyone)\nlog: %s", got, out)
	}
	if got > 2 {
		t.Fatalf("SEC-NEW-6 #206: rate-limited audit emitted %d times for 5 requests, want <=2 (limiter not throttling)\nlog: %s", got, out)
	}
}

// TestAccessTokenDeprecation_IncrementsPromCounter_SEC_NEW_6 pins the
// other half of SEC-NEW-6: a Prometheus-shaped counter
// security.access_token_query.total must increment on every access-token
// query request (no rate limiting on the counter — counters are cheap
// and integrators want true counts).
func TestAccessTokenDeprecation_IncrementsPromCounter_SEC_NEW_6(t *testing.T) {
	resetAccessTokenAuditLimiter()
	t.Cleanup(resetAccessTokenAuditLimiter)

	// Capture the counter snapshot via the test hook.
	before := accessTokenQueryTotal()
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := WithAccessTokenDeprecation(inner)
	for i := 0; i < 3; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/whoami?access_token=t", nil)
		h.ServeHTTP(rec, req)
	}
	after := accessTokenQueryTotal()
	if delta := after - before; delta != 3 {
		t.Fatalf("SEC-NEW-6 #206: counter incremented by %d, want 3", delta)
	}
}

// TestAccessTokenDeprecation_NoAuditOrCounterWhenAbsent pins that the
// audit + counter only fire when the query parameter is actually present.
// A regression here would fire the alarm on every request.
func TestAccessTokenDeprecation_NoAuditOrCounterWhenAbsent(t *testing.T) {
	t.Cleanup(resetAuditRing())
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	resetAccessTokenAuditLimiter()
	t.Cleanup(resetAccessTokenAuditLimiter)

	before := accessTokenQueryTotal()
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := WithAccessTokenDeprecation(inner)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/whoami", nil)
	req.Header.Set("Authorization", "Bearer abc")
	h.ServeHTTP(rec, req)

	if strings.Contains(buf.String(), `"event":"access_token_query"`) {
		t.Fatalf("SEC-NEW-6 #206: audit emitted for header-authed request: %s", buf.String())
	}
	if got := accessTokenQueryTotal() - before; got != 0 {
		t.Fatalf("SEC-NEW-6 #206: counter incremented by %d for header-authed request, want 0", got)
	}
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
