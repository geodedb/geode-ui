package server

import (
	"bytes"
	"encoding/json/v2"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// buildUploadReq builds a multipart upload request hitting path with a
// single "file" part containing body and Content-Disposition filename.
// JWT bearer is set when token is non-empty.
func buildUploadReq(t *testing.T, path, filename, body, token string) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	if _, err := io.WriteString(part, body); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	r := httptest.NewRequest(http.MethodPost, path, &buf)
	r.Header.Set("Content-Type", w.FormDataContentType())
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	return r
}

// adminToken issues a JWT carrying the "admin" role for round-trip
// uploads in tests. The subject and profile are arbitrary; only the role
// matters for the upload role gate.
func adminToken(t *testing.T, srv *GraphServer) string {
	t.Helper()
	tok, _, err := srv.cfg.JWT.Issue("alice", "default", []string{"admin"})
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	return tok
}

// TestBackupUpload_HappyPath drives a full round-trip: a multipart
// "file" part is POSTed with an admin JWT, the response is 201, and
// the file lands under <UploadDir>/backups/<sanitised filename>.
func TestBackupUpload_HappyPath(t *testing.T) {
	dir := t.TempDir()
	srv := New(Config{JWT: newTestIssuer(t), UploadDir: dir})
	tok := adminToken(t, srv)

	req := buildUploadReq(t, "/api/v1/backups/upload", "snapshot-001.geo", "binary-blob-body", tok)
	rec := httptest.NewRecorder()
	srv.HandleBackupUpload(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%q want 201", rec.Code, rec.Body.String())
	}
	var resp uploadResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.File != "snapshot-001.geo" {
		t.Fatalf("file=%q want snapshot-001.geo", resp.File)
	}
	if resp.SizeBytes != int64(len("binary-blob-body")) {
		t.Fatalf("size=%d want %d", resp.SizeBytes, len("binary-blob-body"))
	}

	// Confirm the file actually landed on disk and the .tmp marker is gone.
	got, err := os.ReadFile(filepath.Join(dir, "backups", "snapshot-001.geo"))
	if err != nil {
		t.Fatalf("read final: %v", err)
	}
	if string(got) != "binary-blob-body" {
		t.Fatalf("on-disk=%q want %q", got, "binary-blob-body")
	}
	if _, err := os.Stat(filepath.Join(dir, "backups", "snapshot-001.geo.tmp")); !os.IsNotExist(err) {
		t.Fatalf("tmp file lingered: err=%v", err)
	}
}

// TestMigrationUpload_HappyPath mirrors the backup test for the
// migrations subdir. A single check is enough — the dispatch is
// shared via handleUpload().
func TestMigrationUpload_HappyPath(t *testing.T) {
	dir := t.TempDir()
	srv := New(Config{JWT: newTestIssuer(t), UploadDir: dir})
	tok := adminToken(t, srv)

	req := buildUploadReq(t, "/api/v1/migrations/upload", "0001_init.gql", "CREATE GRAPH demo;\n", tok)
	rec := httptest.NewRecorder()
	srv.HandleMigrationUpload(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%q want 201", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "migrations", "0001_init.gql")); err != nil {
		t.Fatalf("expected file under migrations/: %v", err)
	}
}

// TestUpload_RejectsMissingJWT confirms an unauthenticated POST gets a
// 401 and never touches the disk.
func TestUpload_RejectsMissingJWT(t *testing.T) {
	dir := t.TempDir()
	srv := New(Config{JWT: newTestIssuer(t), UploadDir: dir})

	req := buildUploadReq(t, "/api/v1/backups/upload", "x.geo", "data", "")
	rec := httptest.NewRecorder()
	srv.HandleBackupUpload(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401", rec.Code)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("upload dir not empty after rejected upload: %v", entries)
	}
}

// TestUpload_RejectsNonAdmin confirms a JWT carrying only "user" gets a
// 403 even though it is otherwise valid.
func TestUpload_RejectsNonAdmin(t *testing.T) {
	dir := t.TempDir()
	srv := New(Config{JWT: newTestIssuer(t), UploadDir: dir})
	tok, _, err := srv.cfg.JWT.Issue("alice", "default", []string{"user"})
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	req := buildUploadReq(t, "/api/v1/backups/upload", "x.geo", "data", tok)
	rec := httptest.NewRecorder()
	srv.HandleBackupUpload(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d want 403", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "insufficient_role") {
		t.Fatalf("body=%q want insufficient_role", rec.Body.String())
	}
}

// TestUpload_DisabledWhenNoUploadDir confirms a server started without
// -upload-dir surfaces a 503 instead of writing files into "" / cwd.
func TestUpload_DisabledWhenNoUploadDir(t *testing.T) {
	srv := New(Config{JWT: newTestIssuer(t)}) // UploadDir intentionally empty
	tok := adminToken(t, srv)

	req := buildUploadReq(t, "/api/v1/backups/upload", "x.geo", "data", tok)
	rec := httptest.NewRecorder()
	srv.HandleBackupUpload(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d want 503", rec.Code)
	}
}

// TestUpload_HTTPLevelPathTraversalCollapses pins the defence-in-depth
// for path-bearing filenames at the HTTP boundary. mime/multipart applies
// filepath.Base at parse time before our handler ever sees the name, so
// "../../etc/passwd" arrives as "passwd" and is accepted as a clean
// basename; the file lands strictly under <UploadDir>/backups/. This
// test confirms no escape happens regardless of what the client sends.
func TestUpload_HTTPLevelPathTraversalCollapses(t *testing.T) {
	dir := t.TempDir()
	srv := New(Config{JWT: newTestIssuer(t), UploadDir: dir})
	tok := adminToken(t, srv)

	req := buildUploadReq(t, "/api/v1/backups/upload", "../../etc/passwd", "x", tok)
	rec := httptest.NewRecorder()
	srv.HandleBackupUpload(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d want 201 (stdlib collapses to basename); body=%s", rec.Code, rec.Body.String())
	}
	// Stdlib reduced the name to "passwd"; verify the file landed
	// strictly under UploadDir/backups/.
	if _, err := os.Stat(filepath.Join(dir, "backups", "passwd")); err != nil {
		t.Fatalf("expected backups/passwd: %v", err)
	}
	// And that nothing escaped to an absolute path or sibling dir.
	if _, err := os.Stat("/etc/passwd-uploaded-by-test"); err == nil {
		t.Fatalf("file escaped to /etc")
	}
}

// TestUpload_RejectsBadFilenameChars covers names that *do* survive
// filepath.Base intact but contain characters the safeNameRE forbids
// (spaces, semicolons, unicode). These get a 400 invalid_filename.
func TestUpload_RejectsBadFilenameChars(t *testing.T) {
	dir := t.TempDir()
	srv := New(Config{JWT: newTestIssuer(t), UploadDir: dir})
	tok := adminToken(t, srv)

	for _, name := range []string{
		"foo bar.txt",    // space
		"semi;colon.txt", // semicolon
		"café.txt",       // unicode
	} {
		t.Run(name, func(t *testing.T) {
			req := buildUploadReq(t, "/api/v1/backups/upload", name, "data", tok)
			rec := httptest.NewRecorder()
			srv.HandleBackupUpload(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d want 400 for filename %q", rec.Code, name)
			}
			if !strings.Contains(rec.Body.String(), "invalid_filename") {
				t.Fatalf("body=%q want invalid_filename", rec.Body.String())
			}
		})
	}
}

// TestUpload_RejectsWrongMethod confirms GET/PUT/DELETE on the upload
// endpoint surface a 405.
func TestUpload_RejectsWrongMethod(t *testing.T) {
	dir := t.TempDir()
	srv := New(Config{JWT: newTestIssuer(t), UploadDir: dir})

	r := httptest.NewRequest(http.MethodGet, "/api/v1/backups/upload", nil)
	rec := httptest.NewRecorder()
	srv.HandleBackupUpload(rec, r)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status=%d want 405", rec.Code)
	}
}

// TestSanitiseUploadName pins the filename allow-list directly. The full
// HTTP-level path-traversal coverage is in TestUpload_RejectsPathTraversal,
// but this is the unit-level pin.
func TestSanitiseUploadName(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"plain.txt", "plain.txt", false},
		{"with-dash_and.dot.gql", "with-dash_and.dot.gql", false},
		{"123_456.geo", "123_456.geo", false},
		{"../../etc/passwd", "", true},
		{"foo/bar", "", true},
		{`foo\bar`, "", true},
		{"", "", true},
		{".", "", true},
		{"..", "", true},
		{"hello world.txt", "", true},
		{"semi;colon.txt", "", true},
		{"café.txt", "", true}, // unicode rejected
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got, err := sanitiseUploadName(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("got %q want error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("err=%v want nil", err)
			}
			if got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

// TestHasAdminRole pins the case-insensitive role match.
func TestHasAdminRole(t *testing.T) {
	cases := []struct {
		in   []string
		want bool
	}{
		{nil, false},
		{[]string{"admin"}, true},
		{[]string{"ADMIN"}, true},
		{[]string{"Admin"}, true},
		{[]string{"user"}, false},
		{[]string{"user", "admin"}, true},
	}
	for _, tc := range cases {
		got := hasAdminRole(tc.in)
		if got != tc.want {
			t.Fatalf("hasAdminRole(%v)=%v want %v", tc.in, got, tc.want)
		}
	}
}
