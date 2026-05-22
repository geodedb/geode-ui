package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"
)

func TestOnboard_MethodNotAllowed(t *testing.T) {
	srv := New(Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/profiles/onboard", nil)
	srv.HandleOnboard(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status=%d want 405", rec.Code)
	}
	if rec.Header().Get("Allow") != http.MethodPost {
		t.Errorf("Allow=%q want POST", rec.Header().Get("Allow"))
	}
}

func TestOnboard_RejectsMissingFields(t *testing.T) {
	srv := New(Config{})
	cases := []struct {
		name string
		body string
	}{
		{"empty body", `{}`},
		{"missing name", `{"dsn":"quic://x:3141","admin_username":"u","admin_password":"p"}`},
		{"missing dsn", `{"name":"prod","admin_username":"u","admin_password":"p"}`},
		{"missing admin_username", `{"name":"prod","dsn":"quic://x:3141","admin_password":"p"}`},
		{"missing admin_password", `{"name":"prod","dsn":"quic://x:3141","admin_username":"u"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(
				http.MethodPost,
				"/api/v1/profiles/onboard",
				bytes.NewReader([]byte(tc.body)),
			)
			req.Header.Set("Content-Type", "application/json")
			srv.HandleOnboard(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), ErrCodeInvalidRequest) {
				t.Errorf("body=%s want %q", rec.Body.String(), ErrCodeInvalidRequest)
			}
		})
	}
}

func TestOnboard_RejectsInvalidDSNScheme(t *testing.T) {
	srv := New(Config{})
	rec := httptest.NewRecorder()
	body, _ := json.Marshal(map[string]string{
		"name":           "prod",
		"dsn":            "http://example.com:8080",
		"admin_username": "alice",
		"admin_password": "pw",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/profiles/onboard", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.HandleOnboard(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "dsn") {
		t.Errorf("expected dsn-error message; got %s", rec.Body.String())
	}
}

// TestOnboard_RejectsOversizeDSN pins the 1024-byte ceiling on the
// supplied DSN (matches the SPA's OnboardProfileForm maxLength). A
// pathologically long DSN is rejected pre-probe so the upstream
// parser and any logging pipeline never see the payload.
func TestOnboard_RejectsOversizeDSN(t *testing.T) {
	srv := New(Config{})
	// 1025 bytes: 13-byte scheme+host prefix + 1012 trailing query
	// padding to overshoot the 1024 cap by one byte.
	oversize := "quic://x:3141?" + strings.Repeat("p", 1011)
	if len(oversize) <= 1024 {
		t.Fatalf("test fixture is %d bytes; expected >1024", len(oversize))
	}
	body, _ := json.Marshal(map[string]string{
		"name":           "prod",
		"dsn":            oversize,
		"admin_username": "alice",
		"admin_password": "pw", // pragma: allowlist secret
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/profiles/onboard", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.HandleOnboard(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "1024") {
		t.Errorf("body should cite the 1024-byte cap; got %s", rec.Body.String())
	}
}

// TestOnboard_EmitsAuditOnSuccess + TestOnboard_EmitsAuditOnFailure
// pin the audit-trail invariant: every onboard attempt (success OR
// failure) leaves a record in the audit ring so a forensic review
// can reconstruct who registered which profile or who probed which
// DSN with which admin username. The password is NEVER recorded —
// only the username, name, and DSN.
//
// The ring is package-level (defaultAuditRing), so the test takes a
// snapshot at t0 and counts new entries after the request settles.
func TestOnboard_EmitsAuditOnSuccess(t *testing.T) {
	iss := newTestIssuer(t)
	store := newFakeProfileStore()
	srv := New(Config{
		JWT:                     iss,
		Store:                   store,
		testAuthenticateOnboard: fakeOnboardProbe("alice", "pw"),
	})

	t0 := time.Now()
	body, _ := json.Marshal(map[string]string{
		"name":           "prod",
		"dsn":            "quic://prod.example.com:3141",
		"admin_username": "alice",
		"admin_password": "pw", // pragma: allowlist secret
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/profiles/onboard", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.HandleOnboard(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200", rec.Code)
	}

	entries := defaultAuditRing.snapshot(t0)
	var found *AuditEntry
	for i := range entries {
		if entries[i].Event == auditEventOnboardSuccess {
			found = &entries[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("no %s audit entry; got %d entries", auditEventOnboardSuccess, len(entries))
	}
	if got, _ := found.Fields["user"].(string); got != "alice" {
		t.Errorf("audit user=%v want alice", found.Fields["user"])
	}
	if got, _ := found.Fields["name"].(string); got != "prod" {
		t.Errorf("audit name=%v want prod", found.Fields["name"])
	}
	if got, _ := found.Fields["target"].(string); got != "quic://prod.example.com:3141" {
		t.Errorf("audit target=%v want scheme://host", found.Fields["target"])
	}
	// The password is the load-bearing invariant — confirm via every
	// stored value, not just the named keys (a future field add could
	// leak it).
	for k, v := range found.Fields {
		if s, _ := v.(string); strings.Contains(s, "pw") && k != "name" {
			// Allow the "pw" substring to appear in non-password
			// fields if it happens to be part of a name or dsn; flag
			// only direct matches on the literal password.
			if s == "pw" {
				t.Errorf("audit %s=%q contains the password literal", k, s)
			}
		}
	}
}

func TestOnboard_EmitsAuditOnFailure(t *testing.T) {
	iss := newTestIssuer(t)
	store := newFakeProfileStore()
	srv := New(Config{
		JWT:                     iss,
		Store:                   store,
		testAuthenticateOnboard: fakeOnboardProbe("alice", "correct-pw"),
	})

	t0 := time.Now()
	body, _ := json.Marshal(map[string]string{
		"name":           "prod",
		"dsn":            "quic://prod.example.com:3141",
		"admin_username": "alice",
		"admin_password": "wrong-pw", // pragma: allowlist secret
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/profiles/onboard", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.HandleOnboard(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401", rec.Code)
	}

	entries := defaultAuditRing.snapshot(t0)
	var found *AuditEntry
	for i := range entries {
		if entries[i].Event == auditEventOnboardFailure {
			found = &entries[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("no %s audit entry; got %d entries", auditEventOnboardFailure, len(entries))
	}
	if got, _ := found.Fields["reason"].(string); got != "upstream_rejected" {
		t.Errorf("audit reason=%v want upstream_rejected", found.Fields["reason"])
	}
}

func TestOnboard_HappyPath(t *testing.T) {
	iss := newTestIssuer(t)
	store := newFakeProfileStore()
	srv := New(Config{
		JWT:                     iss,
		Store:                   store,
		testAuthenticateOnboard: fakeOnboardProbe("alice", "pw"),
	})

	body, _ := json.Marshal(map[string]string{
		"name":           "prod",
		"dsn":            "quic://prod.example.com:3141",
		"description":    "production geode",
		"admin_username": "alice",
		"admin_password": "pw",
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/profiles/onboard", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.HandleOnboard(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s want 200", rec.Code, rec.Body.String())
	}
	var resp OnboardResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.ProfileID == "" {
		t.Error("profile_id empty")
	}
	if resp.ProfileName != "prod" {
		t.Errorf("ProfileName=%q want prod", resp.ProfileName)
	}
	if resp.AccessToken == "" {
		t.Error("access_token empty")
	}
	if _, err := iss.Parse(resp.AccessToken); err != nil {
		t.Errorf("returned token does not parse: %v", err)
	}
	if len(store.puts) != 1 {
		t.Fatalf("Store.Put called %d times, want 1", len(store.puts))
	}
	if store.puts[0].Name != "prod" {
		t.Errorf("stored profile name=%q want prod", store.puts[0].Name)
	}
	if store.puts[0].Scope != conn.ProfileScopeSystem {
		t.Errorf("stored profile scope=%q want %q", store.puts[0].Scope, conn.ProfileScopeSystem)
	}
}

func TestOnboard_RejectsBadUpstreamCredentials(t *testing.T) {
	iss := newTestIssuer(t)
	store := newFakeProfileStore()
	srv := New(Config{
		JWT:                     iss,
		Store:                   store,
		testAuthenticateOnboard: fakeOnboardProbe("alice", "correct-pw"),
	})

	body, _ := json.Marshal(map[string]string{
		"name":           "prod",
		"dsn":            "quic://prod.example.com:3141",
		"admin_username": "alice",
		"admin_password": "wrong-pw",
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/profiles/onboard", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.HandleOnboard(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401 body=%s", rec.Code, rec.Body.String())
	}
	if len(store.puts) != 0 {
		t.Errorf("Store.Put fired despite auth failure (count=%d)", len(store.puts))
	}
}

func TestOnboard_RejectsDuplicateName(t *testing.T) {
	iss := newTestIssuer(t)
	store := newFakeProfileStore()
	// Pre-existing profile with the same name.
	store.existing = []conn.Profile{{ID: "pre-prod", Name: "prod", Scope: conn.ProfileScopeSystem}}
	srv := New(Config{
		JWT:                     iss,
		Store:                   store,
		testAuthenticateOnboard: fakeOnboardProbe("alice", "pw"),
	})

	body, _ := json.Marshal(map[string]string{
		"name":           "prod",
		"dsn":            "quic://prod.example.com:3141",
		"admin_username": "alice",
		"admin_password": "pw",
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/profiles/onboard", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.HandleOnboard(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d want 409 body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), ErrCodeConflict) {
		t.Errorf("body=%s want %q", rec.Body.String(), ErrCodeConflict)
	}
}

// fakeOnboardProbe returns a testAuthenticateOnboard override that
// accepts only the supplied (wantUser, wantPassword) tuple. Any other
// combination returns errFakeProbeRejected — mirroring the real
// authenticateOnboard contract where a credential-reject surfaces as a
// non-nil error.
func fakeOnboardProbe(wantUser, wantPassword string) func(context.Context, string, string, string) ([]string, error) {
	return func(_ context.Context, _ /* dsn */, username, password string) ([]string, error) {
		if username == wantUser && password == wantPassword {
			return nil, nil
		}
		return nil, errFakeProbeRejected
	}
}

var errFakeProbeRejected = errors.New("fake probe: invalid credentials")

// fakeProfileStore satisfies the profilestore.Store interface in
// memory. It only exists to back HandleOnboard's happy / conflict tests
// — the production-grade store coverage lives in
// internal/profilestore/sqlite_test.go.
type fakeProfileStore struct {
	puts     []conn.Profile
	existing []conn.Profile
}

func newFakeProfileStore() *fakeProfileStore { return &fakeProfileStore{} }

func (f *fakeProfileStore) Put(_ context.Context, p conn.Profile) (conn.Profile, error) {
	for _, e := range f.existing {
		if strings.EqualFold(e.Name, p.Name) {
			return conn.Profile{}, profilestore.ErrConflict
		}
	}
	for _, e := range f.puts {
		if strings.EqualFold(e.Name, p.Name) {
			return conn.Profile{}, profilestore.ErrConflict
		}
	}
	if p.ID == "" {
		p.ID = "onb-" + p.Name
	}
	f.puts = append(f.puts, p)
	return p, nil
}

func (f *fakeProfileStore) List(_ context.Context, _ profilestore.Filter) ([]conn.Profile, error) {
	return append([]conn.Profile{}, f.existing...), nil
}

func (f *fakeProfileStore) ListVisible(_ context.Context, _ string) ([]conn.Profile, error) {
	return append([]conn.Profile{}, f.existing...), nil
}

func (f *fakeProfileStore) Get(_ context.Context, id string) (conn.Profile, error) {
	for _, e := range f.existing {
		if e.ID == id {
			return e, nil
		}
	}
	for _, e := range f.puts {
		if e.ID == id {
			return e, nil
		}
	}
	return conn.Profile{}, profilestore.ErrNotFound
}

func (f *fakeProfileStore) Patch(_ context.Context, _ string, _ profilestore.ProfilePatch) (conn.Profile, error) {
	return conn.Profile{}, profilestore.ErrNotFound
}

func (f *fakeProfileStore) Delete(_ context.Context, _ string) error { return nil }
func (f *fakeProfileStore) Close() error                             { return nil }
