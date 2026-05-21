package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Bug 2 (2026-05-21 bug-fix bundle): coverage for the cookie-driven
// session-rehydration endpoint. Each test mirrors a real-world bootstrap
// path the SPA exercises on first paint after a browser refresh.

// TestWhoAmI_NoIssuer pins that a server constructed without a JWT
// Issuer 401s rather than panicking. Production never runs in this
// shape, but unit-test paths that exercise other handlers without
// wiring an issuer must not crash if they accidentally hit whoami.
func TestWhoAmI_NoIssuer(t *testing.T) {
	srv := New(Config{}) // no JWT
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/whoami", nil)
	srv.HandleWhoAmI(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401", rec.Code)
	}
}

// TestWhoAmI_NoToken pins the unauthenticated-probe path: a refresh
// before any login attaches no cookie or header; the SPA expects a
// 401 so ProtectedRoute routes to /login on first paint.
func TestWhoAmI_NoToken(t *testing.T) {
	srv := New(Config{JWT: newTestIssuer(t)})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/whoami", nil)
	srv.HandleWhoAmI(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), ErrCodeUnauthorized) {
		t.Fatalf("body=%s want %q", rec.Body.String(), ErrCodeUnauthorized)
	}
}

// TestWhoAmI_BearerTokenReturnsClaims is the canonical happy path:
// a valid token delivered as Authorization: Bearer mirrors the
// claims back to the caller.
func TestWhoAmI_BearerTokenReturnsClaims(t *testing.T) {
	iss := newTestIssuer(t)
	srv := New(Config{JWT: iss})
	tok, _, err := iss.Issue("alice", "default", []string{"reader", "admin"}, "conn-42")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/whoami", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	srv.HandleWhoAmI(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s want 200", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type=%q want application/json...", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control=%q want no-store (claims are session-bound)", cc)
	}

	var got WhoAmIResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v body=%s", err, rec.Body.String())
	}
	if got.Sub != "alice" {
		t.Errorf("Sub=%q want alice", got.Sub)
	}
	if got.Profile != "default" {
		t.Errorf("Profile=%q want default", got.Profile)
	}
	if got.ConnectionID != "conn-42" {
		t.Errorf("ConnectionID=%q want conn-42", got.ConnectionID)
	}
	if len(got.Roles) != 2 || got.Roles[0] != "reader" || got.Roles[1] != "admin" {
		t.Errorf("Roles=%v want [reader admin]", got.Roles)
	}
	if got.ExpiresAt == 0 {
		t.Error("ExpiresAt=0 want non-zero (issued tokens carry exp)")
	}
}

// TestWhoAmI_CookieTransport pins the actual user-facing flow: after a
// browser refresh, the only thing the request carries is the HttpOnly
// `geode-ui-auth` cookie. The whoami handler must extract from the
// cookie just like AuthJWT does for any other route.
func TestWhoAmI_CookieTransport(t *testing.T) {
	iss := newTestIssuer(t)
	srv := New(Config{JWT: iss})
	tok, _, err := iss.Issue("bob", "default", []string{"reader"}, "")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/whoami", nil)
	req.AddCookie(&http.Cookie{Name: AuthCookieName, Value: tok})
	srv.HandleWhoAmI(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s want 200 (cookie transport)", rec.Code, rec.Body.String())
	}
	var got WhoAmIResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Sub != "bob" {
		t.Errorf("Sub=%q want bob", got.Sub)
	}
}

// TestWhoAmI_RevokedToken pins SEC-N2 alignment: a token whose JTI has
// been revoked (e.g. after a password change for the user) must
// surface as 401 from whoami so the SPA refreshes its session posture
// rather than continuing to believe a stale cookie is valid.
func TestWhoAmI_RevokedToken(t *testing.T) {
	iss := newTestIssuer(t)
	srv := New(Config{JWT: iss})
	tok, _, err := iss.Issue("carol", "default", nil, "")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	// Sanity: token valid pre-revoke.
	if _, err := iss.Parse(tok); err != nil {
		t.Fatalf("pre-revoke Parse: %v", err)
	}
	// Revoke the user wholesale (mirrors what a password change does).
	iss.Revocation().RevokeUser("carol")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/whoami", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	srv.HandleWhoAmI(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401 (revoked)", rec.Code)
	}
}

// TestWhoAmI_MethodNotAllowed pins the GET-only contract. A POST is
// rejected with 405 + an Allow header; the SPA should never POST here
// but a probing client must get a clean rejection.
func TestWhoAmI_MethodNotAllowed(t *testing.T) {
	srv := New(Config{JWT: newTestIssuer(t)})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/whoami", nil)
	srv.HandleWhoAmI(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status=%d want 405", rec.Code)
	}
	if allow := rec.Header().Get("Allow"); allow != http.MethodGet {
		t.Errorf("Allow=%q want GET", allow)
	}
}

// TestWhoAmI_NoMutationToContext pins a behavioural invariant: the
// whoami handler must NOT call AuthJWT (which mutates the *r in place
// to enrich context). The endpoint is a read-back of claims; if it
// ever starts side-effecting on the request context, downstream
// handlers wrapped through the same mux could observe the change.
//
// Black-box assertion: the request context after HandleWhoAmI runs
// has the same `userCtxKey` slot as before (empty / nil).
func TestWhoAmI_NoMutationToContext(t *testing.T) {
	iss := newTestIssuer(t)
	srv := New(Config{JWT: iss})
	tok, _, err := iss.Issue("dave", "default", []string{"reader"}, "")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/whoami", nil)
	req.Header.Set("Authorization", "Bearer "+tok)

	srv.HandleWhoAmI(rec, req)

	if v := req.Context().Value(userCtxKey); v != nil {
		t.Errorf("HandleWhoAmI mutated request context userCtxKey=%v; want nil (read-only handler)", v)
	}
}
