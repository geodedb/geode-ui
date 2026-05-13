package server

import (
	"context"
	"database/sql"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"net/http"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// GetCapabilities implements GET /api/v1/capabilities.
//
// This is a read endpoint — every authenticated user may consult it
// (no admin-role requirement). The genapi wrapper handles auth/CSRF as
// for the other GET routes. It exists so the SPA can gate the
// "+ New user/role/policy" CTAs and the Grants Apply/Revoke buttons on
// whether the connected Geode build actually accepts the corresponding
// admin DDL over the wire — see UsersPage / RolesPage / PoliciesPage /
// GrantsPanel and the useCapabilities() hook. The create *actions*
// remain admin-gated server-side regardless of what this returns.
//
// Response shape:
//
//	{
//	  "geode_version": "<version string>",
//	  "admin_writable": { "users": false, "roles": false,
//	                      "policies": false, "grants": false }
//	}
//
// Q53 (#198) / Geode v0.5.15: the connected Geode build is probed via
//
//   - `SHOW VERSION`       — single-row, single-column `version` result.
//
//   - `SHOW CAPABILITIES`  — two-column (`feature`, `supported`) result
//     where `supported` is a "true"/"false" string. The upstream feature
//     names are pinned by `src/execution/admin_ddl.zig`
//     (`executeShowCapabilities`); only the four that map onto SPA gates
//     are consumed here:
//
//     SPA flag                    upstream feature
//     admin_writable.users     -> auth_ddl
//     admin_writable.roles     -> role_ddl
//     admin_writable.grants    -> grant_ddl
//     admin_writable.policies  -> policy_ddl  (still false on v0.5.15)
//
// Older Geode builds (<= v0.5.11) lack the SHOW VERSION / SHOW
// CAPABILITIES grammar entirely, so the probe trips the parse-error
// fallback (isWireFeatureMissing). In that case the response degrades
// to admin_writable.{users,roles,policies,grants}=false and
// geode_version=s.cfg.Version — the same all-false posture the hard-
// coded predecessor returned.
func (s *GraphServer) GetCapabilities(_ http.ResponseWriter, r *http.Request, _ *gentypes.Empty) (*gentypes.Capabilities, error) {
	ctx := r.Context()

	// Resolve the active connection DB. A missing pool (test wiring
	// without `Pool`, or no profile yet configured) keeps the legacy
	// fallback semantics: all-false flags + cfg.Version. We do NOT
	// propagate the connDB error; the capabilities endpoint must never
	// 5xx the SPA — the Admin pages depend on a 200 response to even
	// render their gated CTAs.
	var db *sql.DB
	if s.cfg.Pool != nil {
		var err error
		db, err = s.connDB(ctx)
		if err != nil {
			db = nil // degrade to all-false / cfg.Version below.
		}
	}

	geodeVersion := readShowVersion(ctx, db)
	if geodeVersion == "" {
		geodeVersion = s.cfg.Version
	}

	writable := readShowCapabilities(ctx, db)

	adminWritable, err := json.Marshal(writable)
	if err != nil {
		// map[string]bool always marshals cleanly; treat any failure as
		// a 500 via the generated wrapper.
		return nil, err
	}

	return &gentypes.Capabilities{
		GeodeVersion:  geodeVersion,
		AdminWritable: jsontext.Value(adminWritable),
	}, nil
}

// readShowVersion issues `SHOW VERSION` against db and returns the
// server's reported build string. Empty string on any failure (nil db,
// driver error, missing rows, malformed columns) so the caller can fall
// back to s.cfg.Version. Errors that look like a wire-feature-missing
// parse failure (older Geode build without SHOW VERSION grammar) are
// silently swallowed — there is no legitimate way to surface them to
// the UI, and the legacy fallback is correct.
func readShowVersion(ctx context.Context, db *sql.DB) string {
	if db == nil {
		return ""
	}
	rows, cols, err := runQuery(ctx, db, "SHOW VERSION")
	if err != nil {
		return ""
	}
	if len(rows) == 0 || len(cols) == 0 || len(rows[0]) == 0 {
		return ""
	}
	return asStr(rows[0][0])
}

// readShowCapabilities issues `SHOW CAPABILITIES` against db and folds
// the (feature, supported) rows into the four-bool admin_writable map
// the SPA consumes. Unknown features are ignored; missing/expected
// features default to false. The "users" flag is bound to the upstream
// `auth_ddl` capability per docs/GQL_AUTH_DDL.md.
//
// nil db, driver errors, or shape mismatches all degrade to all-false
// (the legacy posture).
func readShowCapabilities(ctx context.Context, db *sql.DB) map[string]bool {
	out := map[string]bool{
		"users":    false,
		"roles":    false,
		"policies": false,
		"grants":   false,
	}
	if db == nil {
		return out
	}
	rows, cols, err := runQuery(ctx, db, "SHOW CAPABILITIES")
	if err != nil {
		return out
	}
	// Expected columns: feature, supported. Tolerate either order or
	// any superset; locate the indices by name.
	featureCol, supportedCol := -1, -1
	for i, c := range cols {
		switch c {
		case "feature":
			featureCol = i
		case "supported":
			supportedCol = i
		}
	}
	if featureCol < 0 || supportedCol < 0 {
		return out
	}
	// Map upstream feature names onto SPA gate keys. Sourced from
	// `src/execution/admin_ddl.zig` (executeShowCapabilities) at
	// geodedb v0.5.15.
	featureToGate := map[string]string{
		"auth_ddl":   "users",
		"role_ddl":   "roles",
		"grant_ddl":  "grants",
		"policy_ddl": "policies",
	}
	for _, row := range rows {
		if featureCol >= len(row) || supportedCol >= len(row) {
			continue
		}
		gate, ok := featureToGate[asStr(row[featureCol])]
		if !ok {
			continue
		}
		out[gate] = asBool(row[supportedCol])
	}
	return out
}
