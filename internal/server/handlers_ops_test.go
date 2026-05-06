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

// Tests for B7 (backup/restore) and B8 (migrations) handlers. These all
// reuse the userDriver/stubPool plumbing established in
// handlers_users_test.go. Each test pins the exact GQL statement(s) the
// handler emits — that is the load-bearing surface for these admin
// endpoints, since downstream Geode versions decide whether the
// wire-level admin DDL is accepted (live `geode query "BACKUP CREATE"`
// against 0.3.8 times out, confirming wire-level support is not yet
// available; the handlers still emit forward-compatible syntax so the
// UI picks up wire support automatically).

// TestBackups_List asserts SHOW BACKUPS is the only statement and rows
// surface as opaque JSON objects keyed by driver column.
func TestBackups_List(t *testing.T) {
	d := &userDriver{
		cols: []string{"file", "path", "size_bytes", "created_at"},
		rows: [][]driver.Value{
			{"snap-001.gql", "/var/geode/backups/snap-001.gql", int64(1024), "2026-05-01T10:00:00Z"},
			{"snap-002.gql", "/var/geode/backups/snap-002.gql", int64(2048), "2026-05-02T10:00:00Z"},
		},
	}
	s := newUserStubServer(t, "backups_list", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/backups", nil)
	resp, err := s.GetBackups(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetBackups: %v", err)
	}
	if got, want := len(resp.Backups), 2; got != want {
		t.Fatalf("len(Backups)=%d want %d", got, want)
	}
	stmts := d.seen()
	if len(stmts) != 1 || stmts[0] != "SHOW BACKUPS" {
		t.Fatalf("stmts=%v want [SHOW BACKUPS]", stmts)
	}
	var first map[string]any
	if err := json.Unmarshal(resp.Backups[0], &first); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if first["file"] != "snap-001.gql" {
		t.Fatalf("first=%v want file=snap-001.gql", first)
	}
}

// TestBackups_Create pins the BACKUP CREATE statement, including the
// optional GRAPH and OUTPUT clauses, and confirms the handler reads
// the first row of the result set into a typed BackupRef.
func TestBackups_Create(t *testing.T) {
	cases := []struct {
		name string
		in   gentypes.BackupCreateReq
		want string
	}{
		{
			name: "no_options",
			in:   gentypes.BackupCreateReq{},
			want: "BACKUP CREATE",
		},
		{
			name: "graph_only",
			in:   gentypes.BackupCreateReq{Graph: "main"},
			want: "BACKUP CREATE GRAPH `main`",
		},
		{
			name: "output_only",
			in:   gentypes.BackupCreateReq{Output: "/var/snap.gql"},
			want: "BACKUP CREATE OUTPUT '/var/snap.gql'",
		},
		{
			name: "graph_and_output",
			in:   gentypes.BackupCreateReq{Graph: "main", Output: "/var/snap.gql"},
			want: "BACKUP CREATE GRAPH `main` OUTPUT '/var/snap.gql'",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := &userDriver{
				cols: []string{"file", "path", "size_bytes", "created_at"},
				rows: [][]driver.Value{
					{"snap-001.gql", "/var/snap.gql", int64(4096), "2026-05-06T10:00:00Z"},
				},
			}
			s := newUserStubServer(t, "backups_create_"+tc.name, d)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/backups", nil)
			resp, err := s.PostBackups(rec, req, &tc.in)
			if err != nil {
				t.Fatalf("PostBackups: %v", err)
			}
			if resp.File != "snap-001.gql" || resp.SizeBytes != 4096 {
				t.Fatalf("resp=%+v missing fields", resp)
			}
			stmts := d.seen()
			if len(stmts) != 1 || stmts[0] != tc.want {
				t.Fatalf("stmts=%v want [%s]", stmts, tc.want)
			}
		})
	}
}

// TestBackups_Get pins SHOW BACKUP `file` and the row→BackupInfo
// projection, including the integer count columns.
func TestBackups_Get(t *testing.T) {
	d := &userDriver{
		cols: []string{"file", "path", "size_bytes", "created_at", "graph_count", "node_count", "edge_count"},
		rows: [][]driver.Value{
			{"snap-001.gql", "/var/snap.gql", int64(4096), "2026-05-06T10:00:00Z", int64(3), int64(1500), int64(8200)},
		},
	}
	s := newUserStubServer(t, "backups_get", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/backups/snap-001.gql", nil)
	resp, err := s.GetFile(rec, req, &gentypes.BackupFileParam{File: "snap-001.gql"})
	if err != nil {
		t.Fatalf("GetFile: %v", err)
	}
	if resp.File != "snap-001.gql" || resp.GraphCount != 3 || resp.NodeCount != 1500 || resp.EdgeCount != 8200 {
		t.Fatalf("resp=%+v missing fields", resp)
	}
	stmts := d.seen()
	want := "SHOW BACKUP `snap-001.gql`"
	if len(stmts) != 1 || stmts[0] != want {
		t.Fatalf("stmts=%v want [%s]", stmts, want)
	}
}

// TestBackups_Get_NotFound covers the 404 path when SHOW BACKUP returns
// no rows.
func TestBackups_Get_NotFound(t *testing.T) {
	d := &userDriver{cols: []string{"file"}}
	s := newUserStubServer(t, "backups_get_404", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/backups/ghost.gql", nil)
	resp, err := s.GetFile(rec, req, &gentypes.BackupFileParam{File: "ghost.gql"})
	if err != nil {
		t.Fatalf("GetFile returned err %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d want 404", rec.Code)
	}
}

// TestBackups_Delete pins DROP BACKUP quoting.
func TestBackups_Delete(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "backups_delete", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/backups/snap-001.gql", nil)
	if _, err := s.DeleteFile(rec, req, &gentypes.BackupFileParam{File: "snap-001.gql"}); err != nil {
		t.Fatalf("DeleteFile: %v", err)
	}
	stmts := d.seen()
	want := "DROP BACKUP `snap-001.gql`"
	if len(stmts) != 1 || stmts[0] != want {
		t.Fatalf("stmts=%v want [%s]", stmts, want)
	}
}

// TestBackups_Cleanup pins BACKUP CLEANUP and confirms the typed
// summary row is read back.
func TestBackups_Cleanup(t *testing.T) {
	d := &userDriver{
		cols: []string{"removed", "freed_bytes"},
		rows: [][]driver.Value{
			{int64(7), int64(123456789)},
		},
	}
	s := newUserStubServer(t, "backups_cleanup", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/backups/cleanup", nil)
	resp, err := s.Cleanup(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("Cleanup: %v", err)
	}
	if resp.Removed != 7 || resp.FreedBytes != 123456789 {
		t.Fatalf("resp=%+v missing fields", resp)
	}
	stmts := d.seen()
	if len(stmts) != 1 || stmts[0] != "BACKUP CLEANUP" {
		t.Fatalf("stmts=%v want [BACKUP CLEANUP]", stmts)
	}
}

// TestRestore pins the RESTORE statement, with and without target_time.
func TestRestore(t *testing.T) {
	cases := []struct {
		name string
		in   gentypes.RestoreReq
		want string
	}{
		{
			name: "no_target_time",
			in:   gentypes.RestoreReq{File: "snap-001.gql"},
			want: "RESTORE `snap-001.gql`",
		},
		{
			name: "with_target_time",
			in:   gentypes.RestoreReq{File: "snap-001.gql", TargetTime: "2026-05-06T10:00:00Z"},
			want: "RESTORE `snap-001.gql` AT '2026-05-06T10:00:00Z'",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := &userDriver{}
			s := newUserStubServer(t, "restore_"+tc.name, d)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/restore", nil)
			if _, err := s.Restore(rec, req, &tc.in); err != nil {
				t.Fatalf("Restore: %v", err)
			}
			stmts := d.seen()
			if len(stmts) != 1 || stmts[0] != tc.want {
				t.Fatalf("stmts=%v want [%s]", stmts, tc.want)
			}
		})
	}
}

// TestBackups_RejectsBadFile asserts every file-name path-parameter
// validation rejects path traversal and other unsafe characters with
// 400 before the driver sees anything.
func TestBackups_RejectsBadFile(t *testing.T) {
	cases := []string{
		"../etc/passwd",
		"..",
		"/abs/path",
		"foo/bar.gql",
		"foo\\bar.gql",
		".hidden",
		"file with space",
		"file`bad",
		"file\x00null",
	}
	for _, bad := range cases {
		t.Run(bad, func(t *testing.T) {
			d := &userDriver{}
			s := newUserStubServer(t, "backups_bad_file_"+bad, d)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/backups/x", nil)
			resp, err := s.GetFile(rec, req, &gentypes.BackupFileParam{File: bad})
			if err != nil {
				t.Fatalf("GetFile returned err %v; want nil with inline body", err)
			}
			if resp != nil {
				t.Fatalf("resp=%v want nil", resp)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
			}
			if got := d.seen(); len(got) != 0 {
				t.Fatalf("stmts=%v want none — driver should never see the bad file name", got)
			}
		})
	}
}

// TestSanitizeBackupFile pins the contract directly so the rule is
// documented at the helper level too.
func TestSanitizeBackupFile(t *testing.T) {
	cases := []struct {
		in      string
		wantErr bool
	}{
		{"snap-001.gql", false},
		{"snap_001", false},
		{"a", false},
		{"abc.tar.gz", false},
		{"", true},
		{".hidden", true},
		{"..", true},
		{"a..b", true},
		{"a/b", true},
		{"a\\b", true},
		{"a b", true},
		{"a`b", true},
		{"a\x00b", true},
		{"日本語", true}, // non-ASCII rejected for backup file names
	}
	for _, tc := range cases {
		err := sanitizeBackupFile(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("sanitizeBackupFile(%q): want err, got nil", tc.in)
			}
			continue
		}
		if err != nil {
			t.Errorf("sanitizeBackupFile(%q): unexpected err %v", tc.in, err)
		}
	}
}

// TestBackups_QueryFailure covers the 422 path: a driver-level error
// from SHOW BACKUPS gets wrapped as user_admin_error.
func TestBackups_QueryFailure(t *testing.T) {
	d := &userDriver{queryErr: errors.New("boom")}
	s := newUserStubServer(t, "backups_query_err", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/backups", nil)
	resp, err := s.GetBackups(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetBackups returned err %v; want nil with inline body", err)
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

// TestMigrations_Status covers SHOW MIGRATIONS plus the pending/applied
// classification logic — rows with status=pending land in Pending,
// every other row lands in Applied as an opaque JSON object.
func TestMigrations_Status(t *testing.T) {
	d := &userDriver{
		cols: []string{"name", "status", "applied_at"},
		rows: [][]driver.Value{
			{"001_init", "applied", "2026-04-01T00:00:00Z"},
			{"002_users", "applied", "2026-04-02T00:00:00Z"},
			{"003_pending", "pending", ""},
		},
	}
	s := newUserStubServer(t, "migrations_status", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/migrations", nil)
	resp, err := s.GetMigrations(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetMigrations: %v", err)
	}
	if got, want := len(resp.Pending), 1; got != want {
		t.Fatalf("len(Pending)=%d want %d", got, want)
	}
	if resp.Pending[0] != "003_pending" {
		t.Fatalf("Pending[0]=%q want 003_pending", resp.Pending[0])
	}
	if got, want := len(resp.Applied), 2; got != want {
		t.Fatalf("len(Applied)=%d want %d", got, want)
	}
	stmts := d.seen()
	if len(stmts) != 1 || stmts[0] != "SHOW MIGRATIONS" {
		t.Fatalf("stmts=%v want [SHOW MIGRATIONS]", stmts)
	}
}

// TestMigrations_Run pins MIGRATE RUN and the row→[]string projection.
func TestMigrations_Run(t *testing.T) {
	d := &userDriver{
		cols: []string{"name"},
		rows: [][]driver.Value{
			{"003_pending"},
			{"004_also_pending"},
		},
	}
	s := newUserStubServer(t, "migrations_run", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/migrations/run", nil)
	resp, err := s.PostMigrationsRun(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("PostMigrationsRun: %v", err)
	}
	want := []string{"003_pending", "004_also_pending"}
	if len(resp.Applied) != len(want) {
		t.Fatalf("Applied=%v want %v", resp.Applied, want)
	}
	for i, w := range want {
		if resp.Applied[i] != w {
			t.Errorf("Applied[%d]=%q want %q", i, resp.Applied[i], w)
		}
	}
	stmts := d.seen()
	if len(stmts) != 1 || stmts[0] != "MIGRATE RUN" {
		t.Fatalf("stmts=%v want [MIGRATE RUN]", stmts)
	}
}

// TestMigrations_Create pins CREATE MIGRATION, with and without the
// optional DESCRIPTION clause.
func TestMigrations_Create(t *testing.T) {
	cases := []struct {
		name string
		in   gentypes.MigrationCreateReq
		want string
	}{
		{
			name: "no_description",
			in:   gentypes.MigrationCreateReq{Name: "005_add_index"},
			want: "CREATE MIGRATION `005_add_index`",
		},
		{
			name: "with_description",
			in:   gentypes.MigrationCreateReq{Name: "005_add_index", Description: "add user idx"},
			want: "CREATE MIGRATION `005_add_index` DESCRIPTION 'add user idx'",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := &userDriver{}
			s := newUserStubServer(t, "migrations_create_"+tc.name, d)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/migrations", nil)
			resp, err := s.PostMigrations(rec, req, &tc.in)
			if err != nil {
				t.Fatalf("PostMigrations: %v", err)
			}
			if resp.Name != tc.in.Name {
				t.Fatalf("resp.Name=%q want %q", resp.Name, tc.in.Name)
			}
			stmts := d.seen()
			if len(stmts) != 1 || stmts[0] != tc.want {
				t.Fatalf("stmts=%v want [%s]", stmts, tc.want)
			}
		})
	}
}

// TestMigrations_Sign pins MIGRATE SIGN quoting.
func TestMigrations_Sign(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "migrations_sign", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/migrations/005_add_index/sign", nil)
	if _, err := s.Sign(rec, req, &gentypes.MigrationParam{Name: "005_add_index"}); err != nil {
		t.Fatalf("Sign: %v", err)
	}
	stmts := d.seen()
	want := "MIGRATE SIGN `005_add_index`"
	if len(stmts) != 1 || stmts[0] != want {
		t.Fatalf("stmts=%v want [%s]", stmts, want)
	}
}

// TestMigrations_RejectsBadName confirms that path-traversal-shaped
// migration names are rejected with 400 before the driver runs.
func TestMigrations_RejectsBadName(t *testing.T) {
	cases := []struct {
		label string
		name  string
	}{
		{"dotdot", "../foo"},
		{"slash", "foo/bar"},
		{"hidden", ".secret"},
		{"backtick", "foo`bar"},
	}
	for _, tc := range cases {
		t.Run(tc.label, func(t *testing.T) {
			d := &userDriver{}
			s := newUserStubServer(t, "migrations_bad_name_"+tc.label, d)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/migrations", nil)
			resp, err := s.PostMigrations(rec, req, &gentypes.MigrationCreateReq{Name: tc.name})
			if err != nil {
				t.Fatalf("PostMigrations returned err %v; want nil with inline body", err)
			}
			if resp != nil {
				t.Fatalf("resp=%v want nil", resp)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
			}
			if got := d.seen(); len(got) != 0 {
				t.Fatalf("stmts=%v want none — driver should never see the bad name", got)
			}
		})
	}
}

// TestAsInt covers the integer coercion helper added for the backup
// numeric columns.
func TestAsInt(t *testing.T) {
	cases := []struct {
		in   any
		want int64
	}{
		{nil, 0},
		{int64(42), 42},
		{int(7), 7},
		{int32(9), 9},
		{float64(3.7), 3},
		{float32(2.0), 2},
		{"123", 123},
		{[]byte("456"), 456},
		{"not-a-number", 0},
		{struct{}{}, 0},
	}
	for _, tc := range cases {
		if got := asInt(tc.in); got != tc.want {
			t.Errorf("asInt(%v)=%d want %d", tc.in, got, tc.want)
		}
	}
}
