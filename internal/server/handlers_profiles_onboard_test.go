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
