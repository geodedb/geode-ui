package server

import (
	"encoding/json/v2"
	"fmt"
	"net/http"

	"encoding/json/jsontext"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// Role-management handlers — admin endpoints under /api/v1/roles.
//
// The genapi-emitted method names in this surface are:
//
//   GetRoles      → GET    /api/v1/roles
//   PostApiRoles  → POST   /api/v1/roles
//   GetRole       → GET    /api/v1/roles/{role}
//   DeleteRole    → DELETE /api/v1/roles/{role}
//
// Naming: the generator produces `PostApiRoles` (rather than the more
// natural `PostRoles`) because POST /api/v1/users/{username}/roles
// already claimed the `Roles` family — the disambiguator falls back to
// the URI-prefix tokens. The interface contract is what matters; the
// surface is internal-only and exercised only by the generated mux.
//
// GQL admin syntax (Geode v0.5.15+):
//
//	CREATE ROLE <name> [ SET DESCRIPTION '<text>' ]
//	DROP   ROLE [ IF EXISTS ] <name>
//	SHOW   ROLES
//
// Upstream parser is `parseCreateRole` / `parseDropUserOrRole` in
// `src/gql/parser.zig` (v0.5.15). The `SHOW ROLES` result emitted by
// `handleRoleList` in `src/execution/auth_dispatch.zig` is a single
// column `role_name` carrying the four built-in role names (admin,
// user, readwrite, readonly) plus any custom roles registered via
// `geode.auth.role_create`.
//
// Built-in role names are idempotent on CREATE -- upstream
// `handleRoleCreate` returns the status row "already exists: <name>
// (built-in)" with no error, so the handler surfaces a 200 (the
// inline ack is not currently bubbled to the client; ExecContext
// discards the result set). This is the documented Geode behaviour
// for the four reserved names: admin / user / readwrite / readonly.
//
// `WITH PERMISSIONS [...]` is NOT part of the v0.5.15 grammar. The
// pre-v0.5.15 emit that appended a permissions clause tripped a parse
// error upstream. Custom role permission membership is currently
// modelled per-graph via GRANT (see handlers_grants.go) -- a global
// per-role permission model is not yet upstream (Limitations #2).

// GetRoles implements GET /api/v1/roles (list roles).
//
// On Geode v0.5.15 the upstream `SHOW ROLES` result is a single column
// `role_name`. The handler also normalises the legacy `name` column
// emitted by older Geode builds so an upgrade is transparent. Each row
// is marshalled to a generic JSON object so the SPA can read whatever
// extra columns a future Geode release adds without a server change
// (Roles is `[]jsontext.Value` in the response schema).
func (s *GraphServer) GetRoles(w http.ResponseWriter, r *http.Request, _ *gentypes.Empty) (*gentypes.RoleList, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	rows, cols, err := runQuery(r.Context(), db, "SHOW ROLES")
	if err != nil {
		if isWireFeatureMissing(err) {
			return &gentypes.RoleList{Roles: []jsontext.Value{}}, nil
		}
		return nil, respondErr(w, wireErr(err))
	}
	// Normalise the v0.5.15 `role_name` column to the legacy `name`
	// key so downstream consumers that already read `name` keep
	// working. The raw column is also retained as `role_name` for any
	// SPA code that pins the upstream key directly.
	out := make([]jsontext.Value, 0, len(rows))
	for _, row := range rows {
		obj := rowToMap(cols, row)
		if _, hasName := obj["name"]; !hasName {
			if rn, ok := obj["role_name"]; ok {
				obj["name"] = rn
			}
		}
		raw, mErr := json.Marshal(obj)
		if mErr != nil {
			return nil, fmt.Errorf("marshal role row: %w", mErr)
		}
		out = append(out, jsontext.Value(raw))
	}
	return &gentypes.RoleList{Roles: out}, nil
}

// PostApiRoles implements POST /api/v1/roles (create role).
//
// Emits the v0.5.15 CREATE ROLE grammar:
//
//	CREATE ROLE <name> [ SET DESCRIPTION '<text>' ]
//
// Note the mandatory `SET` token before `DESCRIPTION` -- the
// pre-v0.5.15 emit (`CREATE ROLE <name> DESCRIPTION '<text>'`) tripped
// a parse error.
//
// Creating one of the four built-in role names (admin, user,
// readwrite, readonly) is idempotent: upstream `handleRoleCreate`
// returns the status row `"already exists: <name> (built-in)"` and
// does not error, so the handler surfaces a 200. The response Role
// echoes the requested name/description; the inline upstream note is
// not currently surfaced to the client (ExecContext discards the
// status row).
//
// `WITH PERMISSIONS [...]` is NOT in the v0.5.15 grammar. A request
// that carries a non-empty Permissions slice is rejected with 400
// invalid_permission rather than emitting an upstream-broken statement
// that would trip a 422 wire_feature_missing. Permission membership
// is modelled per-graph via GRANT (see handlers_grants.go).
//
//nolint:revive // var-naming: the method name is fixed by the genapi-generated ServerInterface.
func (s *GraphServer) PostApiRoles(w http.ResponseWriter, r *http.Request, req *gentypes.RoleCreateReq) (*gentypes.Role, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	rname, err := quoteIdent(req.Name)
	if err != nil {
		return nil, respondErr(w, badRequest(ErrCodeInvalidRole, err.Error()))
	}
	// v0.5.15 has no global per-role permission model. Reject before
	// emitting an upstream-broken `WITH PERMISSIONS` clause.
	if len(req.Permissions) > 0 {
		return nil, respondErr(w, badRequest(ErrCodeInvalidPermission,
			"role permissions are not modelled in Geode v0.5.15 grammar; use GRANT per-graph (see docs/GQL_AUTH_DDL.md Limitations #2)"))
	}
	stmt := "CREATE ROLE " + rname
	if req.Description != "" {
		desc, qErr := quoteString(req.Description)
		if qErr != nil {
			return nil, respondErr(w, badRequest(ErrCodeInvalidDescription, qErr.Error()))
		}
		stmt += " SET DESCRIPTION " + desc
	}
	if _, err := runStatement(r.Context(), db, stmt); err != nil {
		return nil, respondErr(w, wireErr(err))
	}
	emitAudit(auditEventRoleCreated,
		"user", userFromContext(r.Context()),
		"role", req.Name,
		"permissions", req.Permissions,
	)
	return &gentypes.Role{
		Name:        req.Name,
		Description: req.Description,
		Permissions: append([]string(nil), req.Permissions...),
	}, nil
}

// GetRole implements GET /api/v1/roles/{role}.
//
// v0.5.15 does not have a singular `SHOW ROLE <name>` form -- only
// plural `SHOW ROLES`. The handler runs `SHOW ROLES` and filters the
// result rows server-side by name. Upstream emits a single column
// `role_name` (legacy drivers may emit `name`); both keys are matched.
func (s *GraphServer) GetRole(w http.ResponseWriter, r *http.Request, req *gentypes.RoleParam) (*gentypes.Role, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	// Validate the identifier so a malformed `role` param surfaces a
	// 400 before any driver work runs. Quoted ident not needed for the
	// SHOW ROLES emit (we filter result rows in-process).
	if _, err := quoteIdent(req.Role); err != nil {
		return nil, respondErr(w, badRequest(ErrCodeInvalidRole, err.Error()))
	}
	rows, cols, err := runQuery(r.Context(), db, "SHOW ROLES")
	if err != nil {
		return nil, respondErr(w, wireErr(err))
	}
	nameCol := -1
	for i, c := range cols {
		if c == "role_name" || c == "name" || c == "role" {
			nameCol = i
			break
		}
	}
	if nameCol < 0 {
		return nil, respondErr(w, &endpointError{
			status:      http.StatusNotFound,
			code:        ErrCodeRoleNotFound,
			description: "role " + req.Role + " does not exist",
		})
	}
	for _, row := range rows {
		if nameCol >= len(row) {
			continue
		}
		if asStr(row[nameCol]) == req.Role {
			return roleFromRow(cols, row), nil
		}
	}
	return nil, respondErr(w, &endpointError{
		status:      http.StatusNotFound,
		code:        ErrCodeRoleNotFound,
		description: "role " + req.Role + " does not exist",
	})
}

// DeleteRole implements DELETE /api/v1/roles/{role}.
//
// Emits `DROP ROLE IF EXISTS <name>` per the v0.5.15 grammar. Upstream
// `handleRoleDelete` is structurally idempotent on missing roles (it
// uses fetchRemove which is a no-op on missing keys), so `IF EXISTS`
// is a safeguard against a future upstream tightening rather than a
// semantic change.
func (s *GraphServer) DeleteRole(w http.ResponseWriter, r *http.Request, req *gentypes.RoleParam) (*gentypes.Empty, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	rname, err := quoteIdent(req.Role)
	if err != nil {
		return nil, respondErr(w, badRequest(ErrCodeInvalidRole, err.Error()))
	}
	if _, err := runStatement(r.Context(), db, "DROP ROLE IF EXISTS "+rname); err != nil {
		return nil, respondErr(w, wireErr(err))
	}
	emitAudit(auditEventRoleDeleted,
		"user", userFromContext(r.Context()),
		"role", req.Role,
	)
	return &gentypes.Empty{}, nil
}

// roleFromRow projects a SHOW ROLES row onto the typed Role schema.
//
// Recognised columns:
//
//   - `role_name` (string, v0.5.15) -> Name
//   - `name` / `role` (string, legacy) -> Name
//   - `description` (string) -> Description
//   - `permissions` (list-shaped) -> Permissions
//
// Upstream `handleRoleList` (src/execution/auth_dispatch.zig @ v0.5.15)
// emits only `role_name`; `description` / `permissions` are returned
// as zero values until a future Geode release widens the catalog.
func roleFromRow(cols []string, row []any) *gentypes.Role {
	rl := &gentypes.Role{}
	for i, c := range cols {
		if i >= len(row) {
			break
		}
		switch c {
		case "role_name", "name", "role":
			rl.Name = asStr(row[i])
		case "description":
			rl.Description = asStr(row[i])
		case "permissions":
			rl.Permissions = asStrs(row[i])
		}
	}
	return rl
}
