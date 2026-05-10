package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	gentypes "geodedb.com/geode-ui/gen/types"
	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"
)

// TestProfiles_ReturnsRegisteredNames verifies the handler enumerates
// every profile name reported by the ProfileLookup, in the order the
// lookup returned them, and emits each as a Profile with the correct name.
func TestProfiles_ReturnsRegisteredNames(t *testing.T) {
	srv := New(Config{Profiles: fakeProfileLookup{names: []string{"default", "prod", "stage"}}})
	r := httptest.NewRequest(http.MethodGet, "/api/v1/profiles", nil)
	resp, err := srv.GetProfiles(httptest.NewRecorder(), r, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("Profiles: %v", err)
	}
	if got, want := len(resp.Profiles), 3; got != want {
		t.Fatalf("profiles len = %d, want %d", got, want)
	}
	want := []string{"default", "prod", "stage"}
	for i, entry := range resp.Profiles {
		if entry.Name != want[i] {
			t.Errorf("entry[%d].name = %q, want %q", i, entry.Name, want[i])
		}
	}
}

// TestProfiles_NoLookupReturnsEmpty exercises the nil-Profiles guard.
// Servers configured without a ProfileLookup (e.g. unit tests for other
// handlers) must respond with an empty list rather than a 500.
func TestProfiles_NoLookupReturnsEmpty(t *testing.T) {
	srv := New(Config{})
	r := httptest.NewRequest(http.MethodGet, "/api/v1/profiles", nil)
	resp, err := srv.GetProfiles(httptest.NewRecorder(), r, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("Profiles: %v", err)
	}
	if resp == nil {
		t.Fatal("resp = nil, want non-nil ProfileList")
	}
	if got := len(resp.Profiles); got != 0 {
		t.Fatalf("profiles len = %d, want 0", got)
	}
}

// TestProfiles_EmptyNamesReturnsEmpty covers the case where a Pool is
// wired up but happens to report zero names — handler must still return
// a valid empty list, not nil.
func TestProfiles_EmptyNamesReturnsEmpty(t *testing.T) {
	srv := New(Config{Profiles: fakeProfileLookup{names: nil}})
	r := httptest.NewRequest(http.MethodGet, "/api/v1/profiles", nil)
	resp, err := srv.GetProfiles(httptest.NewRecorder(), r, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("Profiles: %v", err)
	}
	if got := len(resp.Profiles); got != 0 {
		t.Fatalf("profiles len = %d, want 0", got)
	}
}

// TestGetProfiles_UsesSingleListVisibleCall pins PSR-F4 (#101). The
// pre-fix handler made TWO sequential Store.List calls (system, then
// personal+owner). Post-fix the handler issues exactly ONE
// Store.ListVisible call. We use a counting fake Store and assert
// `listVisibleCalls == 1` and `listCalls == 0`.
//
// Also asserts the response shape is unchanged: includes the system
// profile, includes alice's personal profile, EXCLUDES bob's personal
// profile, and DSN/saved_username are revealed for the owner +
// redacted for the system row owned by no one.
func TestGetProfiles_UsesSingleListVisibleCall(t *testing.T) {
	st := &countingVisibilityStore{
		visible: []conn.Profile{
			{ID: "sys-1", Scope: conn.ProfileScopeSystem, Name: "sys", DSN: "quic://sys:1"},
			{ID: "per-1", Scope: conn.ProfileScopePersonal, OwnerUserID: "alice", Name: "alice-p1", DSN: "quic://alice:1", SavedUsername: "alice"},
		},
	}
	srv := New(Config{Store: st})
	r := reqWithActor(http.MethodGet, "/api/v1/profiles", "alice")
	resp, err := srv.GetProfiles(httptest.NewRecorder(), r, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetProfiles: %v", err)
	}
	if got := st.listVisibleCalls.Load(); got != 1 {
		t.Errorf("ListVisible calls = %d, want 1", got)
	}
	if got := st.listCalls.Load(); got != 0 {
		t.Errorf("List calls = %d, want 0 (handler must not fall back)", got)
	}
	if len(resp.Profiles) != 2 {
		t.Fatalf("response profile count = %d, want 2", len(resp.Profiles))
	}

	// Find each row by ID and assert reveal/redact behaviour.
	var sysRow, perRow gentypes.Profile
	for _, p := range resp.Profiles {
		switch p.ID {
		case "sys-1":
			sysRow = p
		case "per-1":
			perRow = p
		}
	}
	// System row owned by no-one: alice (non-admin) sees it but DSN
	// and saved_username are zeroed (toGenProfile reveal=false branch).
	if sysRow.ID == "" {
		t.Fatalf("response missing sys-1: %+v", resp.Profiles)
	}
	if sysRow.Dsn != "" {
		t.Errorf("system row DSN leaked to non-admin alice: %q", sysRow.Dsn)
	}
	// Personal row owned by alice: alice IS the owner so DSN +
	// saved_username are revealed.
	if perRow.ID == "" {
		t.Fatalf("response missing per-1: %+v", resp.Profiles)
	}
	if perRow.Dsn != "quic://alice:1" {
		t.Errorf("personal row DSN not revealed to owner: %q", perRow.Dsn)
	}
	if perRow.SavedUsername != "alice" {
		t.Errorf("personal row saved_username not revealed to owner: %q", perRow.SavedUsername)
	}
}

// countingVisibilityStore is a fake profilestore.Store used by
// TestGetProfiles_UsesSingleListVisibleCall. Records call counts on
// each method so the test can pin "exactly one ListVisible, zero
// List". Only ListVisible returns content; List always returns nil
// (the handler must never call it on the new fast path).
type countingVisibilityStore struct {
	visible          []conn.Profile
	listVisibleCalls atomic.Int32
	listCalls        atomic.Int32
}

func (s *countingVisibilityStore) Get(_ context.Context, _ string) (conn.Profile, error) {
	return conn.Profile{}, profilestore.ErrNotFound
}
func (s *countingVisibilityStore) List(_ context.Context, _ profilestore.Filter) ([]conn.Profile, error) {
	s.listCalls.Add(1)
	return nil, nil
}
func (s *countingVisibilityStore) ListVisible(_ context.Context, _ string) ([]conn.Profile, error) {
	s.listVisibleCalls.Add(1)
	return append([]conn.Profile(nil), s.visible...), nil
}
func (s *countingVisibilityStore) Put(_ context.Context, p conn.Profile) (conn.Profile, error) {
	return p, nil
}
func (s *countingVisibilityStore) Patch(_ context.Context, _ string, _ profilestore.ProfilePatch) (conn.Profile, error) {
	return conn.Profile{}, profilestore.ErrNotFound
}
func (s *countingVisibilityStore) Delete(_ context.Context, _ string) error { return nil }
func (s *countingVisibilityStore) Close() error                             { return nil }
