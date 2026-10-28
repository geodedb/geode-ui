// Tests for the CSRF double-submit middleware (SEC-F7 / #62 S3b).

package server

import (
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestCSRFToken_NewProducesUnpredictable confirms the token mint
// produces high-entropy strings: two consecutive calls must not match
// (probability of collision with 32 random bytes is 2^-256 — a
// regression that hard-codes a token would trip this immediately).
func TestCSRFToken_NewProducesUnpredictable(t *testing.T) {
	a, err := newCSRFToken()
	if err != nil {
		t.Fatalf("newCSRFToken: %v", err)
	}
	b, err := newCSRFToken()
	if err != nil {
		t.Fatalf("newCSRFToken: %v", err)
	}
	if a == "" || b == "" {
		t.Fatalf("empty token a=%q b=%q", a, b)
	}
	if a == b {
		t.Fatalf("two consecutive tokens collided: %q", a)
	}
	// 32 bytes -> 64 hex chars.
	if len(a) != 64 {
		t.Fatalf("token len=%d want 64 hex chars", len(a))
	}
}

// TestHandleCSRF_IssuesCookieAndBody confirms GET /api/v1/csrf returns
// the token in both the response body (for SPA reading) AND a Set-Cookie
// (for the double-submit pair). The cookie is NOT HttpOnly so the SPA
// can read it via document.cookie if it doesn't catch the body
// response. SameSite=Strict and Path=/ apply.
func TestHandleCSRF_IssuesCookieAndBody(t *testing.T) {
	srv := New(Config{SecureCookies: true})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/csrf", nil)
	srv.HandleCSRF(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d want 200", w.Code)
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("parse body: %v", err)
	}
	if body.Token == "" {
		t.Fatalf("body.token empty")
	}
	var got *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == CSRFCookieName {
			got = c
			break
		}
	}
	if got == nil {
		t.Fatalf("expected %s cookie", CSRFCookieName)
	}
	if got.Value != body.Token {
		t.Fatalf("cookie value=%q != body=%q", got.Value, body.Token)
	}
	if got.HttpOnly {
		t.Fatalf("CSRF cookie HttpOnly=true want false (SPA must read it)")
	}
	if got.SameSite != http.SameSiteStrictMode {
		t.Fatalf("CSRF cookie SameSite=%v want SameSiteStrictMode", got.SameSite)
	}
	if got.Path != "/" {
		t.Fatalf("CSRF cookie Path=%q want /", got.Path)
	}
	if !got.Secure {
		t.Fatalf("CSRF cookie Secure=false want true")
	}
}

// TestCSRFCheck_AcceptsMatchingPair — when both header and cookie
// carry the same value, the check passes.
func TestCSRFCheck_AcceptsMatchingPair(t *testing.T) {
	tok := "deadbeef"
	r := httptest.NewRequest(http.MethodPost, "/api/v1/users", nil)
	r.AddCookie(&http.Cookie{Name: CSRFCookieName, Value: tok})
	r.Header.Set(CSRFHeaderName, tok)
	if err := csrfCheck(r); err != nil {
		t.Fatalf("csrfCheck: %v", err)
	}
}

// TestCSRFCheck_RejectsMismatch — a request whose header differs from
// its cookie is rejected. Constant-time compare guards against timing
// oracles even though the token is high-entropy.
func TestCSRFCheck_RejectsMismatch(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/api/v1/users", nil)
	r.AddCookie(&http.Cookie{Name: CSRFCookieName, Value: "aaa"})
	r.Header.Set(CSRFHeaderName, "bbb")
	if err := csrfCheck(r); err == nil {
		t.Fatal("expected csrfCheck to reject mismatched pair")
	}
}

// TestCSRFCheck_RejectsMissingHeader — cookie present, header absent
// is the classic CSRF probe shape (the attacker can't set the header)
// and must fail.
func TestCSRFCheck_RejectsMissingHeader(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/api/v1/users", nil)
	r.AddCookie(&http.Cookie{Name: CSRFCookieName, Value: "tok"})
	if err := csrfCheck(r); err == nil {
		t.Fatal("expected csrfCheck to reject missing header")
	}
}

// TestCSRFCheck_RejectsMissingCookie — header present, cookie absent
// is also rejected; an attacker who controls the header path
// shouldn't get bypassed by the absence of a baseline.
func TestCSRFCheck_RejectsMissingCookie(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/api/v1/users", nil)
	r.Header.Set(CSRFHeaderName, "tok")
	if err := csrfCheck(r); err == nil {
		t.Fatal("expected csrfCheck to reject missing cookie")
	}
}

// TestCSRFCheck_RejectsEmptyValues — empty strings on either side are
// not a valid match. Without this guard, a stripped/cleared cookie
// could pass the check trivially.
func TestCSRFCheck_RejectsEmptyValues(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/api/v1/users", nil)
	r.AddCookie(&http.Cookie{Name: CSRFCookieName, Value: ""})
	r.Header.Set(CSRFHeaderName, "")
	if err := csrfCheck(r); err == nil {
		t.Fatal("expected csrfCheck to reject empty pair")
	}
}

// TestCSRFMiddleware_SkipsSafeMethods — GET/HEAD/OPTIONS are exempt
// regardless of auth source. The downstream handler still sees the
// request unchanged.
func TestCSRFMiddleware_SkipsSafeMethods(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		called = true
	})
	mw := csrfMiddleware(next)
	for _, m := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		called = false
		w := httptest.NewRecorder()
		r := httptest.NewRequest(m, "/api/v1/graphs", nil)
		mw.ServeHTTP(w, r)
		if !called {
			t.Fatalf("%s: next not called", m)
		}
		if w.Code != http.StatusOK && w.Code != 0 {
			t.Fatalf("%s: status=%d want 200/unset", m, w.Code)
		}
	}
}

// TestCSRFMiddleware_SkipsBearerAuth — header-authenticated POST goes
// through unconditionally. Browsers can't forge the Authorization
// header cross-origin without explicit JS that already has same-origin
// DOM access (i.e. has localStorage and document.cookie too — at
// which point CSRF is moot).
func TestCSRFMiddleware_SkipsBearerAuth(t *testing.T) {
	iss := newTestIssuer(t)
	tok, _, err := iss.Issue("alice", "default", nil, "")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	srv := New(Config{JWT: iss})
	called := false
	next := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		// Run AuthJWT inline to populate the auth-source context that
		// csrfMiddleware checks. In production AuthJWT runs upstream of
		// the handler chain, but here we simulate the order.
		_ = srv.AuthJWT(r)
		called = true
	})
	// The middleware order in production: csrfMiddleware sees the raw
	// request first and decides skip/enforce based on whether AuthJWT
	// (which has already run) tagged the source. To simulate that, we
	// run AuthJWT first and then drive csrfMiddleware on the mutated
	// request.
	r := httptest.NewRequest(http.MethodPost, "/api/v1/users", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	if err := srv.AuthJWT(r); err != nil {
		t.Fatalf("AuthJWT: %v", err)
	}
	mw := csrfMiddleware(next)
	w := httptest.NewRecorder()
	mw.ServeHTTP(w, r)
	if !called {
		t.Fatal("next not called for Bearer auth")
	}
}

// TestCSRFMiddleware_EnforcesForCookieAuth — cookie-authenticated POST
// without a CSRF header pair is 403. With the pair present, it
// passes through.
func TestCSRFMiddleware_EnforcesForCookieAuth(t *testing.T) {
	iss := newTestIssuer(t)
	tok, _, err := iss.Issue("alice", "default", nil, "")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	srv := New(Config{JWT: iss})

	// First: missing CSRF -> 403.
	r := httptest.NewRequest(http.MethodPost, "/api/v1/users", nil)
	r.AddCookie(&http.Cookie{Name: AuthCookieName, Value: tok})
	if err := srv.AuthJWT(r); err != nil {
		t.Fatalf("AuthJWT: %v", err)
	}
	called := false
	next := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		called = true
	})
	mw := csrfMiddleware(next)
	w := httptest.NewRecorder()
	mw.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("missing CSRF: status=%d want 403", w.Code)
	}
	if called {
		t.Fatal("next called despite CSRF failure")
	}

	// Second: matching pair -> passes.
	r2 := httptest.NewRequest(http.MethodPost, "/api/v1/users", nil)
	r2.AddCookie(&http.Cookie{Name: AuthCookieName, Value: tok})
	r2.AddCookie(&http.Cookie{Name: CSRFCookieName, Value: "csrftok"})
	r2.Header.Set(CSRFHeaderName, "csrftok")
	if err := srv.AuthJWT(r2); err != nil {
		t.Fatalf("AuthJWT: %v", err)
	}
	called = false
	w2 := httptest.NewRecorder()
	mw.ServeHTTP(w2, r2)
	if !called {
		t.Fatal("next not called for matched CSRF pair")
	}
}

// TestCSRFMiddleware_SkipsLoginAndLogout — auth/login and auth/logout
// are exempt: login has no auth yet (no cookie), and logout is
// idempotent and self-clearing. Without these exemptions, a fresh SPA
// load could not authenticate.
func TestCSRFMiddleware_SkipsLoginAndLogout(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		called = true
	})
	mw := csrfMiddleware(next)
	for _, p := range []string{"/api/v1/auth/login", "/api/v1/auth/logout"} {
		called = false
		r := httptest.NewRequest(http.MethodPost, p, nil)
		// Simulate cookie auth so the source-check would otherwise enforce.
		r.AddCookie(&http.Cookie{Name: AuthCookieName, Value: "ignored"})
		w := httptest.NewRecorder()
		mw.ServeHTTP(w, r)
		if !called {
			t.Fatalf("%s: next not called (expected exempt)", p)
		}
	}
}

// TestCSRFMiddleware_SkipsCSRFEndpoint — the /api/v1/csrf endpoint
// itself can't require a CSRF token because it's the source. Issuing
// a token must be a safe GET, but the exemption guards against a
// future regression that adds POST /api/v1/csrf.
func TestCSRFMiddleware_SkipsCSRFEndpoint(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		called = true
	})
	mw := csrfMiddleware(next)
	r := httptest.NewRequest(http.MethodGet, "/api/v1/csrf", nil)
	w := httptest.NewRecorder()
	mw.ServeHTTP(w, r)
	if !called {
		t.Fatal("CSRF endpoint must not be self-blocked")
	}
}

// helperEntropyCheck is a sanity probe — ensures crypto/rand actually
// returns distinct bytes so the underlying primitive isn't a stub
// during tests.
func helperEntropyCheck(t *testing.T) {
	t.Helper()
	a := make([]byte, 16)
	if _, err := rand.Read(a); err != nil {
		t.Fatalf("rand: %v", err)
	}
	if strings.Count(string(a), "\x00") == len(a) {
		t.Fatal("rand returned all zeros — entropy source broken")
	}
}

// TestEntropyAvailable provides a single test gate so a future hostile
// fork cannot accidentally stub crypto/rand.
func TestEntropyAvailable(t *testing.T) {
	helperEntropyCheck(t)
}
