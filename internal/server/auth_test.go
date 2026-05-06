package server

import (
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"geodedb.com/geode-ui/internal/jwt"
)

// newTestIssuer constructs a *jwt.Issuer with a fresh 32-byte random
// secret and a 1-hour TTL, suitable for AuthJWT round-trip tests.
func newTestIssuer(t *testing.T) *jwt.Issuer {
	t.Helper()
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		t.Fatalf("rand: %v", err)
	}
	iss, err := jwt.NewIssuer(b, time.Hour)
	if err != nil {
		t.Fatalf("NewIssuer: %v", err)
	}
	return iss
}

// TestAuthJWT_NoIssuer confirms that a server constructed without a
// JWT issuer rejects every request rather than letting an unsigned
// caller through.
func TestAuthJWT_NoIssuer(t *testing.T) {
	srv := New(Config{}) // no JWT
	r := httptest.NewRequest(http.MethodGet, "/api/v1/graphs", nil)
	r.Header.Set("Authorization", "Bearer anything")
	if err := srv.AuthJWT(r); err == nil {
		t.Fatal("expected error when issuer not configured")
	}
}

// TestAuthJWT_MissingHeader confirms requests with neither
// Authorization header nor ?access_token= query param are rejected.
func TestAuthJWT_MissingHeader(t *testing.T) {
	srv := New(Config{JWT: newTestIssuer(t)})
	r := httptest.NewRequest(http.MethodGet, "/api/v1/graphs", nil)
	if err := srv.AuthJWT(r); err == nil {
		t.Fatal("expected error for missing Authorization header")
	}
}

// TestAuthJWT_QueryParamFallback confirms ?access_token= is accepted
// when the Authorization header is absent — required because browsers
// can't set Authorization on the WebSocket upgrade request.
func TestAuthJWT_QueryParamFallback(t *testing.T) {
	iss := newTestIssuer(t)
	tok, _, err := iss.Issue("alice", "default", []string{"admin"})
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	srv := New(Config{JWT: iss})
	r := httptest.NewRequest(http.MethodGet, "/ws/query?access_token="+tok, nil)
	if err := srv.AuthJWT(r); err != nil {
		t.Fatalf("AuthJWT: %v", err)
	}
	if got := userFromContext(r.Context()); got != "alice" {
		t.Fatalf("user=%q want alice", got)
	}
}

// TestAuthJWT_MalformedHeader rejects schemes other than Bearer and
// headers with the wrong number of whitespace-separated fields.
func TestAuthJWT_MalformedHeader(t *testing.T) {
	srv := New(Config{JWT: newTestIssuer(t)})
	cases := []string{
		"Basic dXNlcjpwYXNz",
		"Bearer",
		"Bearer  ",
		"Bearer one two",
		"NotBearer foo",
	}
	for _, h := range cases {
		t.Run(h, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/api/v1/graphs", nil)
			r.Header.Set("Authorization", h)
			if err := srv.AuthJWT(r); err == nil {
				t.Fatalf("expected error for header %q", h)
			}
		})
	}
}

// TestAuthJWT_BadToken — a syntactically valid Bearer header carrying
// an unsigned-by-us token is rejected when Parse fails. We use a
// second issuer with a different secret to mint the token.
func TestAuthJWT_BadToken(t *testing.T) {
	srv := New(Config{JWT: newTestIssuer(t)})
	otherIssuer := newTestIssuer(t)
	tok, _, err := otherIssuer.Issue("alice", "default", []string{"admin"})
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	r := httptest.NewRequest(http.MethodGet, "/api/v1/graphs", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	if err := srv.AuthJWT(r); err == nil {
		t.Fatal("expected error for token signed by different issuer")
	}
	// Garbage token form — base64 segments but unsigned.
	r2 := httptest.NewRequest(http.MethodGet, "/api/v1/graphs", nil)
	r2.Header.Set("Authorization", "Bearer not.a.realtoken")
	if err := srv.AuthJWT(r2); err == nil {
		t.Fatal("expected error for malformed token body")
	}
}

// TestAuthJWT_ValidToken confirms the happy path: a token issued by
// our own issuer parses cleanly, populates the context with subject,
// profile, and roles, and returns nil.
func TestAuthJWT_ValidToken(t *testing.T) {
	iss := newTestIssuer(t)
	srv := New(Config{JWT: iss})
	tok, _, err := iss.Issue("alice", "prod", []string{"admin", "dba"})
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	r := httptest.NewRequest(http.MethodGet, "/api/v1/graphs", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	if err := srv.AuthJWT(r); err != nil {
		t.Fatalf("AuthJWT: %v", err)
	}
	if got := userFromContext(r.Context()); got != "alice" {
		t.Fatalf("user=%q want alice", got)
	}
	if got := profileFromContext(r.Context()); got != "prod" {
		t.Fatalf("profile=%q want prod", got)
	}
	roles := rolesFromContext(r.Context())
	if len(roles) != 2 || roles[0] != "admin" || roles[1] != "dba" {
		t.Fatalf("roles=%v want [admin dba]", roles)
	}
}

// TestAuthJWT_LowercaseBearer is RFC 6750 conformant: the scheme is
// case-insensitive. We accept "bearer" and "BEARER" identically.
func TestAuthJWT_LowercaseBearer(t *testing.T) {
	iss := newTestIssuer(t)
	srv := New(Config{JWT: iss})
	tok, _, err := iss.Issue("alice", "default", nil)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	for _, scheme := range []string{"bearer", "BEARER", "BeArEr"} {
		t.Run(scheme, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/api/v1/graphs", nil)
			r.Header.Set("Authorization", scheme+" "+tok)
			if err := srv.AuthJWT(r); err != nil {
				t.Fatalf("AuthJWT(%s): %v", scheme, err)
			}
		})
	}
}

// TestAuthJWT_HeaderTakesPrecedenceOverQuery confirms that when both
// Authorization and ?access_token= are present, the header wins. This
// guards against a CSRF-style attack where a logged-in user is tricked
// into clicking a URL that pins an attacker's token.
func TestAuthJWT_HeaderTakesPrecedenceOverQuery(t *testing.T) {
	iss := newTestIssuer(t)
	srv := New(Config{JWT: iss})
	headerTok, _, err := iss.Issue("alice", "default", nil)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	queryTok, _, err := iss.Issue("mallory", "default", nil)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	r := httptest.NewRequest(http.MethodGet, "/api/v1/graphs?access_token="+queryTok, nil)
	r.Header.Set("Authorization", "Bearer "+headerTok)
	if err := srv.AuthJWT(r); err != nil {
		t.Fatalf("AuthJWT: %v", err)
	}
	if got := userFromContext(r.Context()); got != "alice" {
		t.Fatalf("user=%q want alice (header path)", got)
	}
}

// TestExtractBearer_TabSeparator confirms that strings.Fields tolerance
// for tabs / multiple spaces is honoured for "Bearer\t<token>" headers.
func TestExtractBearer_TabSeparator(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Bearer\tabc")
	tok, err := extractBearer(r)
	if err != nil {
		t.Fatalf("extractBearer: %v", err)
	}
	if tok != "abc" {
		t.Fatalf("tok=%q want abc", tok)
	}
}

// TestAuthJWT_EmptyToken catches the "Bearer " (trailing whitespace
// only) shape, which strings.Fields collapses to a single field. The
// guard in extractBearer rejects this rather than passing "" to Parse.
func TestAuthJWT_EmptyToken(t *testing.T) {
	srv := New(Config{JWT: newTestIssuer(t)})
	r := httptest.NewRequest(http.MethodGet, "/api/v1/graphs", nil)
	r.Header.Set("Authorization", "Bearer ")
	authErr := srv.AuthJWT(r)
	if authErr == nil {
		t.Fatal("expected error for Bearer with empty token")
	}
	if !strings.Contains(authErr.Error(), "auth:") {
		t.Fatalf("unexpected error: %v", authErr)
	}
}
