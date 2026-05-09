package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	gentypes "geodedb.com/geode-ui/gen/types"
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
