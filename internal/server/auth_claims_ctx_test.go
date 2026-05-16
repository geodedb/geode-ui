package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"geodedb.com/geode-ui/gen/pkg/securex"
)

// TestAuthJWT_StashesClaimsInContext (S-NEW-3) proves the geode-ui
// AuthJWT verifier populates the request context with a
// *securex.Claims via securex.ContextWithClaims. The generated
// per-route authz middleware (gen/api/handlers_gen.go, post-genapi
// v0.3.2) reads this stash instead of re-parsing Authorization:
// Bearer.
//
// Pre-S-NEW-3 the verifier set r.Header["Authorization"] explicitly
// for cookie/query-mode requests so the downstream re-parse would
// succeed. That shim is now obsolete; this test ensures the
// replacement path is active.
func TestAuthJWT_StashesClaimsInContext(t *testing.T) {
	iss := newTestIssuer(t)
	srv := New(Config{JWT: iss})
	tok, _, err := iss.Issue("alice", "default", []string{"admin"}, "")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/op", nil)
	r.AddCookie(&http.Cookie{Name: AuthCookieName, Value: tok})

	if err := srv.AuthJWT(r); err != nil {
		t.Fatalf("AuthJWT: %v", err)
	}

	claims, ok := securex.ClaimsFromContext(r.Context())
	if !ok {
		t.Fatalf("ClaimsFromContext returned ok=false after successful AuthJWT")
	}
	if claims.Subject != "alice" {
		t.Fatalf("claims.Subject = %q, want alice", claims.Subject)
	}
	if claims.HighestRole() != securex.RoleAdmin {
		t.Fatalf("claims.HighestRole() = %v, want RoleAdmin", claims.HighestRole())
	}
}

// TestAuthJWT_NoHeaderShimOnCookieAuth (S-NEW-3) proves the
// Authorization-header shim is gone: a cookie-authenticated request
// must end AuthJWT without an Authorization header set, because the
// generated middleware now reads claims from r.Context() and no
// longer needs the header re-set.
//
// If a future regression re-introduces the shim, this test catches
// it before the next gap-close run.
func TestAuthJWT_NoHeaderShimOnCookieAuth(t *testing.T) {
	iss := newTestIssuer(t)
	srv := New(Config{JWT: iss})
	tok, _, err := iss.Issue("alice", "default", []string{"admin"}, "")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/op", nil)
	r.AddCookie(&http.Cookie{Name: AuthCookieName, Value: tok})

	if err := srv.AuthJWT(r); err != nil {
		t.Fatalf("AuthJWT: %v", err)
	}

	if got := r.Header.Get("Authorization"); got != "" {
		t.Fatalf("Authorization header was mutated by AuthJWT to %q; expected empty (no shim)", got)
	}
}

// TestAuthJWT_HeaderAuthLeavesHeaderIntact proves the original
// header-based auth path is unchanged: a request with a Bearer
// header should keep that header after AuthJWT (we never deleted
// it before, and we shouldn't delete it now).
func TestAuthJWT_HeaderAuthLeavesHeaderIntact(t *testing.T) {
	iss := newTestIssuer(t)
	srv := New(Config{JWT: iss})
	tok, _, err := iss.Issue("alice", "default", []string{"admin"}, "")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/op", nil)
	r.Header.Set("Authorization", "Bearer "+tok)

	if err := srv.AuthJWT(r); err != nil {
		t.Fatalf("AuthJWT: %v", err)
	}

	if got := r.Header.Get("Authorization"); got != "Bearer "+tok {
		t.Fatalf("Authorization header was mutated by AuthJWT: got %q want %q", got, "Bearer "+tok)
	}
	claims, ok := securex.ClaimsFromContext(r.Context())
	if !ok {
		t.Fatalf("ClaimsFromContext should also work for header-auth path")
	}
	if claims.Subject != "alice" {
		t.Fatalf("claims.Subject = %q, want alice", claims.Subject)
	}
}

// TestAuthJWT_ClaimsMapping_ProfileToAttributes (S-NEW-3) proves the
// geode jwt.Claims.Profile field is forwarded into
// securex.Claims.Attributes["profile"] so the generated
// required_attributes policy can enforce per-profile gating without
// a separate registry lookup.
func TestAuthJWT_ClaimsMapping_ProfileToAttributes(t *testing.T) {
	iss := newTestIssuer(t)
	srv := New(Config{JWT: iss})
	tok, _, err := iss.Issue("alice", "tenant-7", nil, "conn-abc")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	r := httptest.NewRequest(http.MethodGet, "/api/v1/whoami", nil)
	r.Header.Set("Authorization", "Bearer "+tok)

	if err := srv.AuthJWT(r); err != nil {
		t.Fatalf("AuthJWT: %v", err)
	}

	claims, ok := securex.ClaimsFromContext(r.Context())
	if !ok {
		t.Fatalf("ClaimsFromContext returned ok=false")
	}
	if got := claims.Attributes["profile"]; got != "tenant-7" {
		t.Fatalf("Attributes[\"profile\"] = %q, want tenant-7", got)
	}
	if got := claims.Attributes["cid"]; got != "conn-abc" {
		t.Fatalf("Attributes[\"cid\"] = %q, want conn-abc", got)
	}
}
