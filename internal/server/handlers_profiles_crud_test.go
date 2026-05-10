package server

import (
	"context"
	"encoding/json/jsontext"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	genapi "geodedb.com/geode-ui/gen/api"
	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// poolReloaderStub is a minimal PoolReloader for tests that need to
// observe maybeReload's behavior on success/failure.
type poolReloaderStub struct{ err error }

func (p poolReloaderStub) Reload(_ []conn.Profile) error { return p.err }

var errStubReloadFailed = errors.New("stub reload failed")

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
	r.SetPathValue("profileId", saved.ID)
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
	r.SetPathValue("profileId", saved.ID)
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
	r.SetPathValue("profileId", saved.ID)
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
	r.SetPathValue("profileId", saved.ID)
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
	r.SetPathValue("profileId", saved.ID)
	w := httptest.NewRecorder()
	_, _ = srv.DeleteProfileid(w, r, &gentypes.ProfileIDPath{ProfileID: saved.ID})
	if w.Code != http.StatusNotFound {
		t.Errorf("non-admin DELETE system: status %d, want 404", w.Code)
	}
}

// TestPostProfiles_EmitsAuditEvent verifies SECURITY_GAP S6 / GAP-PSR-G01:
// every successful profile create emits a profile_created audit event with
// actor, profile_id, scope, owner, and name keys (no DSN or PEM material).
func TestPostProfiles_EmitsAuditEvent(t *testing.T) {
	t.Cleanup(resetAuditRing())
	srv, _ := newTestServerWithStore(t)
	r := reqWithActor("POST", "/api/v1/profiles", "alice")
	got, err := srv.PostProfiles(httptest.NewRecorder(), r, &gentypes.CreateProfileReq{
		Scope: string(conn.ProfileScopePersonal),
		Name:  "p1",
		Dsn:   "quic://x:1",
	})
	if err != nil || got == nil {
		t.Fatalf("PostProfiles: got=%v err=%v", got, err)
	}
	entries := defaultAuditRing.snapshot(time.Time{})
	if len(entries) != 1 {
		t.Fatalf("audit entries: %d, want 1: %+v", len(entries), entries)
	}
	e := entries[0]
	if e.Event != "profile_created" {
		t.Errorf("event = %q, want profile_created", e.Event)
	}
	if e.Fields["actor"] != "alice" {
		t.Errorf("actor = %v, want alice", e.Fields["actor"])
	}
	if e.Fields["profile_id"] != got.ID {
		t.Errorf("profile_id = %v, want %s", e.Fields["profile_id"], got.ID)
	}
	if e.Fields["scope"] != string(conn.ProfileScopePersonal) {
		t.Errorf("scope = %v, want personal", e.Fields["scope"])
	}
	if e.Fields["owner"] != "alice" {
		t.Errorf("owner = %v, want alice", e.Fields["owner"])
	}
	if e.Fields["name"] != "p1" {
		t.Errorf("name = %v, want p1", e.Fields["name"])
	}
	if _, ok := e.Fields["dsn"]; ok {
		t.Errorf("DSN must not appear in audit fields: %v", e.Fields)
	}
}

// TestPostProfiles_AuditNotEmittedOnFailure verifies the negative path:
// a forbidden create attempt emits no profile_created event.
func TestPostProfiles_AuditNotEmittedOnFailure(t *testing.T) {
	t.Cleanup(resetAuditRing())
	srv, _ := newTestServerWithStore(t)
	r := reqWithActor("POST", "/api/v1/profiles", "bob") // not admin
	w := httptest.NewRecorder()
	_, _ = srv.PostProfiles(w, r, &gentypes.CreateProfileReq{
		Scope: string(conn.ProfileScopeSystem), Name: "x", Dsn: "quic://x:1",
	})
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
	for _, e := range defaultAuditRing.snapshot(time.Time{}) {
		if e.Event == "profile_created" {
			t.Errorf("audit emitted on failure: %+v", e)
		}
	}
}

// TestPatchProfileid_EmitsAuditEvent verifies the update path.
func TestPatchProfileid_EmitsAuditEvent(t *testing.T) {
	t.Cleanup(resetAuditRing())
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice", Name: "p1", DSN: "quic://x:1",
	})
	r := reqWithActor("PATCH", "/api/v1/profiles/"+saved.ID, "alice")
	r.SetPathValue("profileId", saved.ID)
	w := httptest.NewRecorder()
	_, err := srv.PatchProfileid(w, r, &gentypes.UpdateProfileReq{Description: "updated"})
	if err != nil {
		t.Fatalf("PatchProfileid: %v", err)
	}
	updated := false
	for _, e := range defaultAuditRing.snapshot(time.Time{}) {
		if e.Event == "profile_updated" && e.Fields["profile_id"] == saved.ID {
			updated = true
			if e.Fields["actor"] != "alice" {
				t.Errorf("actor = %v, want alice", e.Fields["actor"])
			}
			if e.Fields["scope"] != string(conn.ProfileScopePersonal) {
				t.Errorf("scope = %v", e.Fields["scope"])
			}
		}
	}
	if !updated {
		t.Errorf("profile_updated event not emitted")
	}
}

// TestDeleteProfileid_EmitsAuditEvent verifies the delete path.
func TestDeleteProfileid_EmitsAuditEvent(t *testing.T) {
	t.Cleanup(resetAuditRing())
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "sys", DSN: "quic://x:1",
	})
	r := reqWithActor("DELETE", "/api/v1/profiles/"+saved.ID, "ops", "admin")
	r.SetPathValue("profileId", saved.ID)
	w := httptest.NewRecorder()
	if _, err := srv.DeleteProfileid(w, r, &gentypes.ProfileIDPath{ProfileID: saved.ID}); err != nil {
		t.Fatalf("DeleteProfileid: %v", err)
	}
	deleted := false
	for _, e := range defaultAuditRing.snapshot(time.Time{}) {
		if e.Event == "profile_deleted" && e.Fields["profile_id"] == saved.ID {
			deleted = true
			if e.Fields["actor"] != "ops" {
				t.Errorf("actor = %v, want ops", e.Fields["actor"])
			}
			if e.Fields["scope"] != string(conn.ProfileScopeSystem) {
				t.Errorf("scope = %v", e.Fields["scope"])
			}
			if e.Fields["name"] != "sys" {
				t.Errorf("name = %v, want sys", e.Fields["name"])
			}
		}
	}
	if !deleted {
		t.Errorf("profile_deleted event not emitted")
	}
}

// TestMaybeReload_EmitsAuditOnReloadFailure verifies PSR-G08: when the
// pool reloader rejects the new profile set, a profile_reload_failed
// audit event is emitted (not just a slog warning).
func TestMaybeReload_EmitsAuditOnReloadFailure(t *testing.T) {
	t.Cleanup(resetAuditRing())
	srv, st := newTestServerWithStore(t)
	_, _ = st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice", Name: "p1", DSN: "quic://x:1",
	})
	srv.cfg.PoolReloader = poolReloaderStub{err: errStubReloadFailed}
	srv.maybeReload(context.WithValue(context.Background(), userCtxKey, "alice"))
	failed := false
	for _, e := range defaultAuditRing.snapshot(time.Time{}) {
		if e.Event == "profile_reload_failed" {
			failed = true
			if e.Fields["actor"] != "alice" {
				t.Errorf("actor = %v, want alice", e.Fields["actor"])
			}
			if e.Fields["phase"] != "reload" {
				t.Errorf("phase = %v, want reload", e.Fields["phase"])
			}
		}
	}
	if !failed {
		t.Errorf("profile_reload_failed event not emitted")
	}
}

// TestPatchProfileid_TLSClearViaEmptyObject pins PSR-G02 end-to-end:
// when the SPA sends `tls: {}` in the PATCH body (the wire signal for
// "clear all TLS material"), the server actually clears every PEM
// fragment instead of preserving the previous values.
func TestPatchProfileid_TLSClearViaEmptyObject(t *testing.T) {
	t.Cleanup(resetAuditRing())
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice",
		Name: "p1", DSN: "quic://x:1",
		TLS: conn.TLSMaterial{CAPEM: "ca", ClientCertPEM: "cert", ClientKeyPEM: "key"},
	})
	r := reqWithActor("PATCH", "/api/v1/profiles/"+saved.ID, "alice")
	r.SetPathValue("profileId", saved.ID)
	w := httptest.NewRecorder()
	got, err := srv.PatchProfileid(w, r, &gentypes.UpdateProfileReq{
		TLS: jsontext.Value(`{}`),
	})
	if err != nil || got == nil {
		t.Fatalf("PatchProfileid: got=%v err=%v code=%d body=%s", got, err, w.Code, w.Body.String())
	}
	// Persisted state should reflect the clear.
	got2, _ := st.Get(context.Background(), saved.ID)
	if got2.TLS.CAPEM != "" || got2.TLS.ClientCertPEM != "" || got2.TLS.ClientKeyPEM != "" {
		t.Errorf("TLS not cleared by PATCH: %+v", got2.TLS)
	}
}

// TestPatchProfileid_TLSPreservedWhenAbsent is the matching positive
// case: a PATCH that omits the tls key entirely (jsontext.Value of
// length 0) leaves the previously-stored TLS material untouched.
func TestPatchProfileid_TLSPreservedWhenAbsent(t *testing.T) {
	t.Cleanup(resetAuditRing())
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice",
		Name: "p1", DSN: "quic://x:1",
		TLS: conn.TLSMaterial{CAPEM: "keep-me"},
	})
	r := reqWithActor("PATCH", "/api/v1/profiles/"+saved.ID, "alice")
	r.SetPathValue("profileId", saved.ID)
	w := httptest.NewRecorder()
	_, err := srv.PatchProfileid(w, r, &gentypes.UpdateProfileReq{
		Description: "tweak only",
	})
	if err != nil {
		t.Fatalf("PatchProfileid: %v", err)
	}
	got, _ := st.Get(context.Background(), saved.ID)
	if got.TLS.CAPEM != "keep-me" {
		t.Errorf("TLS clobbered when absent: %q", got.TLS.CAPEM)
	}
	if got.Description != "tweak only" {
		t.Errorf("Description not updated: %q", got.Description)
	}
}

// TestPatchProfileid_PoolOverridesClearViaEmptyObject pins PSR-G02 for
// pool overrides via the same `pool_overrides: {}` wire signal.
func TestPatchProfileid_PoolOverridesClearViaEmptyObject(t *testing.T) {
	t.Cleanup(resetAuditRing())
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice",
		Name: "p1", DSN: "quic://x:1",
		PoolOverrides: conn.PoolOverrides{
			MaxOpenConns:    32,
			MaxIdleConns:    8,
			ConnMaxLifetime: 90 * time.Second,
			ConnMaxIdleTime: 30 * time.Second,
		},
	})
	r := reqWithActor("PATCH", "/api/v1/profiles/"+saved.ID, "alice")
	r.SetPathValue("profileId", saved.ID)
	w := httptest.NewRecorder()
	_, err := srv.PatchProfileid(w, r, &gentypes.UpdateProfileReq{
		PoolOverrides: jsontext.Value(`{}`),
	})
	if err != nil {
		t.Fatalf("PatchProfileid: %v", err)
	}
	got, _ := st.Get(context.Background(), saved.ID)
	po := got.PoolOverrides
	if po.MaxOpenConns != 0 || po.MaxIdleConns != 0 || po.ConnMaxLifetime != 0 || po.ConnMaxIdleTime != 0 {
		t.Errorf("PoolOverrides not cleared by PATCH: %+v", po)
	}
}

// TestGetProfileid_MuxPathBinding_CamelCaseToken is an integration test that
// verifies the genapi-emitted route handler correctly populates req.ProfileID
// from r.PathValue("profileId") when the route is registered through the full
// http.ServeMux via RegisterGeneratedAPI.
//
// Before the fix in the genapi generator, the emitted code omitted the
// r.PathValue("profileId") line (because the path token "profileId" did not
// exactly match the json tag "profile_id"), so req.ProfileID was always "",
// the Valid() check failed (minLength=1 violated), and every GET/DELETE on a
// per-id endpoint returned 400 {"error":"bad request: ..."} in production.
//
// This test proves the 400 → 404/200 transition: with the generator fix the
// request now reaches the handler (ProfileID is correctly populated), and the
// response is 404 for an unknown ID rather than 400 for a validation failure.
func TestGetProfileid_MuxPathBinding_CamelCaseToken(t *testing.T) {
	srv, _ := newTestServerWithStore(t)

	// stubAuthJWT injects an actor into the request context so the JWT gate
	// passes without a real token issuer. This mirrors the same-package
	// technique used throughout this file (reqWithActor sets context values
	// directly), adapted for the generated mux middleware which calls the
	// AuthJWT function rather than reading the context values we set.
	stubAuthJWT := func(r *http.Request) error {
		ctx := r.Context()
		ctx = context.WithValue(ctx, userCtxKey, "alice")
		ctx = context.WithValue(ctx, rolesCtxKey, []string{})
		*r = *r.WithContext(ctx)
		return nil
	}

	mux := http.NewServeMux()
	genapi.RegisterGeneratedAPI(mux, srv, genapi.APIOptions{
		AuthJWT: stubAuthJWT,
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	// Use a well-formed but non-existent UUID so the mux populates
	// profileId, Valid() passes, and the handler reaches Store.Get.
	// We expect 404 (profile not found), NOT 400 (bad request / missing_id).
	fakeID := "00000000-0000-0000-0000-000000000000"
	resp, err := http.Get(ts.URL + "/api/v1/profiles/" + fakeID)
	if err != nil {
		t.Fatalf("GET /api/v1/profiles/%s: %v", fakeID, err)
	}
	defer func() { _ = resp.Body.Close() }()

	// Before the generator fix: 400 (req.ProfileID was "" → Valid() failed).
	// After the fix:            404 (ProfileID correctly bound → handler ran → not found).
	if resp.StatusCode == http.StatusBadRequest {
		t.Errorf("GET /api/v1/profiles/{profileId} returned 400 (Bad Request); " +
			"this indicates req.ProfileID was empty, meaning r.PathValue(\"profileId\") " +
			"was not emitted by the generator. Expected 404 (Not Found).")
	}
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("GET /api/v1/profiles/%s: status=%d, want 404", fakeID, resp.StatusCode)
	}
}
