package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// newTestServerWithStore builds a GraphServer wired to an in-memory
// profilestore. The legacy Profiles lookup is left nil; only Store
// flows in this test.
func newTestServerWithStore(t *testing.T) (*GraphServer, profilestore.Store) {
	t.Helper()
	st, err := profilestore.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return New(Config{Store: st}), st
}

// reqWithActor builds an http.Request whose context carries the
// authenticated actor. Same-package access to userCtxKey/rolesCtxKey.
func reqWithActor(method, path string, sub string, roles ...string) *http.Request {
	r := httptest.NewRequest(method, path, nil)
	ctx := context.WithValue(r.Context(), userCtxKey, sub)
	ctx = context.WithValue(ctx, rolesCtxKey, append([]string(nil), roles...))
	return r.WithContext(ctx)
}

func TestPostProfiles_PersonalDefaultsOwnerToActor(t *testing.T) {
	srv, _ := newTestServerWithStore(t)
	r := reqWithActor("POST", "/api/v1/profiles", "alice")
	got, err := srv.PostProfiles(httptest.NewRecorder(), r, &gentypes.CreateProfileReq{
		Scope: string(conn.ProfileScopePersonal),
		Name:  "p1",
		Dsn:   "quic://x:1",
	})
	if err != nil {
		t.Fatalf("PostProfiles: %v", err)
	}
	if got == nil || got.ID == "" {
		t.Fatalf("PostProfiles returned %+v", got)
	}
	if got.OwnerUserID != "alice" {
		t.Errorf("OwnerUserID = %q, want alice", got.OwnerUserID)
	}
}

func TestPostProfiles_SystemRequiresAdmin(t *testing.T) {
	srv, _ := newTestServerWithStore(t)
	r := reqWithActor("POST", "/api/v1/profiles", "bob") // no admin role
	w := httptest.NewRecorder()
	_, _ = srv.PostProfiles(w, r, &gentypes.CreateProfileReq{
		Scope: string(conn.ProfileScopeSystem), Name: "x", Dsn: "quic://x:1",
	})
	if w.Code != http.StatusForbidden {
		t.Errorf("non-admin POST system: status %d, want 403", w.Code)
	}
}

func TestPostProfiles_AdminCreatesSystem(t *testing.T) {
	srv, _ := newTestServerWithStore(t)
	r := reqWithActor("POST", "/api/v1/profiles", "ops", "admin")
	got, err := srv.PostProfiles(httptest.NewRecorder(), r, &gentypes.CreateProfileReq{
		Scope: string(conn.ProfileScopeSystem), Name: "sys-prod", Dsn: "quic://prod:1",
	})
	if err != nil {
		t.Fatalf("admin POST system: %v", err)
	}
	if got.OwnerUserID != "" {
		t.Errorf("system profile carries owner: %q", got.OwnerUserID)
	}
}

func TestGetProfileid_RedactsForNonOwner(t *testing.T) {
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "sys", DSN: "quic://secret:1",
	})
	r := reqWithActor("GET", "/api/v1/profiles/"+saved.ID, "alice") // no admin
	r.SetPathValue("profile_id", saved.ID)
	got, err := srv.GetProfileid(httptest.NewRecorder(), r, &gentypes.ProfileIDPath{ProfileID: saved.ID})
	if err != nil {
		t.Fatalf("GetProfileid: %v", err)
	}
	if got.Dsn != "" {
		t.Errorf("DSN leaked to non-admin: %q", got.Dsn)
	}
	if strings.Contains(got.Dsn, "secret") {
		t.Errorf("DSN contains the secret marker")
	}
}

func TestGetProfileid_PersonalForAnotherUser_NotFound(t *testing.T) {
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice", Name: "p1", DSN: "quic://x:1",
	})
	r := reqWithActor("GET", "/api/v1/profiles/"+saved.ID, "bob")
	r.SetPathValue("profile_id", saved.ID)
	w := httptest.NewRecorder()
	_, _ = srv.GetProfileid(w, r, &gentypes.ProfileIDPath{ProfileID: saved.ID})
	if w.Code != http.StatusNotFound {
		t.Errorf("non-owner GET personal: status %d, want 404", w.Code)
	}
}

func TestPatchProfileid_NonOwnerReturns404(t *testing.T) {
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice", Name: "p1", DSN: "quic://x:1",
	})
	r := reqWithActor("PATCH", "/api/v1/profiles/"+saved.ID, "bob")
	r.SetPathValue("profile_id", saved.ID)
	w := httptest.NewRecorder()
	_, _ = srv.PatchProfileid(w, r, &gentypes.UpdateProfileReq{Description: "by bob"})
	if w.Code != http.StatusNotFound {
		t.Errorf("non-owner PATCH personal: status %d, want 404", w.Code)
	}
}

func TestDeleteProfileid_AdminCanDeleteSystem(t *testing.T) {
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "sys", DSN: "quic://x:1",
	})
	r := reqWithActor("DELETE", "/api/v1/profiles/"+saved.ID, "ops", "admin")
	r.SetPathValue("profile_id", saved.ID)
	w := httptest.NewRecorder()
	_, err := srv.DeleteProfileid(w, r, &gentypes.ProfileIDPath{ProfileID: saved.ID})
	if err != nil {
		t.Fatalf("admin DELETE system: %v", err)
	}
	// 200/204/etc — anything in 2xx is fine. The handler returns Empty and lets the
	// genapi response writer set the status.
	if w.Code != 0 && w.Code/100 != 2 {
		t.Errorf("admin DELETE system: status %d, want 2xx", w.Code)
	}
}

func TestDeleteProfileid_NonAdminCannotDeleteSystem(t *testing.T) {
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "sys", DSN: "quic://x:1",
	})
	r := reqWithActor("DELETE", "/api/v1/profiles/"+saved.ID, "alice")
	r.SetPathValue("profile_id", saved.ID)
	w := httptest.NewRecorder()
	_, _ = srv.DeleteProfileid(w, r, &gentypes.ProfileIDPath{ProfileID: saved.ID})
	if w.Code != http.StatusNotFound {
		t.Errorf("non-admin DELETE system: status %d, want 404", w.Code)
	}
}
