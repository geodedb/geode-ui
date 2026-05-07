package server

import (
	"encoding/json/v2"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Hand-rolled multipart upload endpoints — outside the genapi surface.
//
//   POST /api/v1/backups/upload    -> HandleBackupUpload
//   POST /api/v1/migrations/upload -> HandleMigrationUpload
//
// Wire dialect quirks aside, these endpoints stage files on local disk so
// the operator can later reference them by name from RestorePage /
// MigrationsPage. v0.5.11 doesn't actually accept RESTORE / CREATE
// MIGRATION over the wire — the existing handlers translate that to a
// 501 wire_feature_missing — but staging the files now means a future
// Geode that does accept these verbs becomes a one-line plumbing change.
//
// Both handlers share:
//   - JWT auth (via AuthJWT) and admin-role enforcement (claims.Roles
//     must contain "admin" — same gate genapi puts on the rest of the
//     /api/v1/backups and /api/v1/migrations surface).
//   - 64 MiB request body cap (configurable via maxUploadBytes).
//   - Filename sanitisation: only [A-Za-z0-9._-] survive, anything else
//     including path separators and NULs is rejected with 400. Empty
//     filenames after stripping are also rejected. This keeps an attacker
//     from writing outside UploadDir via "../../etc/passwd" style names.
//   - Atomic write: file lands as <name>.tmp first, then os.Rename'd
//     onto the final path, so a partial upload never leaves a half-
//     written file with a real-looking name.

// maxUploadBytes is the hard cap on total request size for an upload.
// Geode backup files are typically a few hundred MiB at most for the
// graphs we expect to host through this admin SPA; 64 MiB is small but
// matches what the admin tooling uploads in practice for the v0.5.x
// branch. Bump in main.go via -upload-dir-max if a real deployment
// needs larger files.
const maxUploadBytes = 64 << 20 // 64 MiB

// safeNameRE pins what characters are allowed in an uploaded filename.
// This is intentionally stricter than POSIX filename rules — we reject
// spaces and Unicode to keep audit logs greppable and to avoid surprises
// with shell-quoting in operator workflows.
var safeNameRE = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// uploadResponse is the JSON shape returned on a successful upload.
type uploadResponse struct {
	File       string `json:"file"`        // sanitised filename used on disk
	SizeBytes  int64  `json:"size_bytes"`  // bytes actually written
	Path       string `json:"path"`        // absolute path on the server
	UploadedAt string `json:"uploaded_at"` // RFC3339, server clock
}

// HandleBackupUpload is the HTTP entry for POST /api/v1/backups/upload.
// Files land under <UploadDir>/backups/<filename>.
func (s *GraphServer) HandleBackupUpload(w http.ResponseWriter, r *http.Request) {
	s.handleUpload(w, r, "backups", auditEventBackupCreated)
}

// HandleMigrationUpload is the HTTP entry for POST /api/v1/migrations/upload.
// Files land under <UploadDir>/migrations/<filename>.
func (s *GraphServer) HandleMigrationUpload(w http.ResponseWriter, r *http.Request) {
	s.handleUpload(w, r, "migrations", auditEventMigrationCreated)
}

// handleUpload is the shared body for both upload endpoints. subdir is
// the per-kind subdirectory ("backups" or "migrations"); auditEvent is
// emitted on success so the audit log shows the operator who staged the
// file alongside the backup_created / migration_created events that
// genapi-emitted creation handlers will eventually produce.
func (s *GraphServer) handleUpload(w http.ResponseWriter, r *http.Request, subdir, auditEvent string) {
	if r.Method != http.MethodPost {
		writeEndpointError(w, &endpointError{
			status:      http.StatusMethodNotAllowed,
			code:        "method_not_allowed",
			description: "upload requires POST",
		})
		return
	}
	if s.cfg.UploadDir == "" {
		writeEndpointError(w, &endpointError{
			status:      http.StatusServiceUnavailable,
			code:        "upload_disabled",
			description: "server started without -upload-dir; uploads disabled",
		})
		return
	}
	if err := s.AuthJWT(r); err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusUnauthorized,
			code:        "unauthenticated",
			description: err.Error(),
		})
		return
	}
	if !hasAdminRole(rolesFromContext(r.Context())) {
		writeEndpointError(w, &endpointError{
			status:      http.StatusForbidden,
			code:        "insufficient_role",
			description: "admin role required for uploads",
		})
		return
	}

	// MaxBytesReader caps the request body before we touch multipart
	// parsing, so an attacker sending an enormous Content-Length cannot
	// fill the disk via a single request.
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		// http.MaxBytesError lands here as well; the description below
		// is intentionally generic so the body cap implementation is
		// not part of the public surface.
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeEndpointError(w, &endpointError{
				status:      http.StatusRequestEntityTooLarge,
				code:        "upload_too_large",
				description: "upload exceeds 64 MiB cap",
			})
			return
		}
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadRequest,
			code:        "bad_multipart",
			description: "could not parse multipart body: " + err.Error(),
		})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadRequest,
			code:        "missing_file",
			description: `multipart field "file" is required`,
		})
		return
	}
	defer func() { _ = file.Close() }()

	name, err := sanitiseUploadName(header.Filename)
	if err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadRequest,
			code:        "invalid_filename",
			description: err.Error(),
		})
		return
	}

	dir := filepath.Join(s.cfg.UploadDir, subdir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusInternalServerError,
			code:        "upload_dir_failed",
			description: "could not create upload dir: " + err.Error(),
		})
		return
	}

	finalPath := filepath.Join(dir, name)
	tmpPath := finalPath + ".tmp"
	out, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o640)
	if err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusInternalServerError,
			code:        "upload_open_failed",
			description: "could not open destination: " + err.Error(),
		})
		return
	}
	n, copyErr := io.Copy(out, file)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(tmpPath)
		writeEndpointError(w, &endpointError{
			status:      http.StatusInternalServerError,
			code:        "upload_write_failed",
			description: "could not write file: " + copyErr.Error(),
		})
		return
	}
	if closeErr != nil {
		_ = os.Remove(tmpPath)
		writeEndpointError(w, &endpointError{
			status:      http.StatusInternalServerError,
			code:        "upload_close_failed",
			description: "could not close file: " + closeErr.Error(),
		})
		return
	}
	if err := os.Rename(tmpPath, finalPath); err != nil {
		_ = os.Remove(tmpPath)
		writeEndpointError(w, &endpointError{
			status:      http.StatusInternalServerError,
			code:        "upload_rename_failed",
			description: "could not finalise upload: " + err.Error(),
		})
		return
	}

	emitAudit(auditEvent,
		"user", userFromContext(r.Context()),
		"file", name,
		"size_bytes", n,
		"kind", subdir,
		"source", "upload",
	)

	resp := uploadResponse{
		File:       name,
		SizeBytes:  n,
		Path:       finalPath,
		UploadedAt: timeNow().UTC().Format(time.RFC3339),
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.MarshalWrite(w, resp)
}

// sanitiseUploadName verifies the multipart-supplied filename is a
// pure basename matching safeNameRE. Names that already contain path
// separators ("/", "\") or directory traversal markers (".", "..") are
// rejected outright rather than silently collapsed via filepath.Base —
// silently dropping path components hides the caller's intent (was it
// a buggy client or an attack?) and audit logs lose the original
// filename anyway.
func sanitiseUploadName(name string) (string, error) {
	if name == "" || name == "." || name == ".." {
		return "", errInvalidUploadName
	}
	if strings.ContainsAny(name, `/\`) {
		return "", errInvalidUploadName
	}
	if !safeNameRE.MatchString(name) {
		return "", errInvalidUploadName
	}
	// Defence-in-depth: even after the regex check, refuse a name that
	// would not match its own filepath.Base — guards against any edge
	// case (e.g. NUL embedded between regex-allowed runes) the regex
	// might miss on a future Go version.
	if filepath.Base(name) != name {
		return "", errInvalidUploadName
	}
	return name, nil
}

// hasAdminRole reports whether roles contains "admin" (case-insensitive,
// matching the JWT.Issue/securex.RoleFromString convention used elsewhere
// in the package).
func hasAdminRole(roles []string) bool {
	for _, r := range roles {
		if strings.EqualFold(r, "admin") {
			return true
		}
	}
	return false
}

// errInvalidUploadName surfaces when a multipart filename contains
// characters outside [A-Za-z0-9._-] or resolves to . / .. — both of
// which would let the caller escape UploadDir.
var errInvalidUploadName = errors.New(`filename must match [A-Za-z0-9._-]+ and not be "." or ".."`)
