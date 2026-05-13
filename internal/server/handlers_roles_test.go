package server

import (
	"database/sql/driver"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// Role-management handler tests pinned to the Geode v0.5.15 GQL DDL
// grammar (parser at src/gql/parser.zig and result columns at
// src/execution/auth_dispatch.zig @ v0.5.15).
//
// The test driver is the shared `userDriver` from handlers_users_test.go
// because both family share the (Query|Exec)Context + record(seen())
// shape -- DRY over rolling a third near-identical fake.

// TestCreateRole_EmitsV0_5_15Grammar pins the canonical v0.5.15 emit:
//
//	CREATE ROLE <name> [ SET DESCRIPTION '<text>' ]
//
// Critical: `SET` is mandatory before `DESCRIPTION` in v0.5.15. The
// pre-v0.5.15 emit (`CREATE ROLE <name> DESCRIPTION '<text>'`) tripped
// a parse error upstream.
func TestCreateRole_EmitsV0_5_15Grammar(t *testing.T) {
	cases := []struct {
		name      string
		req       *gentypes.RoleCreateReq
		wantStmts []string
	}{
		{
			name: "name_only",
			req:  &gentypes.RoleCreateReq{Name: "data_steward"},
			wantStmts: []string{
				"CREATE ROLE `data_steward`",
			},
		},
		{
			name: "name_plus_description",
			req: &gentypes.RoleCreateReq{
				Name:        "data_steward",
				Description: "Owns data quality",
			},
			wantStmts: []string{
				"CREATE ROLE `data_steward` SET DESCRIPTION 'Owns data quality'",
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := &userDriver{}
			s := newUserStubServer(t, "roles_create_"+tc.name, d)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/roles", nil)
			resp, err := s.PostApiRoles(rec, req, tc.req)
			if err != nil {
				t.Fatalf("PostApiRoles: %v", err)
			}
			if resp == nil || resp.Name != tc.req.Name {
				t.Fatalf("resp=%+v want Name=%q", resp, tc.req.Name)
			}
			got := d.seen()
			if len(got) != len(tc.wantStmts) {
				t.Fatalf("stmts=%v want %v", got, tc.wantStmts)
			}
			for i, w := range tc.wantStmts {
				if got[i] != w {
					t.Errorf("stmt[%d]=%q want %q", i, got[i], w)
				}
			}
		})
	}
}

// TestCreateRole_RejectsPermissionsClause confirms that a CreateRoleReq
// carrying a non-empty Permissions slice is rejected at the handler
// boundary rather than emitted as an upstream-broken `WITH PERMISSIONS
// [ ... ]` clause that v0.5.15 does not parse. The error code stays
// stable (`invalid_permission`) so SPA clients can branch on it.
func TestCreateRole_RejectsPermissionsClause(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "roles_create_perm_reject", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/roles", nil)
	resp, err := s.PostApiRoles(rec, req, &gentypes.RoleCreateReq{
		Name:        "perm_carrier",
		Permissions: []string{"READ"},
	})
	if err != nil {
		t.Fatalf("PostApiRoles returned err %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil on rejection", resp)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "invalid_permission") {
		t.Fatalf("body=%s want invalid_permission", rec.Body.String())
	}
	if got := d.seen(); len(got) != 0 {
		t.Fatalf("stmts=%v want none -- driver should never see an upstream-broken WITH PERMISSIONS emit", got)
	}
}

// TestCreateRole_BuiltinIsIdempotent verifies the create-built-in
// behaviour. Upstream `handleRoleCreate` returns the status row
// `"already exists: <name> (built-in)"` for any of the four reserved
// role names (admin, user, readwrite, readonly) and does NOT propagate
// an error. The handler must surface a 200 response rather than a 409
// or 422.
//
// The test fakes a successful ExecContext (the driver's no-op result)
// because that mirrors the Go database/sql semantics: a status row on
// an Exec is discarded; only the absence of error is observable from
// the handler's perspective.
func TestCreateRole_BuiltinIsIdempotent(t *testing.T) {
	builtins := []string{"admin", "user", "readwrite", "readonly"}
	for _, name := range builtins {
		t.Run(name, func(t *testing.T) {
			d := &userDriver{}
			s := newUserStubServer(t, "roles_create_builtin_"+name, d)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/roles", nil)
			resp, err := s.PostApiRoles(rec, req, &gentypes.RoleCreateReq{Name: name})
			if err != nil {
				t.Fatalf("PostApiRoles(%q): %v", name, err)
			}
			if resp == nil || resp.Name != name {
				t.Fatalf("resp=%+v want Name=%q", resp, name)
			}
			// Status code stays at the handler-default 200 (no
			// rec.WriteHeader call for the success path).
			if rec.Code != http.StatusOK && rec.Code != 0 {
				t.Fatalf("status=%d want 200 for built-in role create", rec.Code)
			}
			got := d.seen()
			want := "CREATE ROLE `" + name + "`"
			if len(got) != 1 || got[0] != want {
				t.Errorf("stmts=%v want [%s]", got, want)
			}
		})
	}
}

// TestSHOW_ROLES_ColumnPin pins the v0.5.15 SHOW ROLES result shape:
// a single column `role_name` per `handleRoleList` in
// `src/execution/auth_dispatch.zig`. The handler normalises this to a
// `name` key in the JSON payload so SPA code that pre-dates v0.5.15
// keeps working, while also retaining the raw `role_name` for clients
// that pin the upstream key.
func TestSHOW_ROLES_ColumnPin(t *testing.T) {
	d := &userDriver{
		cols: []string{"role_name"},
		rows: [][]driver.Value{
			{"admin"},
			{"user"},
			{"readwrite"},
			{"readonly"},
			{"data_steward"},
		},
	}
	s := newUserStubServer(t, "roles_list_v0_5_15", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil)
	resp, err := s.GetRoles(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetRoles: %v", err)
	}
	if got, want := len(resp.Roles), 5; got != want {
		t.Fatalf("len(Roles)=%d want %d", got, want)
	}
	stmts := d.seen()
	if len(stmts) != 1 || stmts[0] != "SHOW ROLES" {
		t.Fatalf("stmts=%v want [SHOW ROLES]", stmts)
	}
	// Each JSON row must carry both keys (legacy `name` lifted from
	// the upstream `role_name`).
	first := string(resp.Roles[0])
	if !strings.Contains(first, `"role_name":"admin"`) {
		t.Errorf("first row %s missing role_name=admin", first)
	}
	if !strings.Contains(first, `"name":"admin"`) {
		t.Errorf("first row %s missing legacy name=admin alias", first)
	}
}

// TestDropRole_IfExistsSwallowed pins the DROP ROLE emit:
//
//	DROP ROLE IF EXISTS <name>
//
// per the v0.5.15 grammar. Upstream `handleRoleDelete` already
// degrades gracefully on missing roles (fetchRemove is a no-op), so
// `IF EXISTS` is structurally a safeguard against a future tightening
// rather than a semantic shift. The handler emits it unconditionally
// to keep the parse surface idempotent.
func TestDropRole_IfExistsSwallowed(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "roles_drop", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/roles/data_steward", nil)
	if _, err := s.DeleteRole(rec, req, &gentypes.RoleParam{Role: "data_steward"}); err != nil {
		t.Fatalf("DeleteRole: %v", err)
	}
	got := d.seen()
	want := "DROP ROLE IF EXISTS `data_steward`"
	if len(got) != 1 || got[0] != want {
		t.Fatalf("stmts=%v want [%s]", got, want)
	}
}

// TestDropRole_RejectsBadIdentifier confirms that a backtick injection
// in the {role} path param surfaces a 400 before any driver work.
func TestDropRole_RejectsBadIdentifier(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "roles_drop_bad_ident", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/roles/x", nil)
	resp, err := s.DeleteRole(rec, req, &gentypes.RoleParam{Role: "data`; DROP ROLE `admin"})
	if err != nil {
		t.Fatalf("DeleteRole returned err %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
	}
	if got := d.seen(); len(got) != 0 {
		t.Fatalf("stmts=%v want none", got)
	}
}

// TestGetRole_FiltersInProcess confirms GET /api/v1/roles/{role} uses
// `SHOW ROLES` and filters the rows in-process (the singular `SHOW
// ROLE <name>` form is NOT part of v0.5.15 grammar). Hits the happy
// path -- the role is present -- and asserts the response Name comes
// from the matched row's `role_name` column.
func TestGetRole_FiltersInProcess(t *testing.T) {
	d := &userDriver{
		cols: []string{"role_name"},
		rows: [][]driver.Value{
			{"admin"},
			{"data_steward"},
			{"readonly"},
		},
	}
	s := newUserStubServer(t, "roles_get_filter", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/roles/data_steward", nil)
	resp, err := s.GetRole(rec, req, &gentypes.RoleParam{Role: "data_steward"})
	if err != nil {
		t.Fatalf("GetRole: %v", err)
	}
	if resp == nil || resp.Name != "data_steward" {
		t.Fatalf("resp=%+v want Name=data_steward", resp)
	}
	got := d.seen()
	if len(got) != 1 || got[0] != "SHOW ROLES" {
		t.Fatalf("stmts=%v want [SHOW ROLES] (no singular SHOW ROLE form on v0.5.15)", got)
	}
}

// TestGetRole_NotFound asserts the 404 path when the requested role is
// not among the SHOW ROLES result rows.
func TestGetRole_NotFound(t *testing.T) {
	d := &userDriver{
		cols: []string{"role_name"},
		rows: [][]driver.Value{
			{"admin"},
		},
	}
	s := newUserStubServer(t, "roles_get_404", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/roles/ghost", nil)
	resp, err := s.GetRole(rec, req, &gentypes.RoleParam{Role: "ghost"})
	if err != nil {
		t.Fatalf("GetRole returned err %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d want 404 body=%s", rec.Code, rec.Body.String())
	}
}

// TestGetRoles_WireFeatureMissingFallback confirms that an older Geode
// build that does not recognise SHOW ROLES degrades to an empty list
// rather than surfacing a 422 -- this is the belt-and-suspenders
// guard for clients still pointed at pre-v0.5.x servers.
func TestGetRoles_WireFeatureMissingFallback(t *testing.T) {
	// Wrap the canonical wire-feature-missing signal so isWireFeatureMissing
	// trips the substring fallback. errors.go pins both "42000" and a
	// parse-error substring as required.
	d := &userDriver{queryErr: errors.New("geode: 42000: parse error: expected token")}
	s := newUserStubServer(t, "roles_list_legacy", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil)
	resp, err := s.GetRoles(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetRoles: %v", err)
	}
	if resp == nil || len(resp.Roles) != 0 {
		t.Fatalf("resp=%v want empty RoleList", resp)
	}
}
