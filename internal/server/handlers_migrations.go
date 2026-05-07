package server

import (
	"encoding/json/v2"
	"fmt"
	"net/http"

	"encoding/json/jsontext"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// Migration handlers — admin endpoints under /api/v1/migrations.
//
// The genapi-emitted method names in this surface are:
//
//   GetMigrations     → GET  /api/v1/migrations
//   PostMigrations    → POST /api/v1/migrations         (create)
//   PostMigrationsRun → POST /api/v1/migrations/run     (apply pending)
//   Sign              → POST /api/v1/migrations/{name}/sign
//
// Naming: the disambiguator collapses POST /migrations and POST
// /migrations/run to PostMigrations / PostMigrationsRun (URI-prefix
// fallback because both terminal segments would otherwise collide
// with each other and with the Run name already used by the
// transaction handler — note that B7+B8 also rotated tx run from
// `Run` to `PostTxidRun`).
//
// GQL syntax (forward-compatible — Geode 0.3.8 ships `geode migrate *`
// CLI subcommands that bypass the wire today; live `geode query
// "SHOW MIGRATIONS"` against 0.3.8 times out, confirming wire-level
// support is not yet available).
//
//   SHOW MIGRATIONS                    → rows of migration entries with status
//   MIGRATE RUN                        → rows of applied migration names
//   CREATE MIGRATION `name` [DESCRIPTION '...']
//   MIGRATE SIGN `name`
//
// Same name-safety discipline as backups: the {name} path-parameter is
// quoted with quoteIdent and rejected by sanitizeBackupFile (the same
// portable filename allowlist applies to migration file names).

// GetMigrations implements GET /api/v1/migrations (status).
//
// SHOW MIGRATIONS is expected to return a row per migration with
// columns indicating status (e.g. `name`, `status`/`applied`). We
// classify each row as pending or applied based on a `status` or
// `applied` column; if neither is present the row is treated as
// applied (the conservative default — surfaces the row to the UI in
// either case, but lets the operator distinguish state once Geode
// emits the column).
func (s *GraphServer) GetMigrations(w http.ResponseWriter, r *http.Request, _ *gentypes.Empty) (*gentypes.MigrationStatus, error) {
	db, err := s.userDB(r.Context())
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	rows, cols, err := runQuery(r.Context(), db, "SHOW MIGRATIONS")
	if err != nil {
		return nil, userResponseErr(w, userErr(err))
	}
	pending := make([]string, 0)
	applied := make([]jsontext.Value, 0, len(rows))
	for _, row := range rows {
		obj := userRowToMap(cols, row)
		isPending := false
		if v, ok := obj["status"]; ok {
			if asStr(v) == "pending" {
				isPending = true
			}
		} else if v, ok := obj["applied"]; ok {
			if !asBool(v) {
				isPending = true
			}
		}
		if isPending {
			pending = append(pending, asStr(obj["name"]))
			continue
		}
		raw, mErr := json.Marshal(obj)
		if mErr != nil {
			return nil, fmt.Errorf("marshal migration row: %w", mErr)
		}
		applied = append(applied, jsontext.Value(raw))
	}
	return &gentypes.MigrationStatus{Pending: pending, Applied: applied}, nil
}

// PostMigrationsRun implements POST /api/v1/migrations/run.
//
// MIGRATE RUN returns one row per applied migration name. The
// response surfaces a string slice of those names in the order Geode
// applied them.
func (s *GraphServer) PostMigrationsRun(w http.ResponseWriter, r *http.Request, _ *gentypes.Empty) (*gentypes.MigrationRunResp, error) {
	db, err := s.userDB(r.Context())
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	rows, cols, err := runQuery(r.Context(), db, "MIGRATE RUN")
	if err != nil {
		return nil, userResponseErr(w, userErr(err))
	}
	applied := make([]string, 0, len(rows))
	for _, row := range rows {
		obj := userRowToMap(cols, row)
		if v, ok := obj["name"]; ok {
			applied = append(applied, asStr(v))
			continue
		}
		// Fall back to first column if `name` is not present.
		if len(row) > 0 {
			applied = append(applied, asStr(row[0]))
		}
	}
	emitAudit(auditEventMigrationRun,
		"user", userFromContext(r.Context()),
		"applied", applied,
	)
	return &gentypes.MigrationRunResp{Applied: applied}, nil
}

// PostMigrations implements POST /api/v1/migrations (create migration).
func (s *GraphServer) PostMigrations(w http.ResponseWriter, r *http.Request, req *gentypes.MigrationCreateReq) (*gentypes.MigrationRef, error) {
	db, err := s.userDB(r.Context())
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	if err := sanitizeBackupFile(req.Name); err != nil {
		return nil, userResponseErr(w, badRequest("invalid_name", err.Error()))
	}
	mname, err := quoteIdent(req.Name)
	if err != nil {
		return nil, userResponseErr(w, badRequest("invalid_name", err.Error()))
	}
	stmt := "CREATE MIGRATION " + mname
	if req.Description != "" {
		desc, qErr := quoteString(req.Description)
		if qErr != nil {
			return nil, userResponseErr(w, badRequest("invalid_description", qErr.Error()))
		}
		stmt += " DESCRIPTION " + desc
	}
	if _, err := runStatement(r.Context(), db, stmt); err != nil {
		return nil, userResponseErr(w, userErr(err))
	}
	emitAudit(auditEventMigrationCreated,
		"user", userFromContext(r.Context()),
		"name", req.Name,
	)
	return &gentypes.MigrationRef{Name: req.Name}, nil
}

// Sign implements POST /api/v1/migrations/{name}/sign.
func (s *GraphServer) Sign(w http.ResponseWriter, r *http.Request, req *gentypes.MigrationParam) (*gentypes.Empty, error) {
	db, err := s.userDB(r.Context())
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	if err := sanitizeBackupFile(req.Name); err != nil {
		return nil, userResponseErr(w, badRequest("invalid_name", err.Error()))
	}
	mname, err := quoteIdent(req.Name)
	if err != nil {
		return nil, userResponseErr(w, badRequest("invalid_name", err.Error()))
	}
	if _, err := runStatement(r.Context(), db, "MIGRATE SIGN "+mname); err != nil {
		return nil, userResponseErr(w, userErr(err))
	}
	emitAudit(auditEventMigrationSigned,
		"user", userFromContext(r.Context()),
		"name", req.Name,
	)
	return &gentypes.Empty{}, nil
}
