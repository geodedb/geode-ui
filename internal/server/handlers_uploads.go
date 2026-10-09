package server

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	gen "geodedb.com/geode-ui/gen/pkg/gen"
	gentypes "geodedb.com/geode-ui/gen/types"
)

// Multipart upload endpoints — declared in geode.json and emitted by
// genapi as proper typed routes (GAP-Q5 #34):
//
//   POST /api/v1/backups/upload    -> BackupUpload    (BackupUploadReq    -> UploadResp)
//   POST /api/v1/migrations/upload -> MigrationUpload (MigrationUploadReq -> UploadResp)
//
// The genapi-emitted wrapper (gen/api/handlers_gen.go) already does the
// heavy lifting before these handlers run:
//   - JWT auth (auth: "jwt") + admin-role enforcement (required_roles:
//     ["admin"]) — same gate as the rest of the /api/v1/backups and
//     /api/v1/migrations surface.
//   - 64 MiB request body cap (maxBodyBytes: 67108864) via
//     http.MaxBytesReader before multipart parsing.
//   - r.ParseMultipartForm + r.FormFile("file") + the per-file maxSize
//     check, handing us req.File as an open *gen.FileUpload, and a
//     defer that calls r.MultipartForm.RemoveAll() after we return.
//
// So these handlers only own the disk-side concerns:
//   - Filename sanitisation: only [A-Za-z0-9._-] survive; path
//     separators, NULs, and "."/".." are rejected with 400. This keeps
//     an attacker from writing outside UploadDir via "../../etc/passwd"
//     style names.
//   - Atomic write: file lands as <name>.tmp first, then os.Rename'd
//     onto the final path, so a partial upload never leaves a half-
//     written file with a real-looking name.
//   - The 503 when the server was started without -upload-dir.
//
// Wire dialect note: v0.5.x doesn't accept RESTORE / CREATE MIGRATION
// over the wire, so these endpoints just stage files on local disk for
// an operator to pick up — a future Geode that grows those verbs makes
// the postBackups / postMigrations plumbing a one-line change.

// safeNameRE pins what characters are allowed in an uploaded filename.
// Intentionally stricter than POSIX filename rules — we reject spaces
// and Unicode to keep audit logs greppable and to avoid surprises with
// shell-quoting in operator workflows.
var safeNameRE = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// BackupUpload stages an uploaded backup file under <UploadDir>/backups/.
// Generated route: POST /api/v1/backups/upload.
func (s *GraphServer) BackupUpload(
	w http.ResponseWriter, r *http.Request, req *gentypes.BackupUploadReq,
) (*gentypes.UploadResp, error) {
	var f *gen.FileUpload
	if req != nil {
		f = req.File
	}
	return s.stageUpload(w, r, f, "backups", auditEventBackupCreated)
}

// MigrationUpload stages an uploaded migration file under
// <UploadDir>/migrations/. Generated route: POST /api/v1/migrations/upload.
func (s *GraphServer) MigrationUpload(
	w http.ResponseWriter, r *http.Request, req *gentypes.MigrationUploadReq,
) (*gentypes.UploadResp, error) {
	var f *gen.FileUpload
	if req != nil {
		f = req.File
	}
	return s.stageUpload(w, r, f, "migrations", auditEventMigrationCreated)
}

// stageUpload is the shared body for both upload endpoints. subdir is
// the per-kind subdirectory ("backups" or "migrations"); auditEvent is
// emitted on success so the audit log shows the operator who staged the
// file alongside the backup_created / migration_created events the
// genapi-emitted creation handlers will eventually produce.
//
// On a fine-grained client/server error it writes the response via w
// (the genapi wrapper only maps a non-nil error to 500/501) and returns
// (nil, nil) so the wrapper writes nothing further. On success it
// returns the typed UploadResp and the wrapper marshals it (200).
func (s *GraphServer) stageUpload(
	w http.ResponseWriter, r *http.Request, file *gen.FileUpload, subdir, auditEvent string,
) (*gentypes.UploadResp, error) {
	if s.cfg.UploadDir == "" {
		writeEndpointError(w, &endpointError{
			status:      http.StatusServiceUnavailable,
			code:        ErrCodeUploadDisabled,
			description: "server started without -upload-dir; uploads disabled",
		})
		return responseWritten[gentypes.UploadResp]()
	}
	if file == nil || file.Reader == nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadRequest,
			code:        ErrCodeMissingFile,
			description: `multipart field "file" is required`,
		})
		return responseWritten[gentypes.UploadResp]()
	}

	name, err := sanitiseUploadName(file.Filename)
	if err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadRequest,
			code:        ErrCodeInvalidFilename,
			description: err.Error(),
		})
		return responseWritten[gentypes.UploadResp]()
	}

	dir := filepath.Join(s.cfg.UploadDir, subdir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusInternalServerError,
			code:        ErrCodeUploadDirFailed,
			description: "could not create upload dir: " + err.Error(),
		})
		return responseWritten[gentypes.UploadResp]()
	}

	finalPath := filepath.Join(dir, name)
	tmpPath := finalPath + ".tmp"
	// G302/G304: mode 0o640 is intentional (group-readable so the
	// backup/restore worker running under the same group can consume
	// staged files); path is filepath.Join(UploadDir, subdir, name) where
	// name is the return of sanitiseUploadName — an [A-Za-z0-9._-]+
	// allowlist that rejects path separators and "."/".." and re-checks
	// filepath.Base(name)==name, so no traversal is possible.
	out, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o640) // #nosec G302 G304 -- see above
	if err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusInternalServerError,
			code:        ErrCodeUploadOpenFailed,
			description: "could not open destination: " + err.Error(),
		})
		return responseWritten[gentypes.UploadResp]()
	}
	n, copyErr := io.Copy(out, file.Reader)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(tmpPath)
		writeEndpointError(w, &endpointError{
			status:      http.StatusInternalServerError,
			code:        ErrCodeUploadWriteFailed,
			description: "could not write file: " + copyErr.Error(),
		})
		return responseWritten[gentypes.UploadResp]()
	}
	if closeErr != nil {
		_ = os.Remove(tmpPath)
		writeEndpointError(w, &endpointError{
			status:      http.StatusInternalServerError,
			code:        ErrCodeUploadCloseFailed,
			description: "could not close file: " + closeErr.Error(),
		})
		return responseWritten[gentypes.UploadResp]()
	}
	if err := os.Rename(tmpPath, finalPath); err != nil {
		_ = os.Remove(tmpPath)
		writeEndpointError(w, &endpointError{
			status:      http.StatusInternalServerError,
			code:        ErrCodeUploadRenameFailed,
			description: "could not finalise upload: " + err.Error(),
		})
		return responseWritten[gentypes.UploadResp]()
	}

	emitAudit(auditEvent,
		"user", userFromContext(r.Context()),
		auditKeyFile, name,
		"size_bytes", n,
		"kind", subdir,
		"source", "upload",
	)

	return &gentypes.UploadResp{
		File:       name,
		SizeBytes:  n,
		Path:       finalPath,
		UploadedAt: timeNow().UTC().Format(time.RFC3339),
	}, nil
}

// sanitiseUploadName verifies the multipart-supplied filename is a pure
// basename matching safeNameRE. Names that already contain path
// separators ("/", "\") or directory-traversal markers (".", "..") are
// rejected outright rather than silently collapsed via filepath.Base —
// silently dropping path components hides the caller's intent (buggy
// client or attack?) and audit logs lose the original filename anyway.
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

// errInvalidUploadName surfaces when a multipart filename contains
// characters outside [A-Za-z0-9._-] or resolves to . / .. — both of
// which would let the caller escape UploadDir.
var errInvalidUploadName = errors.New(`filename must match [A-Za-z0-9._-]+ and not be "." or ".."`)
