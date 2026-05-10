package server

import (
	"context"
	"encoding/json/jsontext"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	genapi "geodedb.com/geode-ui/gen/api"
	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// sp returns &v. Test helper for building gentypes.UpdateProfileReq
// literals now that nullable scalars come through as *string.
func sp(v string) *string { return &v }

// bp returns &v. Mirror of sp for *bool fields like is_default.
func bp(v bool) *bool { return &v }

// silenceSlog redirects slog.Default() to io.Discard for the lifetime
// of the test/benchmark and restores the prior logger via b.Cleanup.
// Used by the F1 benchmarks to keep the audit-event INFO lines from
// dominating the run and skewing the wall-clock measurement.
func silenceSlog(tb testing.TB) {
	tb.Helper()
	prior := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	tb.Cleanup(func() { slog.SetDefault(prior) })
}

// poolReloaderStub is a minimal PoolReloader for tests that need to
// observe maybeReload's behavior on success/failure.
type poolReloaderStub struct{ err error }

func (p poolReloaderStub) Reload(_ []conn.Profile) error { return p.err }

var errStubReloadFailed = errors.New("stub reload failed")

// poolReloaderCounter tracks the number of Reload invocations and
// optionally blocks each call on a release channel. Used by F1
// (async + singleflight) tests.
type poolReloaderCounter struct {
	calls   atomic.Int64
	release chan struct{} // optional: when non-nil, every Reload waits on receive before returning
	err     error
}

func (p *poolReloaderCounter) Reload(_ []conn.Profile) error {
	p.calls.Add(1)
	if p.release != nil {
		<-p.release
	}
	return p.err
}

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
	_, _ = srv.PatchProfileid(w, r, &gentypes.UpdateProfileReq{Description: sp("by bob")})
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
	_, err := srv.PatchProfileid(w, r, &gentypes.UpdateProfileReq{Description: sp("updated")})
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
	// Post-F1 maybeReload spawns the work in a goroutine; wait for it
	// to drain before sampling the audit ring.
	srv.awaitReloadIdle()
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
		Description: sp("tweak only"),
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

// TestPostProfiles_ReturnsBeforeReloadCompletes pins PSR-F1 (#94):
// PostProfiles must return to the client without waiting for the
// PoolReloader to finish. Pre-fix maybeReload was a synchronous call
// in the handler critical path, so a slow Reload (cold pool warm-up,
// upstream Geode handshake, etc.) blocked the HTTP response until it
// returned.
//
// We block the stub PoolReloader on a release channel and assert
// PostProfiles returns within a short timeout. If the handler is
// still synchronous, this will deadlock and time out.
func TestPostProfiles_ReturnsBeforeReloadCompletes(t *testing.T) {
	t.Cleanup(resetAuditRing())
	srv, _ := newTestServerWithStore(t)
	stub := &poolReloaderCounter{release: make(chan struct{})}
	srv.cfg.PoolReloader = stub

	r := reqWithActor("POST", "/api/v1/profiles", "alice")
	done := make(chan struct{})
	go func() {
		_, _ = srv.PostProfiles(httptest.NewRecorder(), r, &gentypes.CreateProfileReq{
			Scope: string(conn.ProfileScopePersonal),
			Name:  "p1",
			Dsn:   "quic://x:1",
		})
		close(done)
	}()
	select {
	case <-done:
		// expected: handler returned without waiting for Reload
	case <-time.After(2 * time.Second):
		t.Fatalf("PostProfiles blocked on Reload; handler is still synchronous")
	}
	// Release the in-flight Reload BEFORE awaiting it; otherwise the
	// background goroutine deadlocks on the receive.
	close(stub.release)
	srv.awaitReloadIdle()
}

// TestPatchProfileid_ReturnsBeforeReloadCompletes is the PATCH analogue
// of TestPostProfiles_ReturnsBeforeReloadCompletes.
func TestPatchProfileid_ReturnsBeforeReloadCompletes(t *testing.T) {
	t.Cleanup(resetAuditRing())
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice",
		Name: "p1", DSN: "quic://x:1",
	})
	stub := &poolReloaderCounter{release: make(chan struct{})}
	srv.cfg.PoolReloader = stub

	r := reqWithActor("PATCH", "/api/v1/profiles/"+saved.ID, "alice")
	r.SetPathValue("profileId", saved.ID)
	done := make(chan struct{})
	go func() {
		_, _ = srv.PatchProfileid(httptest.NewRecorder(), r, &gentypes.UpdateProfileReq{
			Description: sp("updated"),
		})
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatalf("PatchProfileid blocked on Reload; handler is still synchronous")
	}
	close(stub.release)
	srv.awaitReloadIdle()
}

// TestMaybeReload_CoalescesConcurrentTriggers pins the singleflight
// semantics: N rapid PATCHes that overlap each other in time MUST
// collapse to a small constant number of underlying Reload calls (1-2,
// not N). The first goroutine's Reload runs while the rest pile up
// behind the singleflight key; once the first completes, at most one
// follow-up runs to absorb the latest version.
func TestMaybeReload_CoalescesConcurrentTriggers(t *testing.T) {
	t.Cleanup(resetAuditRing())
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice",
		Name: "p1", DSN: "quic://x:1",
	})

	release := make(chan struct{})
	stub := &poolReloaderCounter{release: release}
	srv.cfg.PoolReloader = stub

	// Fire 10 rapid maybeReload triggers. Without singleflight this
	// would spawn 10 in-flight Reload goroutines, all blocked on
	// release. With singleflight, only 1 is in-flight; the rest are
	// coalesced behind the same key.
	const N = 10
	var wg sync.WaitGroup
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx := context.WithValue(context.Background(), userCtxKey, "alice")
			srv.maybeReload(ctx)
		}()
	}
	wg.Wait()

	// Give the spawned goroutines a moment to register with the
	// singleflight Group, then release.
	time.Sleep(50 * time.Millisecond)
	close(release)

	srv.awaitReloadIdle()

	// We expect 1 (perfect coalescing) or 2 (one in-flight + one
	// follow-up that observed a newer version mid-flight). Anything
	// >= N indicates singleflight is not engaged.
	got := stub.calls.Load()
	if got < 1 || got > 2 {
		t.Errorf("Reload calls = %d after %d triggers; want 1 or 2 (singleflight coalescing)",
			got, N)
	}
	// Sanity: ensure the row we created is still the only one persisted.
	all, _ := st.List(context.Background(), profilestore.Filter{})
	if len(all) != 1 || all[0].ID != saved.ID {
		t.Errorf("unexpected store state: %+v", all)
	}
}

// slowPoolReloader is a benchmark-side PoolReloader that sleeps for a
// fixed duration to simulate a real Reload doing pool warm-up,
// upstream handshake, etc. The sleep is the single dominant cost we
// want to keep OFF the request critical path post-F1.
type slowPoolReloader struct {
	d     time.Duration
	calls atomic.Int64
}

func (s *slowPoolReloader) Reload(_ []conn.Profile) error {
	s.calls.Add(1)
	time.Sleep(s.d)
	return nil
}

// BenchmarkPostProfile measures POST /api/v1/profiles handler latency
// when PoolReloader.Reload sleeps for a fixed 5 ms (representative of
// a cold pool warm-up). Pre-F1 the handler waited for Reload, so each
// op carried the 5ms tax. Post-F1 the handler returns immediately and
// the Reload runs out-of-band; the benchmark measures the
// request-critical-path latency only.
func BenchmarkPostProfile(b *testing.B) {
	silenceSlog(b)
	srv, _ := newBenchServer(b)
	srv.cfg.PoolReloader = &slowPoolReloader{d: 5 * time.Millisecond}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		r := reqWithActor("POST", "/api/v1/profiles", "alice")
		_, err := srv.PostProfiles(httptest.NewRecorder(), r, &gentypes.CreateProfileReq{
			Scope: string(conn.ProfileScopePersonal),
			Name:  "p" + atoiBenchKey(i),
			Dsn:   "quic://x:1",
		})
		if err != nil {
			b.Fatal(err)
		}
	}
	b.StopTimer()
	srv.awaitReloadIdle()
}

// BenchmarkPatchProfile is the PATCH analogue of BenchmarkPostProfile.
// We pre-seed N profiles and PATCH them in round-robin order so each
// op does a real Get + UPDATE (no caching tricks).
func BenchmarkPatchProfile(b *testing.B) {
	silenceSlog(b)
	srv, st := newBenchServer(b)
	srv.cfg.PoolReloader = &slowPoolReloader{d: 5 * time.Millisecond}
	const seed = 64
	ids := make([]string, seed)
	for i := 0; i < seed; i++ {
		saved, _ := st.Put(context.Background(), conn.Profile{
			Scope: conn.ProfileScopePersonal, OwnerUserID: "alice",
			Name: "p" + atoiBenchKey(i), DSN: "quic://x:1",
		})
		ids[i] = saved.ID
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		id := ids[i%seed]
		r := reqWithActor("PATCH", "/api/v1/profiles/"+id, "alice")
		r.SetPathValue("profileId", id)
		desc := "tweak-" + atoiBenchKey(i)
		_, err := srv.PatchProfileid(httptest.NewRecorder(), r, &gentypes.UpdateProfileReq{
			Description: &desc,
		})
		if err != nil {
			b.Fatal(err)
		}
	}
	b.StopTimer()
	srv.awaitReloadIdle()
}

// newBenchServer is a benchmark-only wrapper around newTestServerWithStore
// that accepts a *testing.B (the test helper requires *testing.T).
func newBenchServer(b *testing.B) (*GraphServer, profilestore.Store) {
	b.Helper()
	st, err := profilestore.OpenSQLite(":memory:")
	if err != nil {
		b.Fatalf("OpenSQLite: %v", err)
	}
	b.Cleanup(func() { _ = st.Close() })
	return New(Config{Store: st}), st
}

// atoiBenchKey returns a short stable string for benchmark id padding.
// Avoids strconv import drift in this file.
func atoiBenchKey(i int) string {
	const digits = "0123456789abcdef"
	if i == 0 {
		return "0"
	}
	var buf [16]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = digits[i&0xF]
		i >>= 4
	}
	return string(buf[pos:])
}

// TestStoreErrorToHTTP pins GAP-Q12 (#107): every profilestore.Err*
// variant maps to a stable HTTP status + machine-readable code, and
// every other error falls through to a 500 with the wrapped error
// surfaced verbatim in the description (so server logs can reproduce
// it). This is the only spot in the server where we translate the
// store's typed errors back to a wire shape; tightening it pre-empts
// the "404 turned into a 500 because someone shadowed the variant"
// regression class.
//
// Each case constructs an error wrapping the variant (errors.Is must
// see through a fmt.Errorf("%w", ...) wrapper, which is the actual
// shape the store returns). The default branch is exercised with a
// novel sentinel so we observe the description carries the wrapped
// message verbatim.
func TestStoreErrorToHTTP(t *testing.T) {
	customDB := errors.New("disk full")
	cases := []struct {
		name       string
		in         error
		wantStatus int
		wantCode   string
		// wantDescContains is checked with strings.Contains so the
		// table doesn't have to mirror the exact wording for variants
		// whose description is statically declared.
		wantDescContains string
	}{
		{
			name:             "ErrNotFound",
			in:               profilestore.ErrNotFound,
			wantStatus:       http.StatusNotFound,
			wantCode:         "not_found",
			wantDescContains: "profile not found",
		},
		{
			name:             "ErrNotFound_wrapped",
			in:               errors.Join(errors.New("layer1"), profilestore.ErrNotFound),
			wantStatus:       http.StatusNotFound,
			wantCode:         "not_found",
			wantDescContains: "profile not found",
		},
		{
			name:             "ErrConflict",
			in:               profilestore.ErrConflict,
			wantStatus:       http.StatusConflict,
			wantCode:         "conflict",
			wantDescContains: "already exists",
		},
		{
			name:             "ErrConflict_wrapped_with_scope_name",
			in:               errors.Join(profilestore.ErrConflict, errors.New("scope=system name=p1")),
			wantStatus:       http.StatusConflict,
			wantCode:         "conflict",
			wantDescContains: "already exists",
		},
		{
			name:             "ErrImmutable",
			in:               profilestore.ErrImmutable,
			wantStatus:       http.StatusBadRequest,
			wantCode:         "immutable",
			wantDescContains: "scope and owner",
		},
		{
			name:             "ErrInvalid",
			in:               profilestore.ErrInvalid,
			wantStatus:       http.StatusBadRequest,
			wantCode:         "invalid",
			wantDescContains: "validation",
		},
		{
			name:             "default_unknown_error",
			in:               customDB,
			wantStatus:       http.StatusInternalServerError,
			wantCode:         "internal_error",
			wantDescContains: "disk full",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ep := storeErrorToHTTP(tc.in)
			if ep == nil {
				t.Fatalf("storeErrorToHTTP returned nil for %v", tc.in)
			}
			if ep.status != tc.wantStatus {
				t.Errorf("status = %d, want %d", ep.status, tc.wantStatus)
			}
			if ep.code != tc.wantCode {
				t.Errorf("code = %q, want %q", ep.code, tc.wantCode)
			}
			if tc.wantDescContains != "" && !strings.Contains(ep.description, tc.wantDescContains) {
				t.Errorf("description = %q, want substring %q", ep.description, tc.wantDescContains)
			}
		})
	}
}

// TestStoreErrorToHTTP_NilSafety pins one defensive branch: storeErrorToHTTP(nil)
// must not panic. The existing CRUD handlers all gate the call on a non-nil
// error, but nothing in the helper's signature enforces that contract; if a
// future caller ever passes nil through, we should fail loudly with a 500
// rather than crashing the request goroutine.
func TestStoreErrorToHTTP_NilSafety(t *testing.T) {
	ep := storeErrorToHTTP(nil)
	if ep == nil {
		t.Fatal("storeErrorToHTTP(nil) returned nil; want a 500 endpointError")
	}
	if ep.status != http.StatusInternalServerError {
		t.Errorf("nil-input status = %d, want 500", ep.status)
	}
}

// TestPatchProfileid_IsDefaultPointerSemantics pins the post-PSR-G02
// contract for is_default now that genapi emits `IsDefault *bool` (#124).
// Pointer presence drives the semantics:
//
//   - IsDefault nil           -> absent on wire   -> preserve current default
//   - IsDefault non-nil true  -> set to true
//   - IsDefault non-nil false -> set to false (clear the default flag)
//
// Replaces the legacy AlwaysEchoesIsDefault contract that had to flip
// is_default to false on every PATCH because the schema couldn't tell
// "absent" from `false`.
func TestPatchProfileid_IsDefaultPointerSemantics(t *testing.T) {
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice",
		Name: "p1", DSN: "quic://x:1", Default: true,
	})
	if !saved.Default {
		t.Fatalf("Put: Default not stored as true: %+v", saved)
	}

	// 1. PATCH that omits is_default leaves the persisted Default=true.
	r := reqWithActor("PATCH", "/api/v1/profiles/"+saved.ID, "alice")
	r.SetPathValue("profileId", saved.ID)
	w := httptest.NewRecorder()
	got, err := srv.PatchProfileid(w, r, &gentypes.UpdateProfileReq{
		// IsDefault deliberately omitted (nil pointer => preserve).
		Description: sp("tweak"),
	})
	if err != nil {
		t.Fatalf("PatchProfileid: %v", err)
	}
	if got == nil {
		t.Fatalf("PatchProfileid returned nil profile")
	}
	if !got.IsDefault {
		t.Errorf("PATCH cleared IsDefault when the request omitted the key")
	}
	persisted, _ := st.Get(context.Background(), saved.ID)
	if !persisted.Default {
		t.Errorf("persisted Default flipped on omit-PATCH: %+v", persisted)
	}

	// 2. PATCH with IsDefault=false explicitly clears the default flag.
	r = reqWithActor("PATCH", "/api/v1/profiles/"+saved.ID, "alice")
	r.SetPathValue("profileId", saved.ID)
	w = httptest.NewRecorder()
	got, err = srv.PatchProfileid(w, r, &gentypes.UpdateProfileReq{
		IsDefault: bp(false),
	})
	if err != nil {
		t.Fatalf("PatchProfileid (set false): %v", err)
	}
	if got.IsDefault {
		t.Errorf("PATCH IsDefault=false did not clear: %+v", got)
	}
	persisted, _ = st.Get(context.Background(), saved.ID)
	if persisted.Default {
		t.Errorf("PATCH IsDefault=false did not persist clear: %+v", persisted)
	}

	// 3. PATCH with IsDefault=true round-trips back to true.
	r = reqWithActor("PATCH", "/api/v1/profiles/"+saved.ID, "alice")
	r.SetPathValue("profileId", saved.ID)
	w = httptest.NewRecorder()
	got, err = srv.PatchProfileid(w, r, &gentypes.UpdateProfileReq{
		IsDefault: bp(true),
	})
	if err != nil {
		t.Fatalf("PatchProfileid (set true): %v", err)
	}
	if !got.IsDefault {
		t.Errorf("PATCH IsDefault=true did not stick on response: %+v", got)
	}
	persisted, _ = st.Get(context.Background(), saved.ID)
	if !persisted.Default {
		t.Errorf("PATCH IsDefault=true did not persist: %+v", persisted)
	}
}

// TestPatchProfileid_DescriptionClearViaEmptyString pins the new
// PSR-G02-followup contract for nullable scalar fields: a non-nil
// pointer to "" clears the persisted value, while a nil pointer
// preserves it.
func TestPatchProfileid_DescriptionClearViaEmptyString(t *testing.T) {
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice",
		Name: "p1", DSN: "quic://x:1", Description: "keep-me",
	})
	if saved.Description != "keep-me" {
		t.Fatalf("Put: Description not stored: %+v", saved)
	}

	// 1. Absent description preserves the persisted value.
	r := reqWithActor("PATCH", "/api/v1/profiles/"+saved.ID, "alice")
	r.SetPathValue("profileId", saved.ID)
	w := httptest.NewRecorder()
	_, err := srv.PatchProfileid(w, r, &gentypes.UpdateProfileReq{
		// Description omitted; nil pointer => preserve.
	})
	if err != nil {
		t.Fatalf("PatchProfileid (absent): %v", err)
	}
	persisted, _ := st.Get(context.Background(), saved.ID)
	if persisted.Description != "keep-me" {
		t.Errorf("Description clobbered on absent-PATCH: %q", persisted.Description)
	}

	// 2. Non-nil pointer to "" clears the persisted Description.
	r = reqWithActor("PATCH", "/api/v1/profiles/"+saved.ID, "alice")
	r.SetPathValue("profileId", saved.ID)
	w = httptest.NewRecorder()
	_, err = srv.PatchProfileid(w, r, &gentypes.UpdateProfileReq{
		Description: sp(""),
	})
	if err != nil {
		t.Fatalf("PatchProfileid (clear): %v", err)
	}
	persisted, _ = st.Get(context.Background(), saved.ID)
	if persisted.Description != "" {
		t.Errorf("Description not cleared by explicit empty pointer: %q", persisted.Description)
	}
}

// TestPatchProfileid_StoreDisabled pins the early-return path: when
// the server is wired without a Store, PATCH must respond 503 instead
// of nil-panicking on s.cfg.Store.Get.
func TestPatchProfileid_StoreDisabled(t *testing.T) {
	srv := New(Config{}) // no Store
	r := reqWithActor("PATCH", "/api/v1/profiles/abc", "alice")
	r.SetPathValue("profileId", "abc")
	w := httptest.NewRecorder()
	_, err := srv.PatchProfileid(w, r, &gentypes.UpdateProfileReq{Description: sp("x")})
	if err != nil {
		t.Fatalf("PatchProfileid (no store): %v", err)
	}
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", w.Code)
	}
}

// TestPatchProfileid_MissingPathID pins the bad-request path: the
// genapi-emitted PatchProfileid signature does not bind the path
// parameter into the request struct, so we read it off
// r.PathValue("profileId"). Empty path value must be a 400.
func TestPatchProfileid_MissingPathID(t *testing.T) {
	srv, _ := newTestServerWithStore(t)
	// Construct a request that does NOT call SetPathValue("profileId", ...)
	// so r.PathValue("profileId") returns "".
	r := reqWithActor("PATCH", "/api/v1/profiles/", "alice")
	w := httptest.NewRecorder()
	_, err := srv.PatchProfileid(w, r, &gentypes.UpdateProfileReq{Description: sp("x")})
	if err != nil {
		t.Fatalf("PatchProfileid (no path id): %v", err)
	}
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

// TestPatchProfileid_StorePatchSurfaces500ToHTTP pins the
// store-error → HTTP path of PatchProfileid: when the store's Patch
// returns a non-typed error (e.g. "disk full"), the handler must
// surface a 500 via storeErrorToHTTP rather than swallowing the error.
//
// We use a fake Store that returns a custom error from Patch but a
// real profile from Get (so canMutate passes).
func TestPatchProfileid_StorePatchSurfaces500ToHTTP(t *testing.T) {
	disk := errors.New("disk full")
	st := &patchErrStore{
		row: conn.Profile{
			ID: "abc", Scope: conn.ProfileScopePersonal, OwnerUserID: "alice",
			Name: "p1", DSN: "quic://x:1",
		},
		patchErr: disk,
	}
	srv := New(Config{Store: st})
	r := reqWithActor("PATCH", "/api/v1/profiles/abc", "alice")
	r.SetPathValue("profileId", "abc")
	w := httptest.NewRecorder()
	if _, err := srv.PatchProfileid(w, r, &gentypes.UpdateProfileReq{Description: sp("x")}); err != nil {
		t.Fatalf("PatchProfileid: %v", err)
	}
	if w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", w.Code)
	}
	if !strings.Contains(w.Body.String(), "disk full") {
		t.Errorf("body should surface wrapped error: %q", w.Body.String())
	}
}

// patchErrStore is a fake profilestore.Store that returns a fixed Get
// row but a configurable Patch error. Used by
// TestPatchProfileid_StorePatchSurfaces500ToHTTP.
type patchErrStore struct {
	row      conn.Profile
	patchErr error
}

func (s *patchErrStore) Get(_ context.Context, _ string) (conn.Profile, error) {
	return s.row, nil
}
func (s *patchErrStore) List(_ context.Context, _ profilestore.Filter) ([]conn.Profile, error) {
	return nil, nil
}
func (s *patchErrStore) ListVisible(_ context.Context, _ string) ([]conn.Profile, error) {
	return nil, nil
}
func (s *patchErrStore) Put(_ context.Context, p conn.Profile) (conn.Profile, error) {
	return p, nil
}
func (s *patchErrStore) Patch(_ context.Context, _ string, _ profilestore.ProfilePatch) (conn.Profile, error) {
	return conn.Profile{}, s.patchErr
}
func (s *patchErrStore) Delete(_ context.Context, _ string) error { return nil }
func (s *patchErrStore) Close() error                             { return nil }

// TestPostProfiles_RejectsGarbagePEM pins GAP-S10 (#123) at the handler
// boundary: a CREATE request whose tls.ca_pem carries a non-PEM string
// must be rejected with 400 invalid_tls before anything reaches the
// store. Pre-fix the garbage payload persisted into the SQLite store
// and only failed at connection-establishment time.
func TestPostProfiles_RejectsGarbagePEM(t *testing.T) {
	srv, _ := newTestServerWithStore(t)
	r := reqWithActor("POST", "/api/v1/profiles", "alice")
	w := httptest.NewRecorder()
	_, _ = srv.PostProfiles(w, r, &gentypes.CreateProfileReq{
		Scope: string(conn.ProfileScopePersonal),
		Name:  "p1",
		Dsn:   "quic://x:1",
		TLS:   jsontext.Value(`{"ca_pem":"not a pem"}`),
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
	if !strings.Contains(w.Body.String(), "invalid_tls") {
		t.Errorf("body = %q, want code invalid_tls", w.Body.String())
	}
}

// TestPostProfiles_AcceptsValidPEM is the positive-path companion of
// TestPostProfiles_RejectsGarbagePEM: a CREATE carrying valid CA + cert
// + key PEM must persist cleanly.
func TestPostProfiles_AcceptsValidPEM(t *testing.T) {
	srv, _ := newTestServerWithStore(t)
	ca := genTestCAPEM(t)
	cert := genTestClientCertPEM(t)
	key := genTestPKCS8KeyPEM(t)
	tlsJSON := `{"ca_pem":` + jsonString(ca) +
		`,"client_cert_pem":` + jsonString(cert) +
		`,"client_key_pem":` + jsonString(key) + `}`
	r := reqWithActor("POST", "/api/v1/profiles", "alice")
	w := httptest.NewRecorder()
	got, err := srv.PostProfiles(w, r, &gentypes.CreateProfileReq{
		Scope: string(conn.ProfileScopePersonal),
		Name:  "p1",
		Dsn:   "quic://x:1",
		TLS:   jsontext.Value(tlsJSON),
	})
	if err != nil || got == nil {
		t.Fatalf("PostProfiles: got=%v err=%v body=%s", got, err, w.Body.String())
	}
}

// TestPatchProfileid_RejectsGarbagePEM confirms PATCH inherits the
// validation through tlsPatchFromGenJSON.
func TestPatchProfileid_RejectsGarbagePEM(t *testing.T) {
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice",
		Name: "p1", DSN: "quic://x:1",
	})
	r := reqWithActor("PATCH", "/api/v1/profiles/"+saved.ID, "alice")
	r.SetPathValue("profileId", saved.ID)
	w := httptest.NewRecorder()
	_, _ = srv.PatchProfileid(w, r, &gentypes.UpdateProfileReq{
		TLS: jsontext.Value(`{"ca_pem":"definitely not pem"}`),
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
	if !strings.Contains(w.Body.String(), "invalid_tls") {
		t.Errorf("body = %q, want code invalid_tls", w.Body.String())
	}
}

// TestPatchProfileid_TLSClearViaEmptyObject_StillWorks re-affirms the
// PSR-G02 contract under the S10 hardening: an empty `tls: {}` (the
// "clear all" signal) is NOT validated as a PEM block; it persists
// the all-empty material on the store.
func TestPatchProfileid_TLSClearViaEmptyObject_StillWorks(t *testing.T) {
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
		t.Fatalf("PatchProfileid clear: got=%v err=%v code=%d body=%s", got, err, w.Code, w.Body.String())
	}
	persisted, _ := st.Get(context.Background(), saved.ID)
	if persisted.TLS.CAPEM != "" || persisted.TLS.ClientCertPEM != "" || persisted.TLS.ClientKeyPEM != "" {
		t.Errorf("clear-via-empty-object did not actually clear: %+v", persisted.TLS)
	}
}

// jsonString returns the JSON-encoded form of s as a Go string. We use
// it to splice multi-line PEM payloads (with embedded \n) into the
// jsontext.Value literal without manual escape-handling. Test helper.
func jsonString(s string) string {
	// Use the Go standard encoder via fmt.Sprintf("%q", ...) which
	// produces JSON-compatible escapes for ", \, control chars, and
	// embedded newlines (\n). Matches encoding/json output for ASCII
	// with embedded newlines, which is all PEM material is.
	return goQuote(s)
}

// goQuote escapes s as a JSON string literal. Implemented by hand so
// we don't have to import encoding/json/v2 just for tests; the inputs
// are small ASCII PEM blobs with newlines.
func goQuote(s string) string {
	var b strings.Builder
	b.Grow(len(s) + 2)
	b.WriteByte('"')
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			b.WriteByte(c)
		}
	}
	b.WriteByte('"')
	return b.String()
}
