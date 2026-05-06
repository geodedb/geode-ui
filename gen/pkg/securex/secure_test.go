package securex

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json/v2"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// buildToken constructs a well-formed Authorization header value.
func buildToken(secret []byte, method, path string, body []byte, nonce, ts string) string {
	bodyHash := sha256.Sum256(body)
	msg := strings.ToUpper(method) + "|" + path + "|" + hex.EncodeToString(bodyHash[:]) + "|" + nonce + "|" + ts
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(msg))
	tok := hex.EncodeToString(mac.Sum(nil))
	return "Bearer " + tok
}

// makeRequest builds an http.Request pre-populated with HMAC auth headers.
func makeRequest(secret []byte, nonce string, ts int64) *http.Request {
	tsStr := strconv.FormatInt(ts, 10)
	body := []byte(`{"x":"y"}`)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/resource", bytes.NewReader(body))
	r.Header.Set("Authorization", buildToken(secret, r.Method, r.URL.Path, body, nonce, tsStr))
	r.Header.Set("X-Nonce", nonce)
	r.Header.Set("X-Timestamp", tsStr)
	return r
}

// TestAPIKeyAuth_ValidRequest asserts a well-formed HMAC request passes.
func TestAPIKeyAuth_ValidRequest(t *testing.T) {
	secret := []byte("supersecret")
	var seen sync.Map
	r := makeRequest(secret, "nonce1", time.Now().Unix())
	if err := APIKeyAuth(r, secret, 5*time.Minute, &seen); err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
}

// TestAPIKeyAuth_ReplayRejected asserts replayed nonce+timestamp is rejected.
func TestAPIKeyAuth_ReplayRejected(t *testing.T) {
	secret := []byte("supersecret")
	var seen sync.Map
	r := makeRequest(secret, "nonce2", time.Now().Unix())
	if err := APIKeyAuth(r, secret, 5*time.Minute, &seen); err != nil {
		t.Fatalf("first request: %v", err)
	}
	// Same nonce+timestamp — replay.
	r2 := makeRequest(secret, "nonce2", time.Now().Unix())
	// Adjust timestamp to match the stored entry (identical).
	r2.Header.Set("X-Timestamp", r.Header.Get("X-Timestamp"))
	r2.Header.Set("Authorization", r.Header.Get("Authorization"))
	if err := APIKeyAuth(r2, secret, 5*time.Minute, &seen); err == nil {
		t.Fatalf("expected replay rejection")
	}
}

// TestAPIKeyAuth_ExpiredTimestamp asserts that stale requests are rejected.
func TestAPIKeyAuth_ExpiredTimestamp(t *testing.T) {
	secret := []byte("supersecret")
	var seen sync.Map
	old := time.Now().Add(-10 * time.Minute).Unix()
	r := makeRequest(secret, "nonce3", old)
	if err := APIKeyAuth(r, secret, 5*time.Minute, &seen); err == nil {
		t.Fatalf("expected rejection for stale timestamp")
	}
}

// TestAPIKeyAuth_WrongSecret asserts that a request signed with the wrong
// secret is rejected.
func TestAPIKeyAuth_WrongSecret(t *testing.T) {
	secret := []byte("correct")
	wrong := []byte("wrong")
	var seen sync.Map
	r := makeRequest(wrong, "nonce4", time.Now().Unix())
	if err := APIKeyAuth(r, secret, 5*time.Minute, &seen); err == nil {
		t.Fatalf("expected rejection for wrong secret")
	}
}

// TestAPIKeyAuth_MissingHeaders asserts that requests without required headers
// are rejected.
func TestAPIKeyAuth_MissingHeaders(t *testing.T) {
	secret := []byte("supersecret")
	var seen sync.Map

	cases := []struct {
		name   string
		mutate func(*http.Request)
	}{
		{"no auth", func(r *http.Request) { r.Header.Del("Authorization") }},
		{"no nonce", func(r *http.Request) { r.Header.Del("X-Nonce") }},
		{"no timestamp", func(r *http.Request) { r.Header.Del("X-Timestamp") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := makeRequest(secret, "nonce-miss", time.Now().Unix())
			tc.mutate(r)
			if err := APIKeyAuth(r, secret, 5*time.Minute, &seen); err == nil {
				t.Fatalf("expected error for %s", tc.name)
			}
		})
	}
}

func TestAPIKeyAuth_PathBoundRejectsReuseOnDifferentPath(t *testing.T) {
	secret := []byte("supersecret")
	var seen sync.Map
	now := time.Now().Unix()
	nonce := "nonce-path-bound"
	ts := strconv.FormatInt(now, 10)
	body := []byte(`{"x":"y"}`)

	r1 := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/resource", bytes.NewReader(body))
	r1.Header.Set("X-Nonce", nonce)
	r1.Header.Set("X-Timestamp", ts)
	r1.Header.Set("Authorization", buildToken(secret, r1.Method, r1.URL.Path, body, nonce, ts))
	if err := APIKeyAuth(r1, secret, 5*time.Minute, &seen); err != nil {
		t.Fatalf("expected first request to pass: %v", err)
	}

	// Reuse the same Authorization token/nonce/timestamp on a different path.
	r2 := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/other", bytes.NewReader(body))
	r2.Header.Set("X-Nonce", nonce)
	r2.Header.Set("X-Timestamp", ts)
	r2.Header.Set("Authorization", r1.Header.Get("Authorization"))
	if err := APIKeyAuth(r2, secret, 5*time.Minute, &seen); err == nil {
		t.Fatalf("expected request-bound signature rejection on different path")
	}
}

func TestAPIKeyAuth_BodyPreservedAfterVerification(t *testing.T) {
	secret := []byte("supersecret")
	var seen sync.Map
	body := []byte(`{"hello":"world"}`)
	now := strconv.FormatInt(time.Now().Unix(), 10)

	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/resource", bytes.NewReader(body))
	r.Header.Set("X-Nonce", "nonce-preserve")
	r.Header.Set("X-Timestamp", now)
	r.Header.Set("Authorization", buildToken(secret, r.Method, r.URL.Path, body, "nonce-preserve", now))

	if err := APIKeyAuth(r, secret, 5*time.Minute, &seen); err != nil {
		t.Fatalf("expected auth success: %v", err)
	}
	got, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatalf("read body after auth: %v", err)
	}
	if string(got) != string(body) {
		t.Fatalf("expected body %q, got %q", string(body), string(got))
	}
}

func TestSignAPIKeyRequest_RoundTrip(t *testing.T) {
	secret := []byte("supersecret")
	var seen sync.Map

	body := []byte(`{"hello":"world"}`)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/resource", bytes.NewReader(body))
	if err := SignAPIKeyRequestWithValues(r, secret, "nonce-roundtrip", strconv.FormatInt(time.Now().Unix(), 10)); err != nil {
		t.Fatalf("sign request: %v", err)
	}
	if err := APIKeyAuth(r, secret, 5*time.Minute, &seen); err != nil {
		t.Fatalf("verify signed request: %v", err)
	}
}

func TestRequestWithQueryAuth_AccessToken(t *testing.T) {
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/ws?access_token=jwt-token", nil)
	got := RequestWithQueryAuth(r)
	if got == r {
		t.Fatal("expected request clone when query auth is present")
	}
	if auth := got.Header.Get("Authorization"); auth != "Bearer jwt-token" {
		t.Fatalf("Authorization: got %q", auth)
	}
}

func TestRequestWithAuth_DefaultRejectsQueryBearerToken(t *testing.T) {
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/ws?access_token=jwt-token", nil)
	got := RequestWithAuth(r)
	if got != r {
		t.Fatal("expected hardened default to leave request unchanged for query bearer tokens")
	}
	if auth := got.Header.Get("Authorization"); auth != "" {
		t.Fatalf("Authorization: got %q", auth)
	}
}

func TestRequestWithAuthPolicy_QuerySignatureOptIn(t *testing.T) {
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/ws?sig=abc123&nonce=n1&ts=1700000000", nil)
	got := RequestWithAuthPolicy(r, UnsafeQueryAuthPolicy())
	if got.Header.Get("Authorization") != "Bearer abc123" {
		t.Fatalf("Authorization: got %q", got.Header.Get("Authorization"))
	}
	if got.Header.Get("X-Nonce") != "n1" {
		t.Fatalf("X-Nonce: got %q", got.Header.Get("X-Nonce"))
	}
	if got.Header.Get("X-Timestamp") != "1700000000" {
		t.Fatalf("X-Timestamp: got %q", got.Header.Get("X-Timestamp"))
	}
}

func TestRequestWithQueryAuth_APIKeySignature(t *testing.T) {
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/ws?sig=abc123&nonce=n1&ts=1700000000", nil)
	got := RequestWithQueryAuth(r)
	if got.Header.Get("Authorization") != "Bearer abc123" {
		t.Fatalf("Authorization: got %q", got.Header.Get("Authorization"))
	}
	if got.Header.Get("X-Nonce") != "n1" {
		t.Fatalf("X-Nonce: got %q", got.Header.Get("X-Nonce"))
	}
	if got.Header.Get("X-Timestamp") != "1700000000" {
		t.Fatalf("X-Timestamp: got %q", got.Header.Get("X-Timestamp"))
	}
	if r.Header.Get("Authorization") != "" {
		t.Fatal("original request should remain unchanged")
	}
}

func TestRequestWithQueryAuth_WebSocketBearerProtocol(t *testing.T) {
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/ws", nil)
	r.Header.Set("Sec-WebSocket-Protocol", "graphql-transport-ws, genapi.auth.bearer.and0LXRva2Vu")

	got := RequestWithQueryAuth(r)
	if got == r {
		t.Fatal("expected request clone when websocket auth protocol is present")
	}
	if auth := got.Header.Get("Authorization"); auth != "Bearer jwt-token" {
		t.Fatalf("Authorization: got %q", auth)
	}
}

func TestRequestWithQueryAuth_WebSocketAPIKeyProtocol(t *testing.T) {
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/ws", nil)
	r.Header.Set(
		"Sec-WebSocket-Protocol",
		"genapi.auth.sig.YWJjMTIz, genapi.auth.nonce.bjE, genapi.auth.ts.MTcwMDAwMDAwMA",
	)

	got := RequestWithQueryAuth(r)
	if got.Header.Get("Authorization") != "Bearer abc123" {
		t.Fatalf("Authorization: got %q", got.Header.Get("Authorization"))
	}
	if got.Header.Get("X-Nonce") != "n1" {
		t.Fatalf("X-Nonce: got %q", got.Header.Get("X-Nonce"))
	}
	if got.Header.Get("X-Timestamp") != "1700000000" {
		t.Fatalf("X-Timestamp: got %q", got.Header.Get("X-Timestamp"))
	}
}

// makeHS256JWT constructs a minimal HS256 JWT signed with the given secret.
func makeHS256JWT(secret []byte, extraClaims map[string]any) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	claims := map[string]any{
		"sub": "test",
		"iat": time.Now().Unix(),
		"exp": time.Now().Add(5 * time.Minute).Unix(),
	}
	maps.Copy(claims, extraClaims)
	payload, _ := json.Marshal(claims)
	payloadB64 := base64.RawURLEncoding.EncodeToString(payload)
	msg := header + "." + payloadB64
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(msg))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return msg + "." + sig
}

// TestVerifyJWT_ValidHS256 asserts that a correctly signed HS256 JWT passes.
func TestVerifyJWT_ValidHS256(t *testing.T) {
	secret := []byte("jwt-secret")
	tok := makeHS256JWT(secret, nil)
	if err := VerifyJWT(tok, secret); err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
}

// TestVerifyJWT_WrongSecret asserts that a JWT signed with a different secret
// is rejected.
func TestVerifyJWT_WrongSecret(t *testing.T) {
	tok := makeHS256JWT([]byte("correct"), nil)
	if err := VerifyJWT(tok, []byte("wrong")); err == nil {
		t.Fatalf("expected error for wrong secret")
	}
}

// TestVerifyJWT_WrongAlg asserts that non-HS256 tokens are rejected.
func TestVerifyJWT_WrongAlg(t *testing.T) {
	// Build a token with alg=RS256.
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"x"}`))
	tok := header + "." + payload + ".fakesig"
	if err := VerifyJWT(tok, []byte("any")); err == nil {
		t.Fatalf("expected error for RS256 algorithm")
	}
}

// TestVerifyJWT_MalformedToken asserts that truncated or malformed tokens are
// rejected.
func TestVerifyJWT_MalformedToken(t *testing.T) {
	for _, bad := range []string{"", "only.two", "a.b.c.d"} {
		if err := VerifyJWT(bad, []byte("secret")); err == nil {
			t.Fatalf("expected error for %q", bad)
		}
	}
}

func TestVerifyJWT_ExpiredRejected(t *testing.T) {
	secret := []byte("jwt-secret")
	tok := makeHS256JWT(secret, map[string]any{
		"exp": time.Now().Add(-10 * time.Minute).Unix(),
	})
	if err := VerifyJWT(tok, secret); err == nil {
		t.Fatal("expected expired token rejection")
	}
}

func TestVerifyJWT_NotBeforeRejected(t *testing.T) {
	secret := []byte("jwt-secret")
	tok := makeHS256JWT(secret, map[string]any{
		"nbf": time.Now().Add(5 * time.Minute).Unix(),
	})
	if err := VerifyJWT(tok, secret); err == nil {
		t.Fatal("expected nbf token rejection")
	}
}

func TestVerifyJWT_FutureIssuedAtRejected(t *testing.T) {
	secret := []byte("jwt-secret")
	tok := makeHS256JWT(secret, map[string]any{
		"iat": time.Now().Add(5 * time.Minute).Unix(),
		"exp": time.Now().Add(10 * time.Minute).Unix(),
	})
	if err := VerifyJWT(tok, secret); err == nil {
		t.Fatal("expected future iat token rejection")
	}
}

func TestVerifyJWTWithOptions_IssuerAndAudience(t *testing.T) {
	secret := []byte("jwt-secret")
	tok := makeHS256JWT(secret, map[string]any{
		"iss": "https://issuer.example",
		"aud": []string{"api://primary", "api://secondary"},
	})
	opts := JWTVerifyOptions{Issuer: "https://issuer.example", Audience: "api://secondary"}
	if err := VerifyJWTWithOptions(tok, secret, opts); err != nil {
		t.Fatalf("expected issuer/audience validation to pass, got %v", err)
	}
}

func TestVerifyJWTWithOptions_WrongIssuerRejected(t *testing.T) {
	secret := []byte("jwt-secret")
	tok := makeHS256JWT(secret, map[string]any{
		"iss": "https://issuer.example",
		"aud": "api://primary",
	})
	opts := JWTVerifyOptions{Issuer: "https://other.example"}
	if err := VerifyJWTWithOptions(tok, secret, opts); err == nil {
		t.Fatalf("expected wrong issuer rejection")
	}
}

func TestVerifyJWTWithOptions_WrongAudienceRejected(t *testing.T) {
	secret := []byte("jwt-secret")
	tok := makeHS256JWT(secret, map[string]any{
		"iss": "https://issuer.example",
		"aud": "api://primary",
	})
	opts := JWTVerifyOptions{Audience: "api://secondary"}
	if err := VerifyJWTWithOptions(tok, secret, opts); err == nil {
		t.Fatalf("expected wrong audience rejection")
	}
}

// TestBucket_AllowsUpToBurst verifies the token bucket allows up to burst
// requests before throttling.
func TestBucket_AllowsUpToBurst(t *testing.T) {
	const burst = 5
	b := NewBucket(0, burst) // rate=0: no refill
	for i := range burst {
		if !b.Allow() {
			t.Fatalf("request %d should be allowed (burst=%d)", i+1, burst)
		}
	}
	if b.Allow() {
		t.Fatalf("request %d should be throttled", burst+1)
	}
}

// TestBucket_Snapshot verifies Snapshot returns plausible header values.
func TestBucket_Snapshot(t *testing.T) {
	b := NewBucket(10, 20)
	lim, rem, reset := b.Snapshot()
	if lim != 20 {
		t.Fatalf("expected limit=20, got %d", lim)
	}
	if rem < 0 || rem > lim {
		t.Fatalf("remaining %d out of range [0,%d]", rem, lim)
	}
	if reset.Before(time.Now()) {
		t.Fatalf("reset time is in the past: %v", reset)
	}
}

// TestBucket_Concurrency verifies that Allow() is race-safe.
func TestBucket_Concurrency(t *testing.T) {
	b := NewBucket(1000, 1000)
	var wg sync.WaitGroup
	for range 100 {
		wg.Go(func() { ; b.Allow() })
	}
	wg.Wait()
}

// TestStartNonceGC verifies that expired nonces are eventually removed.
func TestStartNonceGC(t *testing.T) {
	var seen sync.Map
	// Store an already-expired entry.
	seen.Store("old|nonce", time.Now().Add(-time.Hour))
	stop := StartNonceGC(&seen, 10*time.Millisecond)
	defer close(stop)
	time.Sleep(50 * time.Millisecond)
	if _, loaded := seen.Load("old|nonce"); loaded {
		t.Fatalf("expired nonce not cleaned up")
	}
}

// ---- RBAC tests ----

// TestRole_Hierarchy verifies the role ordering.
func TestRole_Hierarchy(t *testing.T) {
	if RoleAdmin <= RoleManager || RoleManager <= RoleUser {
		t.Fatalf("role ordering invalid: admin=%d manager=%d user=%d", RoleAdmin, RoleManager, RoleUser)
	}
}

// TestRole_HasRole verifies HasRole enforces the hierarchy.
func TestRole_HasRole(t *testing.T) {
	cases := []struct {
		role, required Role
		want           bool
	}{
		{RoleAdmin, RoleAdmin, true},
		{RoleAdmin, RoleManager, true},
		{RoleAdmin, RoleUser, true},
		{RoleManager, RoleAdmin, false},
		{RoleManager, RoleManager, true},
		{RoleManager, RoleUser, true},
		{RoleUser, RoleAdmin, false},
		{RoleUser, RoleManager, false},
		{RoleUser, RoleUser, true},
	}
	for _, tc := range cases {
		if got := tc.role.HasRole(tc.required); got != tc.want {
			t.Errorf("Role(%d).HasRole(%d) = %v, want %v", tc.role, tc.required, got, tc.want)
		}
	}
}

// TestRoleFromString_Valid verifies parsing of all known role names.
func TestRoleFromString_Valid(t *testing.T) {
	cases := map[string]Role{"admin": RoleAdmin, "manager": RoleManager, "user": RoleUser}
	for s, want := range cases {
		got, err := RoleFromString(s)
		if err != nil || got != want {
			t.Errorf("RoleFromString(%q) = %v,%v; want %v,nil", s, got, err, want)
		}
	}
}

// TestRoleFromString_Invalid verifies that unknown names return ErrInvalidConfig.
func TestRoleFromString_Invalid(t *testing.T) {
	_, err := RoleFromString("superuser")
	if err != ErrInvalidConfig {
		t.Fatalf("expected ErrInvalidConfig, got %v", err)
	}
}

// TestParseClaims_ExtractsFields verifies that ParseClaims populates all fields.
func TestParseClaims_ExtractsFields(t *testing.T) {
	secret := []byte("s")
	tok := makeHS256JWT(secret, map[string]any{
		"roles":  []string{"admin", "user"},
		"scopes": []string{"read", "write"},
	})
	c, err := ParseClaims(tok)
	if err != nil {
		t.Fatalf("ParseClaims: %v", err)
	}
	if c.HighestRole() != RoleAdmin {
		t.Fatalf("expected admin, got %v", c.HighestRole())
	}
	if !c.HasScope("read") || !c.HasScope("write") {
		t.Fatalf("expected read and write scopes")
	}
	if c.HasScope("delete") {
		t.Fatalf("unexpected scope delete")
	}
}

// TestRequireRole_AdminPasses verifies that an admin JWT passes an admin gate.
func TestRequireRole_AdminPasses(t *testing.T) {
	secret := []byte("secret")
	tok := makeHS256JWT(secret, map[string]any{"roles": []string{"admin"}})

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h := RequireRole(RoleAdmin, secret, next)

	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// TestRequireRole_UserForbidden verifies that a user JWT fails an admin gate
// with 403 Forbidden.
func TestRequireRole_UserForbidden(t *testing.T) {
	secret := []byte("secret")
	tok := makeHS256JWT(secret, map[string]any{"roles": []string{"user"}})

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h := RequireRole(RoleAdmin, secret, next)

	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

// TestRequireRole_MissingAuth verifies 401 when Authorization is absent.
func TestRequireRole_MissingAuth(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {})
	h := RequireRole(RoleUser, []byte("s"), next)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// TestSetRateHeaders verifies that SetRateHeaders writes all three headers.
func TestSetRateHeaders(t *testing.T) {
	w := httptest.NewRecorder()
	reset := time.Now().Add(time.Second)
	SetRateHeaders(w, 100, 50, reset)
	for _, h := range []string{"X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"} {
		if w.Header().Get(h) == "" {
			t.Fatalf("missing header %q", h)
		}
	}
	if w.Header().Get("X-RateLimit-Limit") != "100" {
		t.Fatalf("unexpected limit %q", w.Header().Get("X-RateLimit-Limit"))
	}
	if w.Header().Get("X-RateLimit-Remaining") != "50" {
		t.Fatalf("unexpected remaining %q", w.Header().Get("X-RateLimit-Remaining"))
	}
}

// TestRequireABAC_MatchAttribute verifies ABAC evaluation based on attributes.
func TestRequireABAC_MatchAttribute(t *testing.T) {
	secret := []byte("secret")
	tok := makeHS256JWT(secret, map[string]any{
		"attributes": map[string]string{"dept": "sales", "region": "us-east"},
	})

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// Match passes
	hPass := RequireABAC(secret, MatchAttribute("dept", "sales"), HasAttribute("region"))(next)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	hPass.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	// Match fails due to wrong value
	hFail1 := RequireABAC(secret, MatchAttribute("dept", "engineering"))(next)
	wFail1 := httptest.NewRecorder()
	hFail1.ServeHTTP(wFail1, r)
	if wFail1.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", wFail1.Code)
	}

	// Match fails due to missing attribute
	hFail2 := RequireABAC(secret, HasAttribute("clearance"))(next)
	wFail2 := httptest.NewRecorder()
	hFail2.ServeHTTP(wFail2, r)
	if wFail2.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", wFail2.Code)
	}
}

// Silence unused import.
var _ = fmt.Sprintf
