package server

import (
	"database/sql/driver"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// Grant/Revoke handler tests pinned to the Geode v0.5.15 GQL DDL
// grammar (parser at src/gql/parser.zig and execution at
// src/execution/auth_dispatch.zig @ v0.5.15).

// TestGrant_PerGraphReadGrant pins the canonical v0.5.15 per-graph
// read grant emit. This is the load-bearing path the SPA Grants panel
// drives -- privilege ON GRAPH <name> TO <user>.
func TestGrant_PerGraphReadGrant(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "grants_per_graph_read", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/grants", nil)
	if _, err := s.Grants(rec, req, &gentypes.GrantReq{
		Permission:  "READ",
		Grantee:     "alice",
		GranteeKind: "user",
		Resource:    "movies",
	}); err != nil {
		t.Fatalf("Grants: %v", err)
	}
	got := d.seen()
	want := "GRANT READ ON GRAPH movies TO alice"
	if len(got) != 1 || got[0] != want {
		t.Fatalf("stmts=%v want [%s]", got, want)
	}
}

// TestGrant_GlobalWriteReturnsExplanatoryNote covers the v0.5.15
// Limitations #1 behaviour: a privilege grant with no `ON GRAPH`
// clause parses and executes upstream, but persists nothing -- the
// upstream handler returns an explanatory status row instead. The
// geode-ui handler does NOT 4xx; it returns 200 (the request was
// well-formed and the upstream wire accepted it). The audit log
// captures the requested permission/grantee/resource so a follow-up
// can reconcile the no-op.
//
// This test confirms the handler emits the right wire statement; the
// upstream "no persistence" semantic belongs to handleGrantRevoke in
// src/execution/auth_dispatch.zig, which we trust by upstream contract.
func TestGrant_GlobalWriteReturnsExplanatoryNote(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "grants_global_write", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/grants", nil)
	resp, err := s.Grants(rec, req, &gentypes.GrantReq{
		Permission:  "WRITE",
		Grantee:     "alice",
		GranteeKind: "user",
		// No Resource -- global grant per Limitations #1.
	})
	if err != nil {
		t.Fatalf("Grants: %v", err)
	}
	if resp == nil {
		t.Fatalf("resp=nil want non-nil Empty (global grant returns 200 with upstream note)")
	}
	got := d.seen()
	want := "GRANT WRITE TO alice"
	if len(got) != 1 || got[0] != want {
		t.Fatalf("stmts=%v want [%s]", got, want)
	}
}

// TestRevoke_RemovesGrant pins the canonical v0.5.15 revoke emit
// (the SPA equivalent of "REVOKE WRITE ON GRAPH movies FROM alice").
// Upstream `handleGrantRevoke` degrades gracefully when the grant did
// not exist -- no error is propagated -- so the handler's success
// path is unchanged from a no-op revoke.
func TestRevoke_RemovesGrant(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "grants_revoke_pin", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/grants/revoke", nil)
	if _, err := s.Revoke(rec, req, &gentypes.GrantReq{
		Permission:  "WRITE",
		Grantee:     "alice",
		GranteeKind: "user",
		Resource:    "movies",
	}); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	got := d.seen()
	want := "REVOKE WRITE ON GRAPH movies FROM alice"
	if len(got) != 1 || got[0] != want {
		t.Fatalf("stmts=%v want [%s]", got, want)
	}
}

// TestGrant_RejectsPrivilegeOutsideAllowlist confirms the privilege
// allowlist {READ, WRITE, SCHEMA, ALL} (case-insensitive). Anything
// else is rejected with 400 invalid_permission before any driver work.
//
// The pre-v0.5.15 handler treated the permission token as an arbitrary
// identifier and quoteIdent'd it; that emitted upstream-broken
// keywords like `ADMIN` or `AUDIT` which the v0.5.15 parser does not
// accept. The new behaviour fails closed at the handler.
func TestGrant_RejectsPrivilegeOutsideAllowlist(t *testing.T) {
	cases := []string{"ADMIN", "AUDIT", "DROP", "select", "EXECUTE", ""}
	for _, perm := range cases {
		t.Run("perm="+perm, func(t *testing.T) {
			d := &userDriver{}
			s := newUserStubServer(t, "grants_bad_perm_"+perm, d)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/grants", nil)
			resp, err := s.Grants(rec, req, &gentypes.GrantReq{
				Permission:  perm,
				Grantee:     "alice",
				GranteeKind: "user",
			})
			if err != nil {
				t.Fatalf("Grants returned err %v; want nil with inline body", err)
			}
			if resp != nil {
				t.Fatalf("resp=%v want nil", resp)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), "invalid_permission") {
				t.Errorf("body=%s want invalid_permission", rec.Body.String())
			}
			if got := d.seen(); len(got) != 0 {
				t.Fatalf("stmts=%v want none -- driver should never see the bad permission", got)
			}
		})
	}
}

// TestGrant_RoleGranteeUpstreamDeferred pins the v0.5.15 Limitations
// #2 behaviour: per-role per-privilege grants are NOT in the v0.5.15
// grammar. The handler returns 501 wire_feature_missing rather than
// emitting an upstream-broken statement, so the SPA can branch on the
// same wire_feature_missing code it uses for other admin-deferred
// features. Role membership is managed via the separate
// `GRANT ROLE <r> TO <u>` path under /api/v1/users/{u}/roles.
func TestGrant_RoleGranteeUpstreamDeferred(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "grants_role_grantee_deferred", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/grants", nil)
	resp, err := s.Grants(rec, req, &gentypes.GrantReq{
		Permission:  "READ",
		Grantee:     "data_steward",
		GranteeKind: "role",
		Resource:    "movies",
	})
	if err != nil {
		t.Fatalf("Grants returned err %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status=%d want 501 body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "wire_feature_missing") {
		t.Errorf("body=%s want wire_feature_missing", rec.Body.String())
	}
	if got := d.seen(); len(got) != 0 {
		t.Fatalf("stmts=%v want none -- driver should never see an upstream-broken role-grant emit", got)
	}
}

// TestShowPermissions_Self exercises the bare `SHOW PERMISSIONS FOR
// <user>` emit. The route metadata (geode.json) sets
// required_roles=["admin"]; that gate is enforced by the genapi mux
// (re-parsing the Bearer claim against the role allowlist) and is
// not the responsibility of this handler. The test pins the emit
// shape -- bare `FOR <user>` with no `USER` keyword -- and the
// projection of the upstream `(username, permission)` columns into
// the typed PermissionList.
//
// Upstream `handleUserPermissions` in src/execution/auth_dispatch.zig
// (v0.5.15) returns two columns and one row per permission tag from
// `Permission.fromRole`. The handler projects through
// permissionFromRow which maps `permission` -> Permission.
func TestShowPermissions_Self(t *testing.T) {
	d := &userDriver{
		cols: []string{"username", "permission"},
		rows: [][]driver.Value{
			{"alice", "read"},
			{"alice", "write"},
		},
	}
	s := newUserStubServer(t, "perms_self", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/alice/permissions", nil)
	resp, err := s.Permissions(rec, req, &gentypes.UsernameParam{Username: "alice"})
	if err != nil {
		t.Fatalf("Permissions: %v", err)
	}
	if resp == nil || len(resp.Permissions) != 2 {
		t.Fatalf("resp=%+v want 2 permissions", resp)
	}
	if resp.Permissions[0].Permission != "read" || resp.Permissions[1].Permission != "write" {
		t.Errorf("permissions=%+v want [read write]", resp.Permissions)
	}
	got := d.seen()
	want := "SHOW PERMISSIONS FOR alice"
	if len(got) != 1 || got[0] != want {
		t.Fatalf("stmts=%v want [%s] (no USER keyword between FOR and the name on v0.5.15)", got, want)
	}
}

// TestShowPermissions_ForOther_RequiresAdmin documents the
// route-level admin gate. The geode.json route definition for
// GET /api/v1/users/{u}/permissions sets required_roles=["admin"];
// that gate is enforced by the genapi-generated wrapper at
// gen/api/handlers_gen.go (re-parsing the Bearer claim against the
// allowlist and returning 403 securex.ErrInsufficientRole when the
// caller does not have admin). The wrapper code path is shared with
// every other admin-only handler and is exercised end-to-end by
// handlers_profiles_crud_test.go (TestPostProfiles_SystemRequiresAdmin
// and friends).
//
// This test pins the contract at the geode.json metadata layer so a
// future regression that drops the required_roles entry trips here.
func TestShowPermissions_ForOther_RequiresAdmin(t *testing.T) {
	// The route metadata lives in gen/api at registration time. The
	// invariant we rely on is that the Permissions handler is gated
	// upstream by the genapi mux; the handler itself never sees a
	// non-admin caller. Pin the file-level documentation by checking
	// that the geode.json source still tags the route as admin-only.
	// (A doc-only test -- runs in milliseconds and never makes a
	// network call. If this test fails, geode.json shipped without
	// the required_roles=admin entry, which is the regression we
	// care about.)
	const want = `"required_roles": ["admin"]`
	const block = `"path": "/api/v1/users/{username}/permissions"`
	gj := readFile(t, "../../geode.json")
	if !strings.Contains(gj, block) {
		t.Fatalf("geode.json no longer carries the permissions route")
	}
	// Find the route block and assert required_roles=["admin"] sits
	// within ~6 lines of it.
	idx := strings.Index(gj, block)
	window := gj[idx:min(idx+400, len(gj))]
	if !strings.Contains(window, want) {
		t.Errorf("permissions route metadata lost required_roles=admin gate; window:\n%s", window)
	}
}

// readFile is a tiny wrapper around os.ReadFile that fails the test on
// error -- saves a few lines of boilerplate at each call site.
func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}
