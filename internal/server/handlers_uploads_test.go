package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	gen "geodedb.com/geode-ui/gen/pkg/gen"
	gentypes "geodedb.com/geode-ui/gen/types"
)

// uploadReq builds the *gen.FileUpload payload the genapi-emitted
// multipart wrapper would hand the handler: an open Reader plus the
// declared filename and size. Tests call the handler methods directly
// (same convention as the other handlers_*_test.go in this package);
// the JWT/admin-role gate is enforced by the generated wrapper and
// covered by the genapi test suite, not re-tested here.
func uploadFile(filename, body string) *gen.FileUpload {
	return &gen.FileUpload{
		Filename: filename,
		Size:     int64(len(body)),
		Reader:   strings.NewReader(body),
	}
}

func newUploadServer(t *testing.T, uploadDir string) *GraphServer {
	t.Helper()
	return New(Config{JWT: newTestIssuer(t), UploadDir: uploadDir})
}

// TestBackupUpload_HappyPath drives a full round-trip: the typed
// request carries an open "file" payload, the handler returns a
// populated UploadResp, and the file lands under
// <UploadDir>/backups/<sanitised filename> with no .tmp marker left.
func TestBackupUpload_HappyPath(t *testing.T) {
	dir := t.TempDir()
	srv := newUploadServer(t, dir)
	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/backups/upload", nil)

	resp, err := srv.BackupUpload(rec, r, &gentypes.BackupUploadReq{File: uploadFile("snapshot-001.geo", "binary-blob-body")})
	if err != nil {
		t.Fatalf("BackupUpload: %v", err)
	}
	if resp == nil {
		t.Fatalf("nil resp; recorder body=%q status=%d", rec.Body.String(), rec.Code)
	}
	if resp.File != "snapshot-001.geo" {
		t.Fatalf("file=%q want snapshot-001.geo", resp.File)
	}
	if resp.SizeBytes != int64(len("binary-blob-body")) {
		t.Fatalf("size=%d want %d", resp.SizeBytes, len("binary-blob-body"))
	}
	if resp.UploadedAt == "" || resp.Path == "" {
		t.Fatalf("incomplete resp: %+v", resp)
	}

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
// migrations subdir; the body is shared via stageUpload().
func TestMigrationUpload_HappyPath(t *testing.T) {
	dir := t.TempDir()
	srv := newUploadServer(t, dir)
	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/migrations/upload", nil)

	resp, err := srv.MigrationUpload(rec, r, &gentypes.MigrationUploadReq{File: uploadFile("0001_init.gql", "CREATE GRAPH demo;\n")})
	if err != nil {
		t.Fatalf("MigrationUpload: %v", err)
	}
	if resp == nil || resp.File != "0001_init.gql" {
		t.Fatalf("unexpected resp %+v; recorder=%q", resp, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "migrations", "0001_init.gql")); err != nil {
		t.Fatalf("expected file under migrations/: %v", err)
	}
}

// TestUpload_DisabledWhenNoUploadDir confirms a server started without
// -upload-dir surfaces a 503 (written via w) instead of writing files
// into "" / cwd, and returns (nil, nil) so the genapi wrapper writes
// nothing further.
func TestUpload_DisabledWhenNoUploadDir(t *testing.T) {
	srv := New(Config{JWT: newTestIssuer(t)}) // UploadDir intentionally empty
	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/backups/upload", nil)

	resp, err := srv.BackupUpload(rec, r, &gentypes.BackupUploadReq{File: uploadFile("x.geo", "data")})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp != nil {
		t.Fatalf("expected nil resp on 503, got %+v", resp)
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d want 503", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "upload_disabled") {
		t.Fatalf("body=%q want upload_disabled", rec.Body.String())
	}
}

// TestUpload_RejectsMissingFile confirms a request with no file payload
// gets a 400 and never touches the disk.
func TestUpload_RejectsMissingFile(t *testing.T) {
	dir := t.TempDir()
	srv := newUploadServer(t, dir)
	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/backups/upload", nil)

	resp, err := srv.BackupUpload(rec, r, &gentypes.BackupUploadReq{File: nil})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp != nil {
		t.Fatalf("expected nil resp, got %+v", resp)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400", rec.Code)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("upload dir not empty after rejected upload: %v", entries)
	}
}

// TestUpload_PathTraversalRejected pins the defence-in-depth: a
// path-bearing filename ("../../etc/passwd") is rejected with a 400
// invalid_filename (mime/multipart's filepath.Base normalisation runs
// in the genapi wrapper, but sanitiseUploadName is the belt-and-braces
// layer that rejects anything with a separator regardless).
func TestUpload_PathTraversalRejected(t *testing.T) {
	dir := t.TempDir()
	srv := newUploadServer(t, dir)
	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/backups/upload", nil)

	resp, err := srv.BackupUpload(rec, r, &gentypes.BackupUploadReq{File: uploadFile("../../etc/passwd", "x")})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp != nil {
		t.Fatalf("expected nil resp, got %+v", resp)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "invalid_filename") {
		t.Fatalf("body=%q want invalid_filename", rec.Body.String())
	}
	// Nothing escaped the upload dir.
	entries, _ := os.ReadDir(filepath.Join(dir, "backups"))
	if len(entries) != 0 {
		t.Fatalf("backups dir should be empty, got %v", entries)
	}
}

// TestUpload_RejectsBadFilenameChars covers names with characters the
// safeNameRE forbids (spaces, semicolons, unicode) — 400 invalid_filename.
func TestUpload_RejectsBadFilenameChars(t *testing.T) {
	dir := t.TempDir()
	srv := newUploadServer(t, dir)

	for _, name := range []string{
		"foo bar.txt",    // space
		"semi;colon.txt", // semicolon
		"café.txt",       // unicode
	} {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodPost, "/api/v1/backups/upload", nil)
			resp, err := srv.BackupUpload(rec, r, &gentypes.BackupUploadReq{File: uploadFile(name, "data")})
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if resp != nil {
				t.Fatalf("expected nil resp for %q, got %+v", name, resp)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d want 400 for filename %q", rec.Code, name)
			}
			if !strings.Contains(rec.Body.String(), "invalid_filename") {
				t.Fatalf("body=%q want invalid_filename", rec.Body.String())
			}
		})
	}
}

// TestSanitiseUploadName pins the filename allow-list directly.
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
