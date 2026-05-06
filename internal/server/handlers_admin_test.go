package server

import (
	"database/sql/driver"
	"encoding/json/v2"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// The handlers exercised here all reuse the userDriver/stubPool plumbing
// established in handlers_users_test.go. Each test pins the exact GQL
// statement(s) the handler emits — that is the load-bearing surface for
// the admin endpoints, since downstream Geode versions decide whether
// the wire-level admin DDL is accepted (B4 documented that 0.3.8 does
// not yet accept these forms; the handlers still emit them for forward
// compatibility).

// TestRoles_List asserts SHOW ROLES is the only statement and the rows
// surface as opaque JSON objects keyed by driver column.
func TestRoles_List(t *testing.T) {
	d := &userDriver{
		cols: []string{"name", "description"},
		rows: [][]driver.Value{
			{"admin", "all permissions"},
			{"auditor", "read-only"},
		},
	}
	s := newUserStubServer(t, "roles_list", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil)
	resp, err := s.GetRoles(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetRoles: %v", err)
	}
	if got, want := len(resp.Roles), 2; got != want {
		t.Fatalf("len(Roles)=%d want %d", got, want)
	}
	stmts := d.seen()
	if len(stmts) != 1 || stmts[0] != "SHOW ROLES" {
		t.Fatalf("stmts=%v want [SHOW ROLES]", stmts)
	}
	var first map[string]any
	if err := json.Unmarshal(resp.Roles[0], &first); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if first["name"] != "admin" {
		t.Fatalf("first=%v want name=admin", first)
	}
}

// TestRoles_Create pins the CREATE ROLE statement, including the
// optional DESCRIPTION and WITH PERMISSIONS clauses.
func TestRoles_Create(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "roles_create", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/roles", nil)
	resp, err := s.PostApiRoles(rec, req, &gentypes.RoleCreateReq{
		Name:        "auditor",
		Description: "read-only role",
		Permissions: []string{"READ", "AUDIT"},
	})
	if err != nil {
		t.Fatalf("PostApiRoles: %v", err)
	}
	if resp.Name != "auditor" {
		t.Fatalf("resp=%+v want name=auditor", resp)
	}
	stmts := d.seen()
	want := "CREATE ROLE `auditor` DESCRIPTION 'read-only role' WITH PERMISSIONS [`READ`, `AUDIT`]"
	if len(stmts) != 1 || stmts[0] != want {
		t.Fatalf("stmts=%v want [%s]", stmts, want)
	}
}

// TestRoles_Get covers the SHOW ROLE happy path and the row→Role
// projection (name+description+permissions columns).
func TestRoles_Get(t *testing.T) {
	d := &userDriver{
		cols: []string{"name", "description", "permissions"},
		rows: [][]driver.Value{
			{"auditor", "read-only", "READ,AUDIT"},
		},
	}
	s := newUserStubServer(t, "roles_get", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/roles/auditor", nil)
	resp, err := s.GetRole(rec, req, &gentypes.RoleParam{Role: "auditor"})
	if err != nil {
		t.Fatalf("GetRole: %v", err)
	}
	if resp.Name != "auditor" || resp.Description != "read-only" {
		t.Fatalf("resp=%+v missing fields", resp)
	}
	if len(resp.Permissions) != 2 || resp.Permissions[0] != "READ" {
		t.Fatalf("perms=%v want [READ AUDIT]", resp.Permissions)
	}
	stmts := d.seen()
	if len(stmts) != 1 || stmts[0] != "SHOW ROLE `auditor`" {
		t.Fatalf("stmts=%v want [SHOW ROLE `auditor`]", stmts)
	}
}

// TestRoles_Get_NotFound covers the 404 path when SHOW ROLE returns no
// rows.
func TestRoles_Get_NotFound(t *testing.T) {
	d := &userDriver{cols: []string{"name"}}
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
		t.Fatalf("status=%d want 404", rec.Code)
	}
}

// TestRoles_Delete pins DROP ROLE quoting.
func TestRoles_Delete(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "roles_delete", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/roles/auditor", nil)
	if _, err := s.DeleteRole(rec, req, &gentypes.RoleParam{Role: "auditor"}); err != nil {
		t.Fatalf("DeleteRole: %v", err)
	}
	stmts := d.seen()
	if len(stmts) != 1 || stmts[0] != "DROP ROLE `auditor`" {
		t.Fatalf("stmts=%v want [DROP ROLE `auditor`]", stmts)
	}
}

// TestPolicies_List asserts SHOW POLICIES is emitted once and rows
// surface as opaque JSON objects.
func TestPolicies_List(t *testing.T) {
	d := &userDriver{
		cols: []string{"name", "expression", "resource"},
		rows: [][]driver.Value{
			{"tenants_iso", "row.tenant_id = ctx.tenant", "Customer"},
		},
	}
	s := newUserStubServer(t, "policies_list", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/policies", nil)
	resp, err := s.GetPolicies(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetPolicies: %v", err)
	}
	if got, want := len(resp.Policies), 1; got != want {
		t.Fatalf("len(Policies)=%d want %d", got, want)
	}
	stmts := d.seen()
	if len(stmts) != 1 || stmts[0] != "SHOW POLICIES" {
		t.Fatalf("stmts=%v want [SHOW POLICIES]", stmts)
	}
}

// TestPolicies_Create pins the CREATE POLICY ON … AS '<expr>' shape,
// including the single-quote escaping when the expression contains an
// apostrophe.
func TestPolicies_Create(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "policies_create", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/policies", nil)
	resp, err := s.PostPolicies(rec, req, &gentypes.PolicyCreateReq{
		Name:       "tenants_iso",
		Expression: "row.tenant_id = ctx.tenant",
		Resource:   "Customer",
	})
	if err != nil {
		t.Fatalf("PostPolicies: %v", err)
	}
	if resp.Name != "tenants_iso" {
		t.Fatalf("resp=%+v want name=tenants_iso", resp)
	}
	stmts := d.seen()
	want := "CREATE POLICY `tenants_iso` ON `Customer` AS 'row.tenant_id = ctx.tenant'"
	if len(stmts) != 1 || stmts[0] != want {
		t.Fatalf("stmts=%v want [%s]", stmts, want)
	}
}

// TestPolicies_Create_NoResource asserts the ON-clause is omitted when
// the request leaves resource empty.
func TestPolicies_Create_NoResource(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "policies_create_noresource", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/policies", nil)
	if _, err := s.PostPolicies(rec, req, &gentypes.PolicyCreateReq{
		Name:       "global",
		Expression: "true",
	}); err != nil {
		t.Fatalf("PostPolicies: %v", err)
	}
	stmts := d.seen()
	want := "CREATE POLICY `global` AS 'true'"
	if len(stmts) != 1 || stmts[0] != want {
		t.Fatalf("stmts=%v want [%s]", stmts, want)
	}
}

// TestPolicies_Get covers SHOW POLICY happy path with row projection.
func TestPolicies_Get(t *testing.T) {
	d := &userDriver{
		cols: []string{"name", "expression", "resource"},
		rows: [][]driver.Value{
			{"tenants_iso", "row.tenant_id = ctx.tenant", "Customer"},
		},
	}
	s := newUserStubServer(t, "policies_get", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/policies/tenants_iso", nil)
	resp, err := s.GetName(rec, req, &gentypes.PolicyParam{Name: "tenants_iso"})
	if err != nil {
		t.Fatalf("GetName: %v", err)
	}
	if resp.Name != "tenants_iso" || resp.Resource != "Customer" {
		t.Fatalf("resp=%+v missing fields", resp)
	}
	stmts := d.seen()
	if len(stmts) != 1 || stmts[0] != "SHOW POLICY `tenants_iso`" {
		t.Fatalf("stmts=%v want [SHOW POLICY `tenants_iso`]", stmts)
	}
}

// TestPolicies_Delete pins DROP POLICY quoting.
func TestPolicies_Delete(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "policies_delete", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/policies/tenants_iso", nil)
	if _, err := s.DeleteName(rec, req, &gentypes.PolicyParam{Name: "tenants_iso"}); err != nil {
		t.Fatalf("DeleteName: %v", err)
	}
	stmts := d.seen()
	if len(stmts) != 1 || stmts[0] != "DROP POLICY `tenants_iso`" {
		t.Fatalf("stmts=%v want [DROP POLICY `tenants_iso`]", stmts)
	}
}

// TestGrants_Apply covers the four GRANT shapes — user vs role grantee,
// with vs without resource — pinning the exact emitted statement for
// each.
func TestGrants_Apply(t *testing.T) {
	cases := []struct {
		name string
		in   gentypes.GrantReq
		want string
	}{
		{
			name: "role_no_resource",
			in:   gentypes.GrantReq{Permission: "READ", Grantee: "auditor", GranteeKind: "role"},
			want: "GRANT `READ` TO ROLE `auditor`",
		},
		{
			name: "user_no_resource",
			in:   gentypes.GrantReq{Permission: "ADMIN", Grantee: "alice", GranteeKind: "user"},
			want: "GRANT `ADMIN` TO USER `alice`",
		},
		{
			name: "role_with_resource",
			in:   gentypes.GrantReq{Permission: "WRITE", Grantee: "writers", GranteeKind: "role", Resource: "Customer"},
			want: "GRANT `WRITE` ON `Customer` TO ROLE `writers`",
		},
		{
			name: "user_with_resource",
			in:   gentypes.GrantReq{Permission: "WRITE", Grantee: "alice", GranteeKind: "user", Resource: "Customer"},
			want: "GRANT `WRITE` ON `Customer` TO USER `alice`",
		},
		{
			name: "default_kind_is_role",
			in:   gentypes.GrantReq{Permission: "READ", Grantee: "auditor"},
			want: "GRANT `READ` TO ROLE `auditor`",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := &userDriver{}
			s := newUserStubServer(t, "grants_apply_"+tc.name, d)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/grants", nil)
			if _, err := s.Grants(rec, req, &tc.in); err != nil {
				t.Fatalf("Grants: %v", err)
			}
			stmts := d.seen()
			if len(stmts) != 1 || stmts[0] != tc.want {
				t.Fatalf("stmts=%v want [%s]", stmts, tc.want)
			}
		})
	}
}

// TestGrants_Revoke covers REVOKE … FROM with one user and one role
// case (with-resource and without).
func TestGrants_Revoke(t *testing.T) {
	cases := []struct {
		name string
		in   gentypes.GrantReq
		want string
	}{
		{
			name: "role_no_resource",
			in:   gentypes.GrantReq{Permission: "READ", Grantee: "auditor", GranteeKind: "role"},
			want: "REVOKE `READ` FROM ROLE `auditor`",
		},
		{
			name: "user_with_resource",
			in:   gentypes.GrantReq{Permission: "WRITE", Grantee: "alice", GranteeKind: "user", Resource: "Customer"},
			want: "REVOKE `WRITE` ON `Customer` FROM USER `alice`",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := &userDriver{}
			s := newUserStubServer(t, "grants_revoke_"+tc.name, d)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/grants/revoke", nil)
			if _, err := s.Revoke(rec, req, &tc.in); err != nil {
				t.Fatalf("Revoke: %v", err)
			}
			stmts := d.seen()
			if len(stmts) != 1 || stmts[0] != tc.want {
				t.Fatalf("stmts=%v want [%s]", stmts, tc.want)
			}
		})
	}
}

// TestGrants_RejectsBadIdentifier confirms backtick injection in any of
// the three identifier slots (permission / resource / grantee) is
// rejected with 400 before the driver sees anything.
func TestGrants_RejectsBadIdentifier(t *testing.T) {
	cases := []struct {
		name string
		in   gentypes.GrantReq
	}{
		{"bad_permission", gentypes.GrantReq{Permission: "READ`; DROP", Grantee: "auditor", GranteeKind: "role"}},
		{"bad_grantee", gentypes.GrantReq{Permission: "READ", Grantee: "auditor`;", GranteeKind: "role"}},
		{"bad_resource", gentypes.GrantReq{Permission: "READ", Grantee: "auditor", GranteeKind: "role", Resource: "Cus`tomer"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := &userDriver{}
			s := newUserStubServer(t, "grants_bad_"+tc.name, d)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/grants", nil)
			resp, err := s.Grants(rec, req, &tc.in)
			if err != nil {
				t.Fatalf("Grants returned err %v; want nil with inline body", err)
			}
			if resp != nil {
				t.Fatalf("resp=%v want nil", resp)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
			}
			if got := d.seen(); len(got) != 0 {
				t.Fatalf("stmts=%v want none — driver should never see the bad identifier", got)
			}
		})
	}
}

// TestGrants_RejectsUnknownKind ensures buildGrant's defensive guard
// catches grantee_kind values outside {user, role, ""}. The genapi
// validator already rejects these at the wire boundary, but an
// in-process caller that bypasses Valid() should still get a 400.
func TestGrants_RejectsUnknownKind(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "grants_bad_kind", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/grants", nil)
	resp, err := s.Grants(rec, req, &gentypes.GrantReq{
		Permission:  "READ",
		Grantee:     "auditor",
		GranteeKind: "bogus",
	})
	if err != nil {
		t.Fatalf("Grants returned err %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "invalid_grantee_kind") {
		t.Fatalf("body=%s want invalid_grantee_kind", rec.Body.String())
	}
}

// TestRoles_QueryFailure covers the 422 path: a driver-level error from
// SHOW ROLES gets wrapped as user_admin_error.
func TestRoles_QueryFailure(t *testing.T) {
	d := &userDriver{queryErr: errors.New("boom")}
	s := newUserStubServer(t, "roles_query_err", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil)
	resp, err := s.GetRoles(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetRoles returned err %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d want 422 body=%s", rec.Code, rec.Body.String())
	}
}
