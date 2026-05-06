package server

import (
	"context"
	"database/sql"
	"encoding/json/v2"
	"errors"
	"fmt"
	"net/http"

	"encoding/json/jsontext"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// User-management handlers — admin endpoints under /api/v1/users.
//
// The genapi-emitted method names in this surface are:
//
//   GetUsers       → GET    /api/v1/users
//   PostUsers      → POST   /api/v1/users
//   GetUsername    → GET    /api/v1/users/{username}
//   PatchUsername  → PATCH  /api/v1/users/{username}
//   DeleteUsername → DELETE /api/v1/users/{username}
//   Disable        → POST   /api/v1/users/{username}/disable
//   Enable         → POST   /api/v1/users/{username}/enable
//   Password       → POST   /api/v1/users/{username}/password
//   Roles          → POST   /api/v1/users/{username}/roles
//   Permissions    → GET    /api/v1/users/{username}/permissions
//
// Naming: genapi derives the method name from the terminal path segment
// and disambiguates collisions ({"users"} → GetUsers/PostUsers; {username}
// → GetUsername/PatchUsername/DeleteUsername).
//
// Every required_roles=["admin"] route is gated by JWT-claim role
// enforcement in the generated wrapper before reaching the handler. The
// JWT verifier itself is still stubbed (B9 will land it). Until then the
// admin gate effectively rejects every request with 401 (no Bearer token)
// — the handlers below are exercised only via the unit-test path that
// calls them directly.
//
// GQL admin syntax: Geode 0.3.8 only supports `ALTER USER <name> SET
// PASSWORD '<pw>'` over the wire (verified with a live server during B4).
// The other admin DDL forms used here (`CREATE USER`, `DROP USER`,
// `SHOW USERS`, `GRANT ROLE`, etc.) parse-error in 0.3.8 — `geode user *`
// CLI subcommands talk directly to the security graph data dir today.
// The handlers still emit those statements so that as Geode grows the
// admin DDL surface, the UI picks them up without code changes; the
// quoting helpers in util.go make sure the string-concatenated
// statements stay injection-safe.

// GetUsers implements GET /api/v1/users (list users).
func (s *GraphServer) GetUsers(w http.ResponseWriter, r *http.Request, _ *gentypes.Empty) (*gentypes.UserList, error) {
	db, err := s.userDB(r.Context())
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	rows, cols, err := runQuery(r.Context(), db, "SHOW USERS")
	if err != nil {
		return nil, userResponseErr(w, userErr(err))
	}
	out := make([]jsontext.Value, 0, len(rows))
	for _, row := range rows {
		obj := userRowToMap(cols, row)
		raw, mErr := json.Marshal(obj)
		if mErr != nil {
			return nil, fmt.Errorf("marshal user row: %w", mErr)
		}
		out = append(out, jsontext.Value(raw))
	}
	return &gentypes.UserList{Users: out}, nil
}

// PostUsers implements POST /api/v1/users (create user).
func (s *GraphServer) PostUsers(w http.ResponseWriter, r *http.Request, req *gentypes.UserCreateReq) (*gentypes.User, error) {
	db, err := s.userDB(r.Context())
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	uname, err := quoteIdent(req.Username)
	if err != nil {
		return nil, userResponseErr(w, badRequest("invalid_username", err.Error()))
	}
	email, err := quoteString(req.Email)
	if err != nil {
		return nil, userResponseErr(w, badRequest("invalid_email", err.Error()))
	}
	stmt := "CREATE USER " + uname + " WITH EMAIL " + email
	if req.Password != "" {
		pw, err := quoteString(req.Password)
		if err != nil {
			return nil, userResponseErr(w, badRequest("invalid_password", err.Error()))
		}
		stmt += " PASSWORD " + pw
	}
	if _, err := runStatement(r.Context(), db, stmt); err != nil {
		return nil, userResponseErr(w, userErr(err))
	}
	for _, role := range req.Roles {
		if err := assignRole(r.Context(), db, uname, role); err != nil {
			return nil, userResponseErr(w, err)
		}
	}
	return &gentypes.User{Username: req.Username, Email: req.Email, Roles: append([]string(nil), req.Roles...)}, nil
}

// GetUsername implements GET /api/v1/users/{username}.
func (s *GraphServer) GetUsername(w http.ResponseWriter, r *http.Request, req *gentypes.UsernameParam) (*gentypes.User, error) {
	db, err := s.userDB(r.Context())
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	uname, err := quoteIdent(req.Username)
	if err != nil {
		return nil, userResponseErr(w, badRequest("invalid_username", err.Error()))
	}
	rows, cols, err := runQuery(r.Context(), db, "SHOW USER "+uname)
	if err != nil {
		return nil, userResponseErr(w, userErr(err))
	}
	if len(rows) == 0 {
		return nil, userResponseErr(w, &endpointError{
			status:      http.StatusNotFound,
			code:        "user_not_found",
			description: "user " + req.Username + " does not exist",
		})
	}
	return userFromRow(cols, rows[0]), nil
}

// PatchUsername implements PATCH /api/v1/users/{username}.
func (s *GraphServer) PatchUsername(w http.ResponseWriter, r *http.Request, req *gentypes.UserUpdateReq) (*gentypes.User, error) {
	db, err := s.userDB(r.Context())
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	uname, err := quoteIdent(req.Username)
	if err != nil {
		return nil, userResponseErr(w, badRequest("invalid_username", err.Error()))
	}
	if req.Email != "" {
		email, qErr := quoteString(req.Email)
		if qErr != nil {
			return nil, userResponseErr(w, badRequest("invalid_email", qErr.Error()))
		}
		if _, err := runStatement(r.Context(), db, "ALTER USER "+uname+" SET EMAIL "+email); err != nil {
			return nil, userResponseErr(w, userErr(err))
		}
	}
	if req.Password != "" {
		pw, qErr := quoteString(req.Password)
		if qErr != nil {
			return nil, userResponseErr(w, badRequest("invalid_password", qErr.Error()))
		}
		if _, err := runStatement(r.Context(), db, "ALTER USER "+uname+" SET PASSWORD "+pw); err != nil {
			return nil, userResponseErr(w, userErr(err))
		}
	}
	for _, role := range req.Roles {
		if err := assignRole(r.Context(), db, uname, role); err != nil {
			return nil, userResponseErr(w, err)
		}
	}
	return &gentypes.User{Username: req.Username, Email: req.Email, Roles: append([]string(nil), req.Roles...)}, nil
}

// DeleteUsername implements DELETE /api/v1/users/{username}.
func (s *GraphServer) DeleteUsername(w http.ResponseWriter, r *http.Request, req *gentypes.UsernameParam) (*gentypes.Empty, error) {
	db, err := s.userDB(r.Context())
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	uname, err := quoteIdent(req.Username)
	if err != nil {
		return nil, userResponseErr(w, badRequest("invalid_username", err.Error()))
	}
	if _, err := runStatement(r.Context(), db, "DROP USER "+uname); err != nil {
		return nil, userResponseErr(w, userErr(err))
	}
	return &gentypes.Empty{}, nil
}

// Disable implements POST /api/v1/users/{username}/disable.
func (s *GraphServer) Disable(w http.ResponseWriter, r *http.Request, req *gentypes.UsernameParam) (*gentypes.Empty, error) {
	return s.toggleUser(w, r.Context(), req.Username, "DISABLE")
}

// Enable implements POST /api/v1/users/{username}/enable.
func (s *GraphServer) Enable(w http.ResponseWriter, r *http.Request, req *gentypes.UsernameParam) (*gentypes.Empty, error) {
	return s.toggleUser(w, r.Context(), req.Username, "ENABLE")
}

// Password implements POST /api/v1/users/{username}/password.
func (s *GraphServer) Password(w http.ResponseWriter, r *http.Request, req *gentypes.PasswordChangeReq) (*gentypes.Empty, error) {
	db, err := s.userDB(r.Context())
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	uname, err := quoteIdent(req.Username)
	if err != nil {
		return nil, userResponseErr(w, badRequest("invalid_username", err.Error()))
	}
	pw, err := quoteString(req.NewPassword)
	if err != nil {
		return nil, userResponseErr(w, badRequest("invalid_password", err.Error()))
	}
	if _, err := runStatement(r.Context(), db, "ALTER USER "+uname+" SET PASSWORD "+pw); err != nil {
		return nil, userResponseErr(w, userErr(err))
	}
	return &gentypes.Empty{}, nil
}

// Roles implements POST /api/v1/users/{username}/roles (assign a role).
// The JSON body's username must match the path username — the wrapper
// already overwrites req.Username with the path value, so the body field
// is effectively ignored.
func (s *GraphServer) Roles(w http.ResponseWriter, r *http.Request, req *gentypes.AssignRoleReq) (*gentypes.Empty, error) {
	db, err := s.userDB(r.Context())
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	uname, err := quoteIdent(req.Username)
	if err != nil {
		return nil, userResponseErr(w, badRequest("invalid_username", err.Error()))
	}
	if err := assignRole(r.Context(), db, uname, req.Role); err != nil {
		return nil, userResponseErr(w, err)
	}
	return &gentypes.Empty{}, nil
}

// Permissions implements GET /api/v1/users/{username}/permissions.
func (s *GraphServer) Permissions(w http.ResponseWriter, r *http.Request, req *gentypes.UsernameParam) (*gentypes.PermissionList, error) {
	db, err := s.userDB(r.Context())
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	uname, err := quoteIdent(req.Username)
	if err != nil {
		return nil, userResponseErr(w, badRequest("invalid_username", err.Error()))
	}
	rows, cols, err := runQuery(r.Context(), db, "SHOW PERMISSIONS FOR USER "+uname)
	if err != nil {
		return nil, userResponseErr(w, userErr(err))
	}
	out := make([]jsontext.Value, 0, len(rows))
	for _, row := range rows {
		obj := make(map[string]any, len(cols))
		for i, c := range cols {
			if i < len(row) {
				obj[c] = row[i]
			}
		}
		raw, mErr := json.Marshal(obj)
		if mErr != nil {
			return nil, fmt.Errorf("marshal permission row: %w", mErr)
		}
		out = append(out, jsontext.Value(raw))
	}
	return &gentypes.PermissionList{Permissions: out}, nil
}

// toggleUser is the shared body of Disable/Enable. action is "DISABLE"
// or "ENABLE" — the literal verb embedded into the GQL statement.
func (s *GraphServer) toggleUser(w http.ResponseWriter, ctx context.Context, username, action string) (*gentypes.Empty, error) {
	db, err := s.userDB(ctx)
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	uname, err := quoteIdent(username)
	if err != nil {
		return nil, userResponseErr(w, badRequest("invalid_username", err.Error()))
	}
	if _, err := runStatement(ctx, db, "ALTER USER "+uname+" "+action); err != nil {
		return nil, userResponseErr(w, userErr(err))
	}
	return &gentypes.Empty{}, nil
}

// assignRole runs `GRANT ROLE <role> TO USER <uname>`. uname MUST be
// pre-quoted by the caller via quoteIdent — assignRole only quotes the
// role name. The caller pre-quotes so duplicate quoting is avoided when
// PostUsers/PatchUsername loop over a slice of roles for one user.
func assignRole(ctx context.Context, db *sql.DB, uname, role string) error {
	roleIdent, err := quoteIdent(role)
	if err != nil {
		return badRequest("invalid_role", err.Error())
	}
	if _, err := runStatement(ctx, db, "GRANT ROLE "+roleIdent+" TO USER "+uname); err != nil {
		return userErr(err)
	}
	return nil
}

// userDB resolves the *sql.DB for the current connection profile.
func (s *GraphServer) userDB(ctx context.Context) (*sql.DB, error) {
	if s.cfg.Pool == nil {
		return nil, errors.New("server: pool not configured")
	}
	db, err := s.cfg.Pool.DB(profileFromContextOrDefault(ctx))
	if err != nil {
		return nil, &endpointError{
			status:      http.StatusBadGateway,
			code:        "profile_unreachable",
			description: err.Error(),
		}
	}
	return db, nil
}

// userResponseErr is the user-handlers analogue of schemaResponseErr —
// inline-writes endpoint errors and returns nil so the wrapper does not
// emit a second body, and passes through non-endpoint errors as-is so
// they surface as 500.
func userResponseErr(w http.ResponseWriter, err error) error {
	if ep := asEndpointError(err); ep != nil {
		writeEndpointError(w, ep)
		return nil
	}
	return err
}

// userErr wraps a driver-level error from a user-management statement
// as a 422 endpointError with code=user_admin_error so the client gets a
// stable code distinct from auth/transport failures.
func userErr(err error) error {
	if err == nil {
		return nil
	}
	return &endpointError{
		status:      http.StatusUnprocessableEntity,
		code:        "user_admin_error",
		description: err.Error(),
	}
}

// badRequest is a small helper for 400 endpointErrors emitted from
// validation failures inside the user handlers.
func badRequest(code, desc string) error {
	return &endpointError{status: http.StatusBadRequest, code: code, description: desc}
}

// userRowToMap turns a driver row into a plain map[string]any keyed by
// column name. Used for SHOW USERS where the row shape is open and the
// UI consumes whatever columns Geode emits today.
func userRowToMap(cols []string, row []any) map[string]any {
	obj := make(map[string]any, len(cols))
	for i, c := range cols {
		if i < len(row) {
			obj[c] = row[i]
		}
	}
	return obj
}

// userFromRow projects a driver row onto the typed User schema. Columns
// the driver does not emit are left at the zero value, matching the
// schema's optional-field semantics.
func userFromRow(cols []string, row []any) *gentypes.User {
	u := &gentypes.User{}
	for i, c := range cols {
		if i >= len(row) {
			break
		}
		switch c {
		case "username", "name":
			u.Username = asStr(row[i])
		case "email":
			u.Email = asStr(row[i])
		case "roles":
			u.Roles = asStrs(row[i])
		case "disabled":
			u.Disabled = asBool(row[i])
		case "mfa_enrolled":
			u.MfaEnrolled = asBool(row[i])
		}
	}
	return u
}
