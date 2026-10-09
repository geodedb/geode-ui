package server

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// userDriver is a database/sql/driver implementation that captures every
// statement the handler issues, returning either a canned row set (for
// queries) or a no-op result (for DDL). The capture is goroutine-safe so
// happy-path tests can assert exact statement text.
type userDriver struct {
	mu       sync.Mutex
	stmts    []string
	cols     []string
	rows     [][]driver.Value
	queryErr error
	execErr  error
}

func (d *userDriver) Open(_ string) (driver.Conn, error) { return &userConn{d: d}, nil }

func (d *userDriver) record(s string) {
	d.mu.Lock()
	d.stmts = append(d.stmts, s)
	d.mu.Unlock()
}

func (d *userDriver) seen() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]string(nil), d.stmts...)
}

type userConn struct{ d *userDriver }

func (c *userConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("unused") }
func (c *userConn) Close() error                        { return nil }
func (c *userConn) Begin() (driver.Tx, error)           { return nil, errors.New("unused") }

func (c *userConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	c.d.record(query)
	if c.d.execErr != nil {
		return nil, c.d.execErr
	}
	return driver.RowsAffected(0), nil
}

func (c *userConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.d.record(query)
	if c.d.queryErr != nil {
		return nil, c.d.queryErr
	}
	return &userRows{cols: c.d.cols, data: c.d.rows}, nil
}

type userRows struct {
	cols []string
	data [][]driver.Value
	idx  int
}

func (r *userRows) Columns() []string { return r.cols }
func (r *userRows) Close() error      { return nil }
func (r *userRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.data) {
		return io.EOF
	}
	row := r.data[r.idx]
	r.idx++
	for i := range dest {
		if i < len(row) {
			dest[i] = row[i]
		}
	}
	return nil
}

// newUserStubServer wires a GraphServer backed by the given userDriver,
// reusing registerOnce so the driver name does not collide across tests.
func newUserStubServer(t *testing.T, name string, d *userDriver) *GraphServer {
	t.Helper()
	if _, loaded := registerOnce.LoadOrStore(name, struct{}{}); !loaded {
		sql.Register(name, d)
	}
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return New(Config{Version: "test", Pool: &stubPool{db: db}})
}

// TestUsers_List_HappyPath fakes a SHOW USERS row set and asserts the
// response materialises into the typed UserList (GAP-Q8: User entries,
// not []jsontext.Value).
//
// Legacy column pin (kept for back-compat with stub/test drivers that
// still emit the older `disabled, mfa_enrolled` shape used by pre-
// v0.5.15 geode-ui mock servers). The v0.5.15 production column set
// (`username, email, role, active`) is exercised separately by
// TestSHOW_USERS_ColumnPinV0_5_15.
func TestUsers_List_HappyPath(t *testing.T) {
	d := &userDriver{
		cols: []string{"username", "email", "disabled", "mfa_enrolled"},
		rows: [][]driver.Value{
			{"alice", "alice@example.com", false, true},
			{"bob", "bob@example.com", true, false},
		},
	}
	s := newUserStubServer(t, "users_list_happy", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users", nil)
	resp, err := s.GetUsers(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetUsers: %v", err)
	}
	if got, want := len(resp.Users), 2; got != want {
		t.Fatalf("len(Users)=%d want %d", got, want)
	}
	stmts := d.seen()
	if len(stmts) != 1 || stmts[0] != "SHOW USERS" {
		t.Fatalf("stmts=%v want [SHOW USERS]", stmts)
	}
	first := resp.Users[0]
	if first.Username != "alice" || first.Email != "alice@example.com" {
		t.Fatalf("first row=%+v missing expected fields", first)
	}
	if first.Disabled != false || first.MfaEnrolled != true {
		t.Fatalf("first row flags wrong: %+v", first)
	}
	if resp.Users[1].Username != "bob" || resp.Users[1].Disabled != true {
		t.Fatalf("second row=%+v", resp.Users[1])
	}
}

// TestSHOW_USERS_ColumnPinV0_5_15 pins the SHOW USERS column shape that
// Geode v0.5.15 emits via `geode.auth.user_list`:
//
//	columns: ["username", "email", "role", "active"]
//
// (See `handleUserList` in `src/execution/auth_dispatch.zig` @ v0.5.15.)
// Two divergences from the pre-v0.5.15 column shape this handler used
// to expect:
//
//  1. `role` (singular) replaces `roles` (plural list). The handler
//     must lift the singular value into the typed []Roles for SPA
//     compatibility.
//
//  2. `active` replaces `disabled`. The handler must invert the bool so
//     the typed `Disabled` field reflects the same notion (`Disabled =
//     !active`).
//
// A schema drift — a new column upstream adds — must NOT fail the
// projection; the row helper logs a one-shot drift warning and drops
// the column. The matching test `TestUsers_List_TypedProjectionDropsUnknownColumns`
// already pins that behaviour for the typed projection.
func TestSHOW_USERS_ColumnPinV0_5_15(t *testing.T) {
	d := &userDriver{
		cols: []string{"username", "email", "role", "active"},
		rows: [][]driver.Value{
			{"alice", "alice@example.com", "admin", true},
			{"bob", "", "user", false},
		},
	}
	s := newUserStubServer(t, "users_list_v0_5_15", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users", nil)
	resp, err := s.GetUsers(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetUsers: %v", err)
	}
	if got, want := len(resp.Users), 2; got != want {
		t.Fatalf("len(Users)=%d want %d", got, want)
	}
	first := resp.Users[0]
	if first.Username != "alice" {
		t.Errorf("first.Username=%q want alice", first.Username)
	}
	if first.Email != "alice@example.com" {
		t.Errorf("first.Email=%q want alice@example.com", first.Email)
	}
	if len(first.Roles) != 1 || first.Roles[0] != "admin" {
		t.Errorf("first.Roles=%v want [admin] (singular `role` column lifted to slice)", first.Roles)
	}
	if first.Disabled {
		t.Errorf("first.Disabled=%v want false (active=true inverts to disabled=false)", first.Disabled)
	}
	second := resp.Users[1]
	if !second.Disabled {
		t.Errorf("second.Disabled=%v want true (active=false inverts to disabled=true)", second.Disabled)
	}
	if len(second.Roles) != 1 || second.Roles[0] != "user" {
		t.Errorf("second.Roles=%v want [user]", second.Roles)
	}
}

// TestUsers_List_TypedProjectionDropsUnknownColumns confirms a SHOW
// USERS row carrying an unrecognised column is projected onto the typed
// User without panic and the unknown column is dropped (GAP-Q8 drift
// handling — the data loss is intentional and logged once).
func TestUsers_List_TypedProjectionDropsUnknownColumns(t *testing.T) {
	d := &userDriver{
		cols: []string{"username", "email", "future_column"},
		rows: [][]driver.Value{
			{"carol", "carol@example.com", "surprise"},
		},
	}
	s := newUserStubServer(t, "users_list_drift", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users", nil)
	resp, err := s.GetUsers(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetUsers: %v", err)
	}
	if len(resp.Users) != 1 || resp.Users[0].Username != "carol" || resp.Users[0].Email != "carol@example.com" {
		t.Fatalf("unexpected projection: %+v", resp.Users)
	}
}

// TestUsers_Permissions_Typed fakes a SHOW PERMISSIONS FOR row set and
// asserts the typed PermissionList projection (GAP-Q8).
//
// v0.5.15 grammar: `SHOW PERMISSIONS [ FOR <user> ]` -- note: no
// `USER` keyword after `FOR`. Upstream parser is `parseShowStatement`
// in `src/gql/parser.zig` (v0.5.15). The legacy `FOR USER <user>`
// form was never accepted upstream and tripped a parse error.
//
// Upstream `geode.auth.user_permissions` returns two columns:
// `username, permission`. The handler's `permissionFromRow` maps
// `permission` -> Permission. `resource` / `scope` are dropped through
// the drift warning (the v0.5.15 user_permissions result has no
// graph-scoped rows; per-graph grants are read via SHOW GRANTS, not
// shipped in v0.5.15 -- see Limitations #5).
func TestUsers_Permissions_Typed(t *testing.T) {
	d := &userDriver{
		cols: []string{"permission", "resource", "scope"},
		rows: [][]driver.Value{
			{"READ", "graph:demo", "node"},
			{"WRITE", "graph:demo", "edge"},
		},
	}
	s := newUserStubServer(t, "users_perms_typed", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/alice/permissions", nil)
	resp, err := s.Permissions(rec, req, &gentypes.UsernameParam{Username: "alice"})
	if err != nil {
		t.Fatalf("Permissions: %v", err)
	}
	if len(resp.Permissions) != 2 {
		t.Fatalf("len(Permissions)=%d want 2", len(resp.Permissions))
	}
	if resp.Permissions[0].Permission != "READ" || resp.Permissions[0].Resource != "graph:demo" || resp.Permissions[0].Scope != "node" {
		t.Fatalf("first permission=%+v", resp.Permissions[0])
	}
	stmts := d.seen()
	want := "SHOW PERMISSIONS FOR alice"
	if len(stmts) != 1 || stmts[0] != want {
		t.Fatalf("stmts=%v want [%s]", stmts, want)
	}
}

// TestUsers_Create captures the emitted SQL for CREATE USER and a
// follow-up GRANT ROLE, asserting the username and email are
// backtick/single-quoted.
//
// Pinned to the Geode v0.5.15 GQL DDL grammar:
//
//	CREATE USER <name> SET PASSWORD '<pw>' [ EMAIL '<email>' ] [ ROLE <name> ]
//	GRANT  ROLE <role> TO <user>
//
// The upstream parser is `parseCreateUser` and `parseGrantStatement` in
// `src/gql/parser.zig` (v0.5.15). Note: the legacy `WITH EMAIL` form
// emitted by older geode-ui builds was never accepted upstream — it
// tripped a parse error against every Geode release.
func TestUsers_Create(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "users_create", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users", nil)
	resp, err := s.PostUsers(rec, req, &gentypes.UserCreateReq{
		Username: "alice",
		Email:    "alice@example.com",
		// GAP-N4: password must satisfy the >=12-char + non-weak policy
		// since the wire-level path now validates server-side.
		Password: "supersecret-pw-1",
		Roles:    []string{"admin", "auditor"},
	})
	if err != nil {
		t.Fatalf("PostUsers: %v", err)
	}
	if resp.Username != "alice" || resp.Email != "alice@example.com" {
		t.Fatalf("resp=%+v missing identity fields", resp)
	}
	stmts := d.seen()
	// The first role is inlined into CREATE USER via the `ROLE <name>`
	// clause so the user is created with its built-in role atomically.
	// Subsequent roles run through a follow-up GRANT ROLE TO call.
	want := []string{
		"CREATE USER alice SET PASSWORD 'supersecret-pw-1' EMAIL 'alice@example.com' ROLE admin",
		"GRANT ROLE admin TO alice",
		"GRANT ROLE auditor TO alice",
	}
	if len(stmts) != len(want) {
		t.Fatalf("stmts=%v want %v", stmts, want)
	}
	for i, w := range want {
		if stmts[i] != w {
			t.Errorf("stmt[%d]=%q want %q", i, stmts[i], w)
		}
	}
}

// TestUsers_Create_RequiresPassword confirms that CREATE USER without
// a password is rejected before any statement runs. The Geode v0.5.15
// grammar requires `SET PASSWORD '<pw>'` immediately after the name —
// there is no password-less CREATE USER form.
func TestUsers_Create_RequiresPassword(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "users_create_nopw", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users", nil)
	resp, err := s.PostUsers(rec, req, &gentypes.UserCreateReq{
		Username: "alice",
		Email:    "alice@example.com",
		// No Password -- must be rejected before driver work.
	})
	if err != nil {
		t.Fatalf("PostUsers returned err %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
	}
	if got := d.seen(); len(got) != 0 {
		t.Fatalf("stmts=%v want none — driver should never see a password-less CREATE USER", got)
	}
}

// TestUsers_Create_WithRole confirms the SET PASSWORD ... ROLE <name>
// form per v0.5.15 grammar -- the inline role clause is the canonical
// way to set the user's built-in role at creation time. Passes the
// chosen role through a separate `Roles` slice (the request schema's
// only role-carrying field today).
func TestUsers_Create_WithRole(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "users_create_with_role", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users", nil)
	if _, err := s.PostUsers(rec, req, &gentypes.UserCreateReq{
		Username: "alice",
		Password: "supersecret-pw-1",
		Roles:    []string{"readonly"},
	}); err != nil {
		t.Fatalf("PostUsers: %v", err)
	}
	stmts := d.seen()
	// First statement is the CREATE USER; the inline ROLE clause sets
	// the role atomically. A subsequent GRANT ROLE still runs to keep
	// the wire trace stable for clients that read the audit log -- the
	// upstream user_assign_role handler is idempotent for the current
	// role.
	if len(stmts) < 1 {
		t.Fatalf("stmts=%v want CREATE USER first", stmts)
	}
	wantFirst := "CREATE USER alice SET PASSWORD 'supersecret-pw-1' ROLE readonly"
	if stmts[0] != wantFirst {
		t.Errorf("stmt[0]=%q want %q", stmts[0], wantFirst)
	}
}

// TestUsers_Create_RejectsBadIdentifier confirms backtick injection in
// the username surfaces a 400 endpoint error before any statement runs.
func TestUsers_Create_RejectsBadIdentifier(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "users_create_bad_ident", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users", nil)
	resp, err := s.PostUsers(rec, req, &gentypes.UserCreateReq{
		Username: "alice`; DROP USER `bob",
		Email:    "alice@example.com",
	})
	if err != nil {
		t.Fatalf("PostUsers returned error %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400", rec.Code)
	}
	if got := d.seen(); len(got) != 0 {
		t.Fatalf("stmts=%v want none — driver should never see the bad identifier", got)
	}
}

// TestUsers_Delete asserts DROP USER receives the username quoted as an
// identifier.
//
// v0.5.15 grammar: `DROP USER [ IF EXISTS ] <name>`. The handler emits
// the `IF EXISTS` guard so a delete on an already-removed user is a
// no-op rather than a 422. Upstream `handleUserDelete` already degrades
// gracefully on missing users (it logs and returns
// "deleted <name>"), but `IF EXISTS` keeps the parse-level surface
// idempotent for clients that consume the audit log.
func TestUsers_Delete(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "users_delete", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/users/alice", nil)
	if _, err := s.DeleteUsername(rec, req, &gentypes.UsernameParam{Username: "alice"}); err != nil {
		t.Fatalf("DeleteUsername: %v", err)
	}
	stmts := d.seen()
	want := "DROP USER IF EXISTS alice"
	if len(stmts) != 1 || stmts[0] != want {
		t.Fatalf("stmts=%v want [%s]", stmts, want)
	}
}

// TestUsers_AssignRole exercises POST /users/{u}/roles and asserts the
// emitted GRANT ROLE statement.
//
// v0.5.15 grammar: `GRANT ROLE <role> TO <user>` -- no `USER` keyword
// after `TO`. Upstream parser is `parseGrantStatement` in
// `src/gql/parser.zig` (v0.5.15). The legacy `TO USER <user>` form
// emitted by older geode-ui builds was never accepted upstream.
func TestUsers_AssignRole(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "users_assign_role", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users/alice/roles", nil)
	if _, err := s.PostUsernameRoles(rec, req, &gentypes.AssignRoleReq{Username: "alice", Role: "admin"}); err != nil {
		t.Fatalf("Roles: %v", err)
	}
	stmts := d.seen()
	if len(stmts) != 1 || stmts[0] != "GRANT ROLE admin TO alice" {
		t.Fatalf("stmts=%v want [GRANT ROLE admin TO alice]", stmts)
	}
}

// TestUsers_ChangePassword asserts the POST /users/{u}/password handler
// quotes both the username (identifier) and password (string literal)
// and emits exactly one ALTER USER statement.
func TestUsers_ChangePassword(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "users_chpw", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users/alice/password", nil)
	if _, err := s.Password(rec, req, &gentypes.PasswordChangeReq{
		Username:    "alice",
		NewPassword: "another's secret",
	}); err != nil {
		t.Fatalf("Password: %v", err)
	}
	stmts := d.seen()
	want := "ALTER USER alice SET PASSWORD 'another''s secret'"
	if len(stmts) != 1 || stmts[0] != want {
		t.Fatalf("stmts=%v want [%s]", stmts, want)
	}
}

// TestUsers_ChangePassword_RevokesExistingTokens pins SEC-N2 (#64): a
// successful POST /users/{u}/password revokes every currently-valid
// token for that user (a token issued before the change fails
// validation; one issued after passes; another user's token is
// unaffected).
func TestUsers_ChangePassword_RevokesExistingTokens(t *testing.T) {
	d := &userDriver{}
	iss := newTestIssuer(t)
	if _, loaded := registerOnce.LoadOrStore("users_chpw_revoke", struct{}{}); !loaded {
		sql.Register("users_chpw_revoke", d)
	}
	db, err := sql.Open("users_chpw_revoke", "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	s := New(Config{Version: "test", Pool: &stubPool{db: db}, JWT: iss})

	// Token for the target user, minted before the password change.
	tokAlice, _, err := iss.Issue("alice", "default", []string{"reader"}, "")
	if err != nil {
		t.Fatalf("Issue alice: %v", err)
	}
	// Token for an unrelated user.
	tokBob, _, err := iss.Issue("bob", "default", []string{"reader"}, "")
	if err != nil {
		t.Fatalf("Issue bob: %v", err)
	}
	// Both validate before the change.
	if _, err := iss.Parse(tokAlice); err != nil {
		t.Fatalf("alice token valid before change: %v", err)
	}
	if _, err := iss.Parse(tokBob); err != nil {
		t.Fatalf("bob token valid before change: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users/alice/password", nil)
	if _, err := s.Password(rec, req, &gentypes.PasswordChangeReq{
		Username:    "alice",
		NewPassword: "fresh-secret-1",
	}); err != nil {
		t.Fatalf("Password: %v", err)
	}

	// alice's pre-change token is now revoked; bob's is untouched.
	if _, err := iss.Parse(tokAlice); err == nil {
		t.Fatal("alice's pre-change token should be revoked after password change")
	}
	if _, err := iss.Parse(tokBob); err != nil {
		t.Fatalf("bob's token must be unaffected by alice's password change: %v", err)
	}
}

// TestUsers_PatchPassword_RevokesExistingTokens pins the same SEC-N2
// behaviour for the PATCH /users/{u} path when it carries a password
// field — and confirms a PATCH that does NOT touch the password does
// not revoke anything. Uses the BeginTx-capable userTxDriver because
// PatchUsername wraps its sub-updates in a transaction.
func TestUsers_PatchPassword_RevokesExistingTokens(t *testing.T) {
	d := &userTxDriver{}
	iss := newTestIssuer(t)
	if _, loaded := registerOnce.LoadOrStore("users_patchpw_revoke", struct{}{}); !loaded {
		sql.Register("users_patchpw_revoke", d)
	}
	db, err := sql.Open("users_patchpw_revoke", "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	s := New(Config{Version: "test", Pool: &stubPool{db: db}, JWT: iss})

	tok1, _, err := iss.Issue("carol", "default", nil, "")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	// PATCH with only an email change — must NOT revoke carol's token.
	rec := httptest.NewRecorder()
	if _, err := s.PatchUsername(rec, httptest.NewRequest(http.MethodPatch, "/api/v1/users/carol", nil), &gentypes.UserUpdateReq{
		Username: "carol",
		Email:    "carol@new.example.com",
	}); err != nil {
		t.Fatalf("PatchUsername (email only): %v", err)
	}
	if rec.Code != http.StatusOK && rec.Code != 0 {
		t.Fatalf("email-only PATCH unexpected status %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := iss.Parse(tok1); err != nil {
		t.Fatalf("email-only PATCH should not revoke tokens: %v", err)
	}

	// PATCH with a password change — must revoke carol's token.
	rec = httptest.NewRecorder()
	if _, err := s.PatchUsername(rec, httptest.NewRequest(http.MethodPatch, "/api/v1/users/carol", nil), &gentypes.UserUpdateReq{
		Username: "carol",
		// GAP-N4 policy: >= 12 chars, not a weak pattern.
		Password: "another-fresh-secret",
	}); err != nil {
		t.Fatalf("PatchUsername (password): %v", err)
	}
	if rec.Code != http.StatusOK && rec.Code != 0 {
		t.Fatalf("password PATCH unexpected status %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := iss.Parse(tok1); err == nil {
		t.Fatal("carol's pre-change token should be revoked after a password PATCH")
	}
}

// TestUsers_DisableEnable confirms the toggle handler emits the
// DISABLE/ENABLE verbs against the correctly-quoted identifier.
func TestUsers_DisableEnable(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "users_toggle", d)

	rec := httptest.NewRecorder()
	if _, err := s.Disable(rec, httptest.NewRequest(http.MethodPost, "/api/v1/users/alice/disable", nil), &gentypes.UsernameParam{Username: "alice"}); err != nil {
		t.Fatalf("Disable: %v", err)
	}
	rec = httptest.NewRecorder()
	if _, err := s.Enable(rec, httptest.NewRequest(http.MethodPost, "/api/v1/users/alice/enable", nil), &gentypes.UsernameParam{Username: "alice"}); err != nil {
		t.Fatalf("Enable: %v", err)
	}
	stmts := d.seen()
	want := []string{"ALTER USER alice DISABLE", "ALTER USER alice ENABLE"}
	if len(stmts) != len(want) {
		t.Fatalf("stmts=%v want %v", stmts, want)
	}
	for i, w := range want {
		if stmts[i] != w {
			t.Errorf("stmt[%d]=%q want %q", i, stmts[i], w)
		}
	}
}

// TestUsers_QuoteIdent pins the contract: only safe identifier values
// pass through; control chars and backticks are rejected.
func TestUsers_QuoteIdent(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"alice", "alice", false},
		{"alice-bob_42", "alice-bob_42", false},
		{"_underscored", "_underscored", false}, // leading underscore allowed
		{"5oclock", "5oclock", false},           // digit at start allowed (migration names)
		{"", "", true},                          // empty rejected
		{"-starts_with_hyphen", "", true},       // hyphen at start rejected
		{"with spaces", "", true},               // spaces no longer accepted
		{"日本語", "", true},                       // multi-byte no longer accepted
		{"al`ice", "", true},                    // backtick rejected
		{`al"ice`, "", true},                    // double-quote rejected
		{"alice\nbob", "", true},                // newline rejected
		{"alice\x00bob", "", true},              // NUL rejected
		{"alice\x7fbob", "", true},              // DEL rejected
	}
	for _, tc := range cases {
		got, err := quoteIdent(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("quoteIdent(%q)=%q,nil; want err", tc.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("quoteIdent(%q): unexpected err %v", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("quoteIdent(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}

// TestUsers_QuoteString pins the SQL-standard escape: single quotes
// double up, control characters are rejected.
func TestUsers_QuoteString(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"", "''", false},
		{"plain", "'plain'", false},
		{"O'Brien", "'O''Brien'", false},
		{"a''b", "'a''''b'", false}, // pre-doubled quotes get re-doubled
		{"line1\nline2", "", true},
		{"\x00", "", true},
		{"unicode 漢字", "'unicode 漢字'", false},
	}
	for _, tc := range cases {
		got, err := quoteString(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("quoteString(%q)=%q,nil; want err", tc.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("quoteString(%q): unexpected err %v", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("quoteString(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}

// TestUsers_AsBool covers the driver-tolerance helper.
func TestUsers_AsBool(t *testing.T) {
	cases := []struct {
		in   any
		want bool
	}{
		{nil, false},
		{true, true},
		{false, false},
		{"true", true},
		{"FALSE", false},
		{"1", true},
		{"0", false},
		{[]byte("true"), true},
		{int64(1), true},
		{int64(0), false},
	}
	for _, tc := range cases {
		if got := asBool(tc.in); got != tc.want {
			t.Errorf("asBool(%v)=%v want %v", tc.in, got, tc.want)
		}
	}
}

// TestUsers_AsStrs covers []any / []string / comma-separated fallback.
func TestUsers_AsStrs(t *testing.T) {
	cases := []struct {
		in   any
		want []string
	}{
		{nil, nil},
		{[]string{"a", "b"}, []string{"a", "b"}},
		{[]any{"a", "b"}, []string{"a", "b"}},
		{"a,b,c", []string{"a", "b", "c"}},
		{"a|b", []string{"a", "b"}},
		{"", nil},
	}
	for _, tc := range cases {
		got := asStrs(tc.in)
		if !equalStrings(got, tc.want) {
			t.Errorf("asStrs(%v)=%v want %v", tc.in, got, tc.want)
		}
	}
}

// TestUsers_GetUsername_NotFound covers the 404 path when SHOW USER
// returns an empty row set.
func TestUsers_GetUsername_NotFound(t *testing.T) {
	d := &userDriver{cols: []string{"username", "email"}}
	s := newUserStubServer(t, "users_get_404", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/ghost", nil)
	resp, err := s.GetUsername(rec, req, &gentypes.UsernameParam{Username: "ghost"})
	if err != nil {
		t.Fatalf("GetUsername returned err %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d want 404", rec.Code)
	}
}

// TestWithConnDBAndIdent_TableDriven exercises the GAP-Q9 helper that
// collapses the connDB+quoteIdent preamble shared by the user
// handlers. Three paths matter: happy (both lookups succeed and fn
// runs), connDB failure (no quoteIdent or fn invocation), and
// quoteIdent failure (no fn invocation, returns a 400 endpointError).
func TestWithConnDBAndIdent_TableDriven(t *testing.T) {
	d := &userDriver{}
	happyServer := newUserStubServer(t, "with_conn_ident_happy", d)
	brokenServer := New(Config{Version: "test",
		Pool: &errPool{err: errors.New("boom")},
	})

	cases := []struct {
		name        string
		srv         *GraphServer
		username    string
		fnCalled    bool
		wantErr     bool
		wantStatus  int
		wantCode    string
		wantBodySub string
	}{
		{
			name:     "happy_path_invokes_fn_with_quoted_ident",
			srv:      happyServer,
			username: "alice",
			fnCalled: true,
			wantErr:  false,
		},
		{
			name:        "missing_active_connection_short_circuits",
			srv:         brokenServer,
			username:    "alice",
			fnCalled:    false,
			wantErr:     true,
			wantStatus:  http.StatusBadGateway,
			wantCode:    "profile_unreachable",
			wantBodySub: "boom",
		},
		{
			name:        "bad_identifier_short_circuits_without_db_use",
			srv:         happyServer,
			username:    "al`ice",
			fnCalled:    false,
			wantErr:     true,
			wantStatus:  http.StatusBadRequest,
			wantCode:    "invalid_username",
			wantBodySub: "invalid_username",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			called := false
			var gotIdent string
			err := tc.srv.withConnDBAndIdent(context.Background(), tc.username, func(_ *sql.DB, qname string) error {
				called = true
				gotIdent = qname
				return nil
			})
			if called != tc.fnCalled {
				t.Fatalf("fn called=%v want %v", called, tc.fnCalled)
			}
			if tc.wantErr {
				ep := asEndpointError(err)
				if ep == nil {
					t.Fatalf("err=%v want endpointError", err)
				}
				if ep.status != tc.wantStatus {
					t.Errorf("status=%d want %d", ep.status, tc.wantStatus)
				}
				if ep.code != tc.wantCode {
					t.Errorf("code=%q want %q", ep.code, tc.wantCode)
				}
				return
			}
			if err != nil {
				t.Fatalf("err=%v want nil", err)
			}
			if gotIdent != "alice" {
				t.Errorf("qname=%q want alice", gotIdent)
			}
		})
	}
}

// TestQ9_CallsitesUnchanged is a regression smoke test that confirms
// the public handler behaviour after the GAP-Q9 helper extraction.
// We rely on the existing TestUsers_* suite for full per-handler
// coverage and just pin one happy path per migrated handler family
// so that an accidental regression in the helper plumbing trips a
// localised test.
func TestQ9_CallsitesUnchanged(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "q9_callsites_smoke", d)
	rec := httptest.NewRecorder()
	if _, err := s.DeleteUsername(rec,
		httptest.NewRequest(http.MethodDelete, "/api/v1/users/alice", nil),
		&gentypes.UsernameParam{Username: "alice"},
	); err != nil {
		t.Fatalf("DeleteUsername after Q9: %v", err)
	}
	if got := d.seen(); len(got) != 1 || got[0] != "DROP USER IF EXISTS alice" {
		t.Fatalf("post-Q9 stmts=%v want [DROP USER IF EXISTS alice]", got)
	}
}

// TestUsers_QueryFailureSurfacesAs422 confirms a driver error from a
// SHOW USERS query gets wrapped as user_admin_error / 422.
func TestUsers_QueryFailureSurfacesAs422(t *testing.T) {
	d := &userDriver{queryErr: errors.New("syntax error near USERS")}
	s := newUserStubServer(t, "users_query_err", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users", nil)
	resp, err := s.GetUsers(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetUsers returned err %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d want 422 body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "user_admin_error") {
		t.Fatalf("body=%s want user_admin_error", rec.Body.String())
	}
}
