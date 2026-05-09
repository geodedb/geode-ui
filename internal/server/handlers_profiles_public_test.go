package server

import (
	"context"
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
