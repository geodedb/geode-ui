package server

import (
	"bytes"
	"context"
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

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

// TestMarshalProfileWire_ZeroFastPath pins the PSR-F15 micro-opt:
// marshalTLS / marshalPoolOverrides return the precomputed zero
// encoding (same backing array, no per-call json.Marshal) for the
// zero input, AND that encoding is byte-identical to a fresh marshal
// of the corresponding wire struct — i.e. the optimisation changes no
// observable output. Non-zero inputs still go through the encoder and
// reflect their fields.
func TestMarshalProfileWire_ZeroFastPath(t *testing.T) {
	// --- TLS ---
	zTLS, err := marshalTLS(conn.TLSMaterial{})
	if err != nil {
		t.Fatalf("marshalTLS(zero): %v", err)
	}
	// Pointer identity with the package-level constant: no allocation.
	if &zTLS[0] != &zeroTLSWire[0] {
		t.Errorf("marshalTLS(zero) did not return the shared zeroTLSWire backing array")
	}
	wantTLS, _ := json.Marshal(tlsWire{})
	if !bytes.Equal(zTLS, wantTLS) {
		t.Errorf("marshalTLS(zero) = %q, want %q (must match a fresh marshal)", zTLS, wantTLS)
	}

	nzTLS, err := marshalTLS(conn.TLSMaterial{CAPEM: "PEM-CA", ClientCertPEM: "PEM-CERT"})
	if err != nil {
		t.Fatalf("marshalTLS(non-zero): %v", err)
	}
	wantNZTLS, _ := json.Marshal(tlsWire{CAPEM: "PEM-CA", ClientCertPEM: "PEM-CERT"})
	if !bytes.Equal(nzTLS, wantNZTLS) {
		t.Errorf("marshalTLS(non-zero) = %q, want %q", nzTLS, wantNZTLS)
	}
	// A non-zero result must not alias the shared constant.
	if len(nzTLS) > 0 && len(zeroTLSWire) > 0 && &nzTLS[0] == &zeroTLSWire[0] {
		t.Errorf("marshalTLS(non-zero) aliased the shared zero constant")
	}

	// --- PoolOverrides ---
	zPO, err := marshalPoolOverrides(conn.PoolOverrides{})
	if err != nil {
		t.Fatalf("marshalPoolOverrides(zero): %v", err)
	}
	if &zPO[0] != &zeroPOWire[0] {
		t.Errorf("marshalPoolOverrides(zero) did not return the shared zeroPOWire backing array")
	}
	wantPO, _ := json.Marshal(poolOverridesWire{})
	if !bytes.Equal(zPO, wantPO) {
		t.Errorf("marshalPoolOverrides(zero) = %q, want %q (must match a fresh marshal)", zPO, wantPO)
	}

	nzPO, err := marshalPoolOverrides(conn.PoolOverrides{
		MaxOpenConns:    32,
		MaxIdleConns:    8,
		ConnMaxLifetime: 5 * time.Minute,
		ConnMaxIdleTime: 25 * time.Second,
	})
	if err != nil {
		t.Fatalf("marshalPoolOverrides(non-zero): %v", err)
	}
	wantNZPO, _ := json.Marshal(poolOverridesWire{
		MaxOpenConns:      32,
		MaxIdleConns:      8,
		ConnMaxLifetimeMs: int64(5 * time.Minute / time.Millisecond),
		ConnMaxIdleMs:     int64(25 * time.Second / time.Millisecond),
	})
	if !bytes.Equal(nzPO, wantNZPO) {
		t.Errorf("marshalPoolOverrides(non-zero) = %q, want %q", nzPO, wantNZPO)
	}
}
