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
// GQL admin syntax: as in handlers_users.go, Geode 0.3.8 does not yet
// accept the role DDL forms used here over the wire — `geode role *`
// CLI subcommands talk directly to the security graph data dir today.
// The handlers still emit forward-compatible syntax so the UI picks up
// the wire-level admin API as Geode grows it.

// GetRoles implements GET /api/v1/roles (list roles).
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
	out := make([]jsontext.Value, 0, len(rows))
	for _, row := range rows {
		obj := rowToMap(cols, row)
		raw, mErr := json.Marshal(obj)
		if mErr != nil {
			return nil, fmt.Errorf("marshal role row: %w", mErr)
		}
		out = append(out, jsontext.Value(raw))
	}
	return &gentypes.RoleList{Roles: out}, nil
}

// PostApiRoles implements POST /api/v1/roles (create role).
func (s *GraphServer) PostApiRoles(w http.ResponseWriter, r *http.Request, req *gentypes.RoleCreateReq) (*gentypes.Role, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	rname, err := quoteIdent(req.Name)
	if err != nil {
		return nil, respondErr(w, badRequest("invalid_role", err.Error()))
	}
	stmt := "CREATE ROLE " + rname
	if req.Description != "" {
		desc, qErr := quoteString(req.Description)
		if qErr != nil {
			return nil, respondErr(w, badRequest("invalid_description", qErr.Error()))
		}
		stmt += " DESCRIPTION " + desc
	}
	if len(req.Permissions) > 0 {
		permList, qErr := joinPermissions(req.Permissions)
		if qErr != nil {
			return nil, respondErr(w, badRequest("invalid_permission", qErr.Error()))
		}
		stmt += " WITH PERMISSIONS [" + permList + "]"
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
func (s *GraphServer) GetRole(w http.ResponseWriter, r *http.Request, req *gentypes.RoleParam) (*gentypes.Role, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	rname, err := quoteIdent(req.Role)
	if err != nil {
		return nil, respondErr(w, badRequest("invalid_role", err.Error()))
	}
	rows, cols, err := runQuery(r.Context(), db, "SHOW ROLE "+rname)
	if err != nil {
		return nil, respondErr(w, wireErr(err))
	}
	if len(rows) == 0 {
		return nil, respondErr(w, &endpointError{
			status:      http.StatusNotFound,
			code:        "role_not_found",
			description: "role " + req.Role + " does not exist",
		})
	}
	return roleFromRow(cols, rows[0]), nil
}

// DeleteRole implements DELETE /api/v1/roles/{role}.
func (s *GraphServer) DeleteRole(w http.ResponseWriter, r *http.Request, req *gentypes.RoleParam) (*gentypes.Empty, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	rname, err := quoteIdent(req.Role)
	if err != nil {
		return nil, respondErr(w, badRequest("invalid_role", err.Error()))
	}
	if _, err := runStatement(r.Context(), db, "DROP ROLE "+rname); err != nil {
		return nil, respondErr(w, wireErr(err))
	}
	emitAudit(auditEventRoleDeleted,
		"user", userFromContext(r.Context()),
		"role", req.Role,
	)
	return &gentypes.Empty{}, nil
}

// joinPermissions quote-wraps each permission as a backtick identifier
// (matching the GQL convention where keyword-shaped permission names
// are inlined as identifiers). Returns the joined list (without
// surrounding brackets) so callers can decide whether to wrap.
func joinPermissions(perms []string) (string, error) {
	out := ""
	for i, p := range perms {
		q, err := quoteIdent(p)
		if err != nil {
			return "", err
		}
		if i > 0 {
			out += ", "
		}
		out += q
	}
	return out, nil
}

// roleFromRow projects a SHOW ROLE row onto the typed Role schema. The
// driver returns whatever column shape the security graph emits — we
// pick up `name`, `description`, and `permissions` if present and fall
// back to zero values for the rest.
func roleFromRow(cols []string, row []any) *gentypes.Role {
	rl := &gentypes.Role{}
	for i, c := range cols {
		if i >= len(row) {
			break
		}
		switch c {
		case "name", "role":
			rl.Name = asStr(row[i])
		case "description":
			rl.Description = asStr(row[i])
		case "permissions":
			rl.Permissions = asStrs(row[i])
		}
	}
	return rl
}
