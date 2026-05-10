package server

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"

	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"

	gentypes "geodedb.com/geode-ui/gen/types"
)

func TestPublicProfiles_ReturnsSystemOnly_NoAuth(t *testing.T) {
	st, _ := profilestore.OpenSQLite(":memory:")
	t.Cleanup(func() { _ = st.Close() })
	ctx := context.Background()
	if _, err := st.Put(ctx, conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "prod", DSN: "quic://prod:1",
		Description: "production",
	}); err != nil {
		t.Fatalf("seed system: %v", err)
	}
	if _, err := st.Put(ctx, conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice", Name: "alice-dev",
		DSN: "quic://dev:1", Description: "alice's dev",
	}); err != nil {
		t.Fatalf("seed personal: %v", err)
	}
	srv := New(Config{Store: st})

	r := httptest.NewRequest("GET", "/api/v1/profiles/public", nil)
	resp, err := srv.Public(httptest.NewRecorder(), r, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("Public: %v", err)
	}
	if len(resp.Profiles) != 1 {
		t.Fatalf("want 1 system profile, got %d", len(resp.Profiles))
	}
	got := resp.Profiles[0]
	if got.Name != "prod" {
		t.Errorf("Name = %q, want prod", got.Name)
	}
	if got.Description != "production" {
		t.Errorf("Description = %q, want production", got.Description)
	}
	// The wire shape (PublicProfileList → []PublicProfile{name, description})
	// has no DSN/TLS/PoolOverrides field by construction, so non-leakage of
	// secrets is enforced by the schema, not by handler logic.
}

// TestPublicProfiles_EmptyStoreReturnsEmptyList exercises the
// successful-but-empty branch: a Store wired with zero rows must
// return an empty Profiles list (not nil), so the SPA's connection
// picker can render the "no profiles configured" affordance instead
// of crashing on a nil iteration.
func TestPublicProfiles_EmptyStoreReturnsEmptyList(t *testing.T) {
	st, _ := profilestore.OpenSQLite(":memory:")
	t.Cleanup(func() { _ = st.Close() })
	srv := New(Config{Store: st})

	r := httptest.NewRequest("GET", "/api/v1/profiles/public", nil)
	resp, err := srv.Public(httptest.NewRecorder(), r, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("Public: %v", err)
	}
	if resp == nil {
		t.Fatal("Public returned nil response on empty store")
	}
	if resp.Profiles == nil {
		t.Errorf("Profiles is nil; want empty slice for stable wire shape")
	}
	if len(resp.Profiles) != 0 {
		t.Errorf("len(Profiles) = %d, want 0", len(resp.Profiles))
	}
}

// TestPublicProfiles_StoreErrorBubbles pins the error path: when the
// underlying List call fails, Public surfaces the error rather than
// returning a partial / corrupted PublicProfileList. The genapi
// dispatcher renders a non-nil error as 500.
func TestPublicProfiles_StoreErrorBubbles(t *testing.T) {
	listErr := errors.New("disk on fire")
	srv := New(Config{Store: &listErrStore{err: listErr}})
	r := httptest.NewRequest("GET", "/api/v1/profiles/public", nil)
	resp, err := srv.Public(httptest.NewRecorder(), r, &gentypes.Empty{})
	if err == nil {
		t.Fatalf("Public: want error, got nil (resp=%+v)", resp)
	}
	if !errors.Is(err, listErr) {
		t.Errorf("Public surfaced %v, want errors.Is(err, listErr)", err)
	}
}

// listErrStore is a fake profilestore.Store whose List always fails
// with err. Used by TestPublicProfiles_StoreErrorBubbles.
type listErrStore struct{ err error }

func (s *listErrStore) Get(_ context.Context, _ string) (conn.Profile, error) {
	return conn.Profile{}, s.err
}
func (s *listErrStore) List(_ context.Context, _ profilestore.Filter) ([]conn.Profile, error) {
	return nil, s.err
}
func (s *listErrStore) Put(_ context.Context, p conn.Profile) (conn.Profile, error) {
	return p, nil
}
func (s *listErrStore) Patch(_ context.Context, _ string, _ profilestore.ProfilePatch) (conn.Profile, error) {
	return conn.Profile{}, s.err
}
func (s *listErrStore) Delete(_ context.Context, _ string) error { return nil }
func (s *listErrStore) Close() error                             { return nil }

// TestPublicProfiles_StoreNil_FallbackToPool covers the legacy
// fallback in Public: when no Store is wired, Public enumerates
// profile NAMES from the in-memory ProfileLookup. The names-only
// shape preserves the no-DSN-leakage invariant.
func TestPublicProfiles_StoreNil_FallbackToPool(t *testing.T) {
	srv := New(Config{
		Store:    nil,
		Profiles: namesPoolStub{names: []string{"east", "west"}},
	})
	r := httptest.NewRequest("GET", "/api/v1/profiles/public", nil)
	resp, err := srv.Public(httptest.NewRecorder(), r, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("Public: %v", err)
	}
	if len(resp.Profiles) != 2 {
		t.Fatalf("len = %d, want 2", len(resp.Profiles))
	}
	want := map[string]bool{"east": true, "west": true}
	for _, p := range resp.Profiles {
		if !want[p.Name] {
			t.Errorf("unexpected name %q", p.Name)
		}
		if p.Description != "" {
			t.Errorf("legacy fallback should not surface a description; got %q", p.Description)
		}
	}
}

// TestPublicProfiles_StoreNil_NoPool_ReturnsEmpty covers the
// double-nil branch (no Store and no Profiles lookup). The handler
// must NOT panic; it must return an empty PublicProfileList so the
// SPA's connection picker can still render its zero-state UI.
func TestPublicProfiles_StoreNil_NoPool_ReturnsEmpty(t *testing.T) {
	srv := New(Config{}) // no Store, no Profiles
	r := httptest.NewRequest("GET", "/api/v1/profiles/public", nil)
	resp, err := srv.Public(httptest.NewRecorder(), r, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("Public: %v", err)
	}
	if resp == nil {
		t.Fatal("Public returned nil")
	}
	if len(resp.Profiles) != 0 {
		t.Errorf("len = %d, want 0", len(resp.Profiles))
	}
}

// namesPoolStub is a minimal ProfileLookup whose Names() returns the
// fixed slice. Lookup is not exercised by Public.
type namesPoolStub struct{ names []string }

func (n namesPoolStub) Names() []string { return n.names }
func (n namesPoolStub) Lookup(_ string) (conn.Profile, error) {
	return conn.Profile{}, errors.New("namesPoolStub: Lookup unused by Public")
}
