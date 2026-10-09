package server

import (
	"encoding/json/v2"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"encoding/json/jsontext"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// Backup/Restore handlers — admin endpoints under /api/v1/backups and
// /api/v1/restore.
//
// The genapi-emitted method names in this surface are:
//
//   GetBackups  → GET    /api/v1/backups
//   PostBackups → POST   /api/v1/backups
//   GetFile     → GET    /api/v1/backups/{file}
//   DeleteFile  → DELETE /api/v1/backups/{file}
//   Cleanup     → POST   /api/v1/backups/cleanup
//   Restore     → POST   /api/v1/restore
//
// Naming: the path-param leaf is `{file}` so the disambiguator collapses
// the per-file verbs to GetFile/DeleteFile. Cleanup is from
// /backups/cleanup, Restore is from /restore — both unique terminal
// segments. The Go-private surface area is fine — the routes are
// exercised only via the generated mux and the unit tests below.
//
// GQL syntax (forward-compatible — Geode 0.3.8 ships `geode backup *`
// and `geode restore` CLI subcommands that bypass the wire and operate
// directly on the data dir today; live `geode query "BACKUP CREATE"`
// against 0.3.8 times out, confirming wire-level support is not yet
// available).
//
//   BACKUP CREATE [GRAPH `name`] [OUTPUT '/path']
//        → row (file, path, size_bytes, created_at)
//   SHOW BACKUPS
//        → rows of backup metadata
//   SHOW BACKUP `file`
//        → row with detailed info (graph_count, node_count, edge_count)
//   DROP BACKUP `file`
//   BACKUP CLEANUP
//        → row (removed, freed_bytes)
//   RESTORE `file` [AT '<target_time>']
//
// Handlers emit those statements anyway so the UI picks up wire support
// automatically once Geode adds it. The quoting helpers in util.go keep
// the string-concatenated statements injection-safe in the meantime.
//
// File-name safety: the `file` path-parameter is a backup filename, not
// a free-form path. sanitizeBackupFile (below) restricts it to the
// portable filename character class [A-Za-z0-9._-] and rejects names
// with a leading `.` (no hidden files), `..` segments, or path
// separators. Any caller-supplied file name failing that check returns
// 400 before reaching the driver.

// GetBackups implements GET /api/v1/backups (list backups).
func (s *GraphServer) GetBackups(w http.ResponseWriter, r *http.Request, _ *gentypes.Empty) (*gentypes.BackupList, error) {
	out, done, err := s.showRowsAsJSON(w, r, "SHOW BACKUPS", "backup")
	if done {
		return nil, err
	}
	return &gentypes.BackupList{Backups: out}, nil
}

// showRowsAsJSON runs a SHOW-style catalog statement on the caller's
// connection and returns one JSON object per row. A Geode build that
// does not implement the statement (wire_feature_missing) yields an
// empty, non-nil list so list endpoints degrade to 200 + []. When done
// is true the handler must return (nil, err) immediately: the error
// response has already been written (err == nil) or err is a 500.
func (s *GraphServer) showRowsAsJSON(
	w http.ResponseWriter, r *http.Request, stmt, what string,
) ([]jsontext.Value, bool, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, true, respondErr(w, err)
	}
	rows, cols, err := runQuery(r.Context(), db, stmt)
	if err != nil {
		if isWireFeatureMissing(err) {
			return []jsontext.Value{}, false, nil
		}
		return nil, true, respondErr(w, wireErr(err))
	}
	out := make([]jsontext.Value, 0, len(rows))
	for _, row := range rows {
		obj := rowToMap(cols, row)
		raw, mErr := json.Marshal(obj)
		if mErr != nil {
			return nil, true, fmt.Errorf("marshal %s row: %w", what, mErr)
		}
		out = append(out, jsontext.Value(raw))
	}
	return out, false, nil
}

// PostBackups implements POST /api/v1/backups (create a backup).
//
// Both `graph` and `output` are optional. graph is inlined as a quoted
// identifier; output is a string literal (single-quoted). The server
// returns the first row of the BACKUP CREATE result set as a typed
// BackupRef.
func (s *GraphServer) PostBackups(w http.ResponseWriter, r *http.Request, req *gentypes.BackupCreateReq) (*gentypes.BackupRef, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	stmt := "BACKUP CREATE"
	if req.Graph != "" {
		gname, qErr := quoteIdent(req.Graph)
		if qErr != nil {
			return nil, respondErr(w, badRequest(ErrCodeInvalidGraph, qErr.Error()))
		}
		stmt += " GRAPH " + gname
	}
	if req.Output != "" {
		out, qErr := quoteString(req.Output)
		if qErr != nil {
			return nil, respondErr(w, badRequest(ErrCodeInvalidOutput, qErr.Error()))
		}
		stmt += " OUTPUT " + out
	}
	rows, cols, err := runQuery(r.Context(), db, stmt)
	if err != nil {
		return nil, respondErr(w, wireErr(err))
	}
	if len(rows) == 0 {
		// No row returned — surface an empty BackupRef rather than 500
		// so the client can decide whether to treat it as success.
		emitAudit(auditEventBackupCreated,
			"user", userFromContext(r.Context()),
			"graph", req.Graph,
		)
		return &gentypes.BackupRef{}, nil
	}
	ref := backupRefFromRow(cols, rows[0])
	emitAudit(auditEventBackupCreated,
		"user", userFromContext(r.Context()),
		"graph", req.Graph,
		auditKeyFile, ref.File,
	)
	return ref, nil
}

// GetFile implements GET /api/v1/backups/{file} (backup info).
func (s *GraphServer) GetFile(w http.ResponseWriter, r *http.Request, req *gentypes.BackupFileParam) (*gentypes.BackupInfo, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	if err := sanitizeBackupFile(req.File); err != nil {
		return nil, respondErr(w, badRequest(ErrCodeInvalidFile, err.Error()))
	}
	// v0.5.15: BACKUP / RESTORE paths are string literals (single-quoted)
	// per parseBackupStatement / parseRestoreStatement in
	// src/gql/parser.zig. They are NOT identifiers, so quoteIdent's
	// identifier-shape rule rejects valid filenames containing `.`.
	fname, err := quoteString(req.File)
	if err != nil {
		return nil, respondErr(w, badRequest(ErrCodeInvalidFile, err.Error()))
	}
	rows, cols, err := runQuery(r.Context(), db, "SHOW BACKUP "+fname)
	if err != nil {
		return nil, respondErr(w, wireErr(err))
	}
	if len(rows) == 0 {
		return nil, respondErr(w, &endpointError{
			status:      http.StatusNotFound,
			code:        ErrCodeBackupNotFound,
			description: "backup " + req.File + " does not exist",
		})
	}
	return backupInfoFromRow(cols, rows[0]), nil
}

// DeleteFile implements DELETE /api/v1/backups/{file} (drop backup).
func (s *GraphServer) DeleteFile(w http.ResponseWriter, r *http.Request, req *gentypes.BackupFileParam) (*gentypes.Empty, error) {
	return s.execNamedAdmin(w, r, req.File, namedAdminStmt{
		prefix: "DROP BACKUP ",
		// v0.5.15: BACKUP / RESTORE paths are string literals (single-quoted)
		// per parseBackupStatement / parseRestoreStatement in
		// src/gql/parser.zig. They are NOT identifiers, so quoteIdent's
		// identifier-shape rule rejects valid filenames containing `.`.
		quote:       quoteString,
		invalidCode: ErrCodeInvalidFile,
		auditEvent:  auditEventBackupDeleted,
		auditKey:    auditKeyFile,
	})
}

// namedAdminStmt describes a single-argument admin statement whose
// argument is a caller-supplied backup/migration name.
type namedAdminStmt struct {
	prefix      string                       // statement text before the quoted name
	quote       func(string) (string, error) // quoteString or quoteIdent
	invalidCode string                       // 400 code for a rejected name
	auditEvent  string                       // emitted on success
	auditKey    string                       // audit field carrying the raw name
}

// execNamedAdmin is the shared body of DeleteFile and Sign: it validates
// name with sanitizeBackupFile, quotes it, runs prefix+quoted on the
// caller's connection, and audits on success.
func (s *GraphServer) execNamedAdmin(
	w http.ResponseWriter, r *http.Request, name string, st namedAdminStmt,
) (*gentypes.Empty, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	if err := sanitizeBackupFile(name); err != nil {
		return nil, respondErr(w, badRequest(st.invalidCode, err.Error()))
	}
	quoted, err := st.quote(name)
	if err != nil {
		return nil, respondErr(w, badRequest(st.invalidCode, err.Error()))
	}
	if _, err := runStatement(r.Context(), db, st.prefix+quoted); err != nil {
		return nil, respondErr(w, wireErr(err))
	}
	emitAudit(st.auditEvent,
		"user", userFromContext(r.Context()),
		st.auditKey, name,
	)
	return &gentypes.Empty{}, nil
}

// Cleanup implements POST /api/v1/backups/cleanup (prune old backups).
//
// Returns a typed BackupCleanupResp pulled from the first row of the
// BACKUP CLEANUP result set. Driver-emitted columns expected:
// `removed`, `freed_bytes`.
func (s *GraphServer) Cleanup(w http.ResponseWriter, r *http.Request, _ *gentypes.Empty) (*gentypes.BackupCleanupResp, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	rows, cols, err := runQuery(r.Context(), db, "BACKUP CLEANUP")
	if err != nil {
		return nil, respondErr(w, wireErr(err))
	}
	if len(rows) == 0 {
		emitAudit(auditEventBackupCleanup, "user", userFromContext(r.Context()))
		return &gentypes.BackupCleanupResp{}, nil
	}
	resp := backupCleanupRespFromRow(cols, rows[0])
	emitAudit(auditEventBackupCleanup,
		"user", userFromContext(r.Context()),
		"removed", resp.Removed,
		"freed_bytes", resp.FreedBytes,
	)
	return resp, nil
}

// Restore implements POST /api/v1/restore (restore from a backup).
func (s *GraphServer) Restore(w http.ResponseWriter, r *http.Request, req *gentypes.RestoreReq) (*gentypes.Empty, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	if err := sanitizeBackupFile(req.File); err != nil {
		return nil, respondErr(w, badRequest(ErrCodeInvalidFile, err.Error()))
	}
	// v0.5.15: BACKUP / RESTORE paths are string literals (single-quoted)
	// per parseBackupStatement / parseRestoreStatement in
	// src/gql/parser.zig. They are NOT identifiers, so quoteIdent's
	// identifier-shape rule rejects valid filenames containing `.`.
	fname, err := quoteString(req.File)
	if err != nil {
		return nil, respondErr(w, badRequest(ErrCodeInvalidFile, err.Error()))
	}
	stmt := "RESTORE " + fname
	if req.TargetTime != "" {
		tt, qErr := quoteString(req.TargetTime)
		if qErr != nil {
			return nil, respondErr(w, badRequest(ErrCodeInvalidTargetTime, qErr.Error()))
		}
		stmt += " AT " + tt
	}
	if _, err := runStatement(r.Context(), db, stmt); err != nil {
		return nil, respondErr(w, wireErr(err))
	}
	emitAudit(auditEventBackupRestored,
		"user", userFromContext(r.Context()),
		auditKeyFile, req.File,
		"target_time", req.TargetTime,
	)
	return &gentypes.Empty{}, nil
}

// sanitizeBackupFile validates that name is a portable backup filename:
// only [A-Za-z0-9._-] characters are allowed, the name must be
// non-empty, must not start with `.` (no hidden files), must not
// contain `..` (no parent traversal), and must not contain `/` or `\`
// (no path separators). This is a defence-in-depth check on top of
// quoteIdent — a backup file name is a filesystem-shaped value and we
// cannot rely on the GQL parser to reject path traversal in it.
func sanitizeBackupFile(name string) error {
	if name == "" {
		return errInvalidIdent
	}
	if name[0] == '.' {
		return errors.New("backup file must not start with '.'")
	}
	if strings.Contains(name, "..") {
		return errors.New("backup file must not contain '..'")
	}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '.', r == '_', r == '-':
			// permitted
		default:
			return fmt.Errorf("backup file contains forbidden character %q", r)
		}
	}
	return nil
}

// backupRefFromRow projects a BACKUP CREATE row onto the typed
// BackupRef schema. Whatever subset of columns the driver returns we
// pick up by name; missing columns leave their corresponding field at
// the zero value.
func backupRefFromRow(cols []string, row []any) *gentypes.BackupRef {
	b := &gentypes.BackupRef{}
	for i, c := range cols {
		if i >= len(row) {
			break
		}
		switch c {
		case colFile:
			b.File = asStr(row[i])
		case "path":
			b.Path = asStr(row[i])
		case "size_bytes":
			b.SizeBytes = asInt(row[i])
		case "created_at":
			b.CreatedAt = asStr(row[i])
		}
	}
	return b
}

// backupInfoFromRow projects a SHOW BACKUP row onto the typed
// BackupInfo schema.
func backupInfoFromRow(cols []string, row []any) *gentypes.BackupInfo {
	b := &gentypes.BackupInfo{}
	for i, c := range cols {
		if i >= len(row) {
			break
		}
		switch c {
		case colFile:
			b.File = asStr(row[i])
		case "path":
			b.Path = asStr(row[i])
		case "size_bytes":
			b.SizeBytes = asInt(row[i])
		case "created_at":
			b.CreatedAt = asStr(row[i])
		case "graph_count":
			b.GraphCount = asInt(row[i])
		case "node_count":
			b.NodeCount = asInt(row[i])
		case "edge_count":
			b.EdgeCount = asInt(row[i])
		}
	}
	return b
}

// backupCleanupRespFromRow projects the BACKUP CLEANUP summary row
// onto the typed BackupCleanupResp schema.
func backupCleanupRespFromRow(cols []string, row []any) *gentypes.BackupCleanupResp {
	r := &gentypes.BackupCleanupResp{}
	for i, c := range cols {
		if i >= len(row) {
			break
		}
		switch c {
		case "removed":
			r.Removed = asInt(row[i])
		case "freed_bytes":
			r.FreedBytes = asInt(row[i])
		}
	}
	return r
}

// asInt coerces a driver-returned column value to an int64. INTEGER
// columns from the geode driver scan as int64, but historic versions
// emitted them as float64 or string ("123") so this helper tolerates
// all of those.
func asInt(v any) int64 {
	switch t := v.(type) {
	case nil:
		return 0
	case int64:
		return t
	case int:
		return int64(t)
	case int32:
		return int64(t)
	case float64:
		return int64(t)
	case float32:
		return int64(t)
	case []byte:
		if n, err := strconv.ParseInt(string(t), 10, 64); err == nil {
			return n
		}
		return 0
	case string:
		if n, err := strconv.ParseInt(t, 10, 64); err == nil {
			return n
		}
		return 0
	default:
		return 0
	}
}
