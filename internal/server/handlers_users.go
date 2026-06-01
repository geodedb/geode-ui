package server

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"sync"

	geode "geodedb.com/geode"
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
// enforcement in the generated wrapper before reaching the handler.
// The JWT verifier is implemented at internal/server/auth.go:40
// (`AuthJWT`) and exercised across protected handlers in
// internal/server/auth_test.go (cookie + bearer + query-string
// fallback paths). The header-mediated re-parse in the genapi
// wrapper enforces required_roles before this file's handlers run.
//
// GQL admin syntax (Geode v0.5.15+). Upstream parser is
// `src/gql/parser.zig` and the execution path is
// `src/execution/admin_ddl.zig`; both at tag v0.5.15. The handlers
// below emit:
//
//	CREATE USER <name> SET PASSWORD '<pw>' [ EMAIL '<email>' ] [ ROLE <role> ]
//	ALTER  USER <name> SET PASSWORD '<pw>'
//	ALTER  USER <name> SET ROLE <role>
//	ALTER  USER <name> ENABLE | DISABLE
//	DROP   USER [ IF EXISTS ] <name>
//	GRANT  ROLE <role> TO <user>
//	SHOW   USERS
//	SHOW   PERMISSIONS [ FOR <user> ]
//
// Notes on divergence from older geode-ui forms:
//
//   - `CREATE USER ... WITH EMAIL ...` (pre-v0.5.15 emit) was never
//     accepted upstream; the canonical grammar uses `SET PASSWORD`
//     followed by optional `EMAIL` and `ROLE` clauses.
//   - `GRANT ROLE <role> TO USER <user>` (pre-v0.5.15 emit) tripped a
//     parse error -- the v0.5.15 grammar uses bare `TO <user>`.
//   - `SHOW PERMISSIONS FOR USER <user>` (pre-v0.5.15 emit) similarly
//     tripped a parse error -- v0.5.15 expects bare `FOR <user>`.
//   - `ALTER USER ... SET EMAIL ...` is NOT in v0.5.15. The
//     PatchUsername handler still emits it for forward-compat with a
//     future Geode release; on v0.5.15 the email update returns
//     wire_feature_missing through the standard fallback. Tracked for
//     follow-up against the next Geode release.
//   - `SHOW USER <name>` (singular) is NOT in v0.5.15. GetUsername now
//     runs `SHOW USERS` and filters the result rows server-side to
//     surface the requested user, since the upstream parser only
//     accepts plural `SHOW USERS`.
//
// Quoting: all caller-supplied identifiers go through `quoteIdent` and
// all string literals through `quoteString` (internal/server/quoting.go).
// Direct `fmt.Sprintf` of untrusted input into a GQL statement is a
// known injection sink and is not permitted.

// GetUsers implements GET /api/v1/users (list users).
//
// GAP-Q8 (#38): the response is now the typed `[]gentypes.User`
// (UserList.users is `array<User>` in geode.json) instead of
// `[]jsontext.Value`. The underlying `SHOW USERS` columns are
// runtime-discovered, so each driver row is funnelled through
// userFromRow, which projects the columns geode-ui knows about
// (username/name, email, roles, disabled, mfa_enrolled) onto the
// typed struct and drops unknowns (with a one-line drift warning so a
// future Geode column addition is visible in logs without a wire-shape
// regression).
func (s *GraphServer) GetUsers(w http.ResponseWriter, r *http.Request, _ *gentypes.Empty) (*gentypes.UserList, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	rows, cols, err := runQuery(r.Context(), db, "SHOW USERS")
	if err != nil {
		if isWireFeatureMissing(err) {
			return &gentypes.UserList{Users: []gentypes.User{}}, nil
		}
		return nil, respondErr(w, wireErr(err))
	}
	out := make([]gentypes.User, 0, len(rows))
	for _, row := range rows {
		out = append(out, *userFromRow(cols, row))
	}
	return &gentypes.UserList{Users: out}, nil
}

// PostUsers implements POST /api/v1/users (create user).
//
// Emits the v0.5.15 CREATE USER grammar:
//
//	CREATE USER <name> SET PASSWORD '<pw>' [ EMAIL '<email>' ] [ ROLE <role> ]
//
// Password is REQUIRED -- v0.5.15's `parseCreateUser` expects `SET
// PASSWORD '<pw>'` immediately after the username. A request without a
// password is rejected with 400 invalid_password before any driver work
// runs (rather than letting the parse error surface as 422 wire_feature_missing).
//
// If the request carries one or more roles, the FIRST role is inlined
// via the `ROLE <name>` clause so the user is created with its built-in
// role atomically. Any additional roles run through `assignRole` after
// CREATE USER returns. Upstream `user_assign_role` is idempotent on
// re-assigning the current role -- no version bump and no audit row --
// so emitting the post-create GRANT ROLE keeps the audit trail visible
// to clients that key on the wire trace.
func (s *GraphServer) PostUsers(w http.ResponseWriter, r *http.Request, req *gentypes.UserCreateReq) (*gentypes.User, error) {
	var resp *gentypes.User
	err := s.withConnDBAndIdent(r.Context(), req.Username, func(db *sql.DB, uname string) error {
		// Password is mandatory on v0.5.15. Reject early with a 400 so
		// the client gets a clear actionable error rather than a 422
		// wire_feature_missing after the parse failure.
		if req.Password == "" {
			return badRequest(ErrCodeInvalidPassword, "password is required for CREATE USER (Geode v0.5.15 grammar)")
		}
		// GAP-N4 (#72): enforce server-side password policy before the
		// value reaches the wire. Returns a stable 400 shape
		// (`password_too_short` / `password_too_weak` / etc.) so clients
		// can branch on the reason.
		if vErr := validatePassword(r.Context(), req.Password, req.Username, s.cfg.PasswordPolicy); vErr != nil {
			return passwordPolicyEndpointError(vErr)
		}
		pw, pErr := geode.QuoteString(req.Password)
		if pErr != nil {
			return badRequest(ErrCodeInvalidPassword, pErr.Error())
		}
		stmt := "CREATE USER " + uname + " SET PASSWORD " + pw
		if req.Email != "" {
			email, qErr := geode.QuoteString(req.Email)
			if qErr != nil {
				return badRequest(ErrCodeInvalidEmail, qErr.Error())
			}
			stmt += " EMAIL " + email
		}
		// Inline the first role so the user is created with its
		// built-in role atomically. Remaining roles are GRANTed after
		// CREATE USER so the audit trail is unchanged.
		inlineRole := ""
		if len(req.Roles) > 0 {
			roleIdent, rErr := geode.QuoteIdent(req.Roles[0])
			if rErr != nil {
				return badRequest(ErrCodeInvalidRole, rErr.Error())
			}
			stmt += " ROLE " + roleIdent
			inlineRole = req.Roles[0]
		}
		if _, err := runStatement(r.Context(), db, stmt); err != nil {
			return wireErr(err)
		}
		for _, role := range req.Roles {
			_ = inlineRole // already inlined; user_assign_role is idempotent.
			if err := assignRole(r.Context(), db, uname, role); err != nil {
				return err
			}
		}
		emitAudit(auditEventUserCreated,
			"user", userFromContext(r.Context()),
			"target", req.Username,
			"roles", req.Roles,
		)
		resp = &gentypes.User{Username: req.Username, Email: req.Email, Roles: append([]string(nil), req.Roles...)}
		return nil
	})
	if err != nil {
		return nil, respondErr(w, err)
	}
	return resp, nil
}

// GetUsername implements GET /api/v1/users/{username}.
//
// v0.5.15 does not have a singular `SHOW USER <name>` form -- only
// plural `SHOW USERS`. The handler runs `SHOW USERS` and filters the
// result rows server-side by username (the upstream column is
// `username`; older drivers may emit `name`). Cost is O(n) in the
// user count which is acceptable -- a Geode instance is not expected
// to host millions of admin users, and the alternative (a per-name
// catalog query) is not in the v0.5.15 grammar.
func (s *GraphServer) GetUsername(w http.ResponseWriter, r *http.Request, req *gentypes.UsernameParam) (*gentypes.User, error) {
	var resp *gentypes.User
	err := s.withConnDBAndIdent(r.Context(), req.Username, func(db *sql.DB, _ string) error {
		rows, cols, qErr := runQuery(r.Context(), db, "SHOW USERS")
		if qErr != nil {
			return wireErr(qErr)
		}
		// Locate the column index that names the user. v0.5.15 emits
		// `username`; legacy drivers may emit `name`.
		nameCol := -1
		for i, c := range cols {
			if c == "username" || c == "name" {
				nameCol = i
				break
			}
		}
		if nameCol < 0 {
			// No way to filter -> treat as not found rather than
			// silently returning the first row.
			return &endpointError{
				status:      http.StatusNotFound,
				code:        ErrCodeUserNotFound,
				description: "user " + req.Username + " does not exist",
			}
		}
		for _, row := range rows {
			if nameCol >= len(row) {
				continue
			}
			if asStr(row[nameCol]) == req.Username {
				resp = userFromRow(cols, row)
				return nil
			}
		}
		return &endpointError{
			status:      http.StatusNotFound,
			code:        ErrCodeUserNotFound,
			description: "user " + req.Username + " does not exist",
		}
	})
	if err != nil {
		return nil, respondErr(w, err)
	}
	return resp, nil
}

// PatchUsername implements PATCH /api/v1/users/{username}.
//
// Q3 / issue #32: every sub-update (email, password, roles) is funnelled
// through one BeginTx/Commit envelope so a partial failure cannot leave
// the user with, say, the new email but the old password. On any
// sub-statement error the transaction is rolled back before the
// endpoint error reaches the client.
//
// If the patch carries no fields, no transaction is opened -- avoiding
// a wasted BEGIN/COMMIT round-trip for clients that PATCH with an
// empty body. quoteIdent runs unconditionally so a malformed username
// is rejected with 400 before any driver work.
func (s *GraphServer) PatchUsername(w http.ResponseWriter, r *http.Request, req *gentypes.UserUpdateReq) (*gentypes.User, error) {
	var resp *gentypes.User
	err := s.withConnDBAndIdent(r.Context(), req.Username, func(db *sql.DB, uname string) error {
		// Pre-validate every quoted literal before opening the tx so a 400
		// from a bad input does not leave a dangling open transaction.
		var email string
		if req.Email != "" {
			var qErr error
			email, qErr = geode.QuoteString(req.Email)
			if qErr != nil {
				return badRequest(ErrCodeInvalidEmail, qErr.Error())
			}
		}
		var pw string
		if req.Password != "" {
			// GAP-N4 (#72): same server-side policy gate as PostUsers.
			if vErr := validatePassword(r.Context(), req.Password, req.Username, s.cfg.PasswordPolicy); vErr != nil {
				return passwordPolicyEndpointError(vErr)
			}
			var qErr error
			pw, qErr = geode.QuoteString(req.Password)
			if qErr != nil {
				return badRequest(ErrCodeInvalidPassword, qErr.Error())
			}
		}

		// GAP-031 / #208: an empty PATCH (no email, no password, no
		// roles) used to return 200 with a synthesised User echo of
		// the URL params. That misrepresented persisted state and
		// hid client-side bugs (a PATCH that meant to change nothing
		// was indistinguishable on the wire from one that meant to
		// change something but lost its body). 400 with the
		// `empty_patch` code surfaces the no-op explicitly to the
		// caller.
		if email == "" && pw == "" && len(req.Roles) == 0 {
			return badRequest(ErrCodeEmptyPatch,
				"PATCH request body must change at least one of email, password, or roles")
		}

		tx, txErr := db.BeginTx(r.Context(), nil)
		if txErr != nil {
			return wireErr(txErr)
		}
		// rollbackErr lets us surface the original failure even when the
		// driver's Rollback returns a non-nil error of its own. The handler
		// always prefers the original sub-statement error in the response.
		commit := false
		defer func() {
			if !commit {
				_ = tx.Rollback()
			}
		}()

		if email != "" {
			if _, execErr := tx.ExecContext(r.Context(), "ALTER USER "+uname+" SET EMAIL "+email); execErr != nil {
				return wireErr(execErr)
			}
		}
		if pw != "" {
			if _, execErr := tx.ExecContext(r.Context(), "ALTER USER "+uname+" SET PASSWORD "+pw); execErr != nil {
				return wireErr(execErr)
			}
		}
		for _, role := range req.Roles {
			roleIdent, qErr := geode.QuoteIdent(role)
			if qErr != nil {
				return badRequest(ErrCodeInvalidRole, qErr.Error())
			}
			// v0.5.15: `GRANT ROLE <role> TO <user>` -- no USER
			// keyword (see file-level grammar note).
			if _, execErr := tx.ExecContext(r.Context(), "GRANT ROLE "+roleIdent+" TO "+uname); execErr != nil {
				return wireErr(execErr)
			}
		}

		if cErr := tx.Commit(); cErr != nil {
			return wireErr(cErr)
		}
		commit = true

		// SEC-N2 (#64): a password change invalidates every existing
		// session for that user — revoke all of the target's currently-
		// valid tokens (iat-based per-user revoke). A new login with the
		// new password mints a token with a later iat and is unaffected.
		if pw != "" && s.cfg.JWT != nil {
			s.cfg.JWT.Revocation().RevokeUser(req.Username)
		}

		resp = &gentypes.User{Username: req.Username, Email: req.Email, Roles: append([]string(nil), req.Roles...)}
		return nil
	})
	if err != nil {
		return nil, respondErr(w, err)
	}
	return resp, nil
}

// DeleteUsername implements DELETE /api/v1/users/{username}.
//
// Emits `DROP USER IF EXISTS <name>` per the v0.5.15 grammar. Upstream
// `handleUserDelete` already degrades gracefully on a missing user --
// it logs and returns "deleted <name>" -- so `IF EXISTS` is structurally
// a no-op safeguard today (see Limitations #6). Emitting it anyway
// keeps the parse surface idempotent and shields the SPA from a future
// upstream tightening that elevates "user not found" to a 422.
func (s *GraphServer) DeleteUsername(w http.ResponseWriter, r *http.Request, req *gentypes.UsernameParam) (*gentypes.Empty, error) {
	err := s.withConnDBAndIdent(r.Context(), req.Username, func(db *sql.DB, uname string) error {
		if _, err := runStatement(r.Context(), db, "DROP USER IF EXISTS "+uname); err != nil {
			return wireErr(err)
		}
		emitAudit(auditEventUserDeleted,
			"user", userFromContext(r.Context()),
			"target", req.Username,
		)
		return nil
	})
	if err != nil {
		return nil, respondErr(w, err)
	}
	return &gentypes.Empty{}, nil
}

// Disable implements POST /api/v1/users/{username}/disable.
func (s *GraphServer) Disable(w http.ResponseWriter, r *http.Request, req *gentypes.UsernameParam) (*gentypes.Empty, error) {
	resp, err := s.toggleUser(w, r.Context(), req.Username, "DISABLE")
	if err == nil && resp != nil {
		emitAudit(auditEventUserDisabled,
			"user", userFromContext(r.Context()),
			"target", req.Username,
		)
	}
	return resp, err
}

// Enable implements POST /api/v1/users/{username}/enable.
func (s *GraphServer) Enable(w http.ResponseWriter, r *http.Request, req *gentypes.UsernameParam) (*gentypes.Empty, error) {
	resp, err := s.toggleUser(w, r.Context(), req.Username, "ENABLE")
	if err == nil && resp != nil {
		emitAudit(auditEventUserEnabled,
			"user", userFromContext(r.Context()),
			"target", req.Username,
		)
	}
	return resp, err
}

// Password implements POST /api/v1/users/{username}/password.
//
// SEC A1 (2026-05-21 audit / CWE-639 BOLA): this route is JWT-gated
// but intentionally lacks `required_roles:["admin"]` so a user can
// change their OWN password. Defense-in-depth on upstream Geode RBAC
// requires that a NON-admin caller's JWT subject match the path
// username exactly (strict equality — the same string that AuthJWT
// pulled from the `sub` claim and that the path bind already wrote
// into req.Username). Mismatch returns 403 and emits a
// `user_password_forbidden` audit row before any wire-level ALTER
// USER runs. Admins (role "admin") bypass the equality check.
func (s *GraphServer) Password(w http.ResponseWriter, r *http.Request, req *gentypes.PasswordChangeReq) (*gentypes.Empty, error) {
	actr := actorFromContext(r.Context())
	if !hasRole(actr.Roles, "admin") && actr.Subject != req.Username {
		emitAudit(auditEventUserPasswordForbidden,
			"user", actr.Subject,
			"target", req.Username,
		)
		return nil, respondErr(w, &endpointError{
			status:      http.StatusForbidden,
			code:        ErrCodeForbidden,
			description: "password change requires admin role or self",
		})
	}
	err := s.withConnDBAndIdent(r.Context(), req.Username, func(db *sql.DB, uname string) error {
		// GAP-N4 (#72): server-side password policy. NewPassword must
		// satisfy length, weak-pattern, username-collision and (when
		// enabled) HIBP rules before the wire-level ALTER USER runs.
		if vErr := validatePassword(r.Context(), req.NewPassword, req.Username, s.cfg.PasswordPolicy); vErr != nil {
			return passwordPolicyEndpointError(vErr)
		}
		pw, qErr := geode.QuoteString(req.NewPassword)
		if qErr != nil {
			return badRequest(ErrCodeInvalidPassword, qErr.Error())
		}
		if _, err := runStatement(r.Context(), db, "ALTER USER "+uname+" SET PASSWORD "+pw); err != nil {
			return wireErr(err)
		}
		// SEC-N2 (#64): invalidate every existing session for this user —
		// a password change must not leave old tokens valid. A subsequent
		// login with the new password mints a token with a later iat and
		// is unaffected by the per-user revoke.
		if s.cfg.JWT != nil {
			s.cfg.JWT.Revocation().RevokeUser(req.Username)
		}
		// Note: never log the password value itself; sensitiveKeys would
		// redact it anyway but we omit it entirely to leave no trace.
		emitAudit(auditEventUserPasswordSet,
			"user", userFromContext(r.Context()),
			"target", req.Username,
		)
		return nil
	})
	if err != nil {
		return nil, respondErr(w, err)
	}
	return &gentypes.Empty{}, nil
}

// PostUsernameRoles implements POST /api/v1/users/{username}/roles
// (assign a role). The JSON body's username must match the path username
// — the wrapper already overwrites req.Username with the path value, so
// the body field is effectively ignored.
//
// Naming: the genapi disambiguator collapses POST /users/{username}/roles
// onto PostUsernameRoles (the URI-prefix fallback because both the
// terminal segment `roles` and `Roles` collide with /api/v1/roles).
func (s *GraphServer) PostUsernameRoles(w http.ResponseWriter, r *http.Request, req *gentypes.AssignRoleReq) (*gentypes.Empty, error) {
	err := s.withConnDBAndIdent(r.Context(), req.Username, func(db *sql.DB, uname string) error {
		if err := assignRole(r.Context(), db, uname, req.Role); err != nil {
			return err
		}
		emitAudit(auditEventRoleAssigned,
			"user", userFromContext(r.Context()),
			"target", req.Username,
			"role", req.Role,
		)
		return nil
	})
	if err != nil {
		return nil, respondErr(w, err)
	}
	return &gentypes.Empty{}, nil
}

// Permissions implements GET /api/v1/users/{username}/permissions.
//
// GAP-Q8 (#38): returns the typed `[]gentypes.Permission` (the
// PermissionList.permissions schema is `array<Permission>`) projected
// from the runtime-discovered `SHOW PERMISSIONS FOR` columns via
// permissionFromRow (known columns: permission, resource, scope;
// unknowns dropped with a drift warning).
//
// v0.5.15 grammar: `SHOW PERMISSIONS [ FOR <user> ]` -- bare `FOR
// <user>`, no `USER` keyword. Upstream `parseShowStatement` in
// `src/gql/parser.zig` (v0.5.15) consumes only the user name after
// `FOR`. Admin gate is enforced upstream by `handleUserPermissions`:
// SHOW PERMISSIONS FOR a non-self user requires the caller to have the
// admin role -- the geode-ui side relies on the genapi
// `required_roles:["admin"]` route gate for the same check.
func (s *GraphServer) Permissions(w http.ResponseWriter, r *http.Request, req *gentypes.UsernameParam) (*gentypes.PermissionList, error) {
	var resp *gentypes.PermissionList
	err := s.withConnDBAndIdent(r.Context(), req.Username, func(db *sql.DB, uname string) error {
		rows, cols, qErr := runQuery(r.Context(), db, "SHOW PERMISSIONS FOR "+uname)
		if qErr != nil {
			return wireErr(qErr)
		}
		out := make([]gentypes.Permission, 0, len(rows))
		for _, row := range rows {
			out = append(out, permissionFromRow(cols, row))
		}
		resp = &gentypes.PermissionList{Permissions: out}
		return nil
	})
	if err != nil {
		return nil, respondErr(w, err)
	}
	return resp, nil
}

// toggleUser is the shared body of Disable/Enable. action is "DISABLE"
// or "ENABLE" — the literal verb embedded into the GQL statement.
func (s *GraphServer) toggleUser(w http.ResponseWriter, ctx context.Context, username, action string) (*gentypes.Empty, error) {
	err := s.withConnDBAndIdent(ctx, username, func(db *sql.DB, uname string) error {
		if _, err := runStatement(ctx, db, "ALTER USER "+uname+" "+action); err != nil {
			return wireErr(err)
		}
		return nil
	})
	if err != nil {
		return nil, respondErr(w, err)
	}
	return &gentypes.Empty{}, nil
}

// assignRole runs `GRANT ROLE <role> TO <user>` per the v0.5.15
// grammar (no `USER` keyword after `TO`). uname MUST be pre-quoted by
// the caller via quoteIdent — assignRole only quotes the role name.
// The caller pre-quotes so duplicate quoting is avoided when
// PostUsers/PatchUsername loop over a slice of roles for one user.
//
// Upstream routes `GRANT ROLE ... TO <user>` to
// `geode.auth.user_assign_role`, which is idempotent on re-assigning
// the user's current role (no auth_version bump, no audit row).
func assignRole(ctx context.Context, db *sql.DB, uname, role string) error {
	roleIdent, err := geode.QuoteIdent(role)
	if err != nil {
		return badRequest(ErrCodeInvalidRole, err.Error())
	}
	if _, err := runStatement(ctx, db, "GRANT ROLE "+roleIdent+" TO "+uname); err != nil {
		return wireErr(err)
	}
	return nil
}

// withConnDBAndIdent collapses the recurring user-handler preamble:
// resolve the active *sql.DB, validate+quote the username identifier,
// then invoke fn with both. Errors from either preamble step (or the
// caller's body) flow back as endpointError-shaped errors so the
// caller's single `respondErr(w, err)` site renders them inline.
//
// GAP-Q9 (#41): introduced after the Q3 rename (`userDB`→`connDB`) to
// retire the 9 hand-rolled preambles in this file. Callers that need
// only `connDB` (e.g. `GetUsers`) keep using it directly; callers
// that need `connDB` *and* a quoted username route through here.
func (s *GraphServer) withConnDBAndIdent(ctx context.Context, name string, fn func(db *sql.DB, qname string) error) error {
	db, err := s.connDB(ctx)
	if err != nil {
		return err
	}
	qname, err := geode.QuoteIdent(name)
	if err != nil {
		return badRequest(ErrCodeInvalidUsername, err.Error())
	}
	return fn(db, qname)
}

// connDB resolves the *sql.DB for the current request's connection
// profile (taken from the request context, falling back to the default
// profile). Used by every wire-level handler family — users, roles,
// policies, grants, backups, migrations — not just user admin.
func (s *GraphServer) connDB(ctx context.Context) (*sql.DB, error) {
	if s.cfg.Pool == nil {
		return nil, errors.New("server: pool not configured")
	}
	db, err := s.cfg.Pool.DB(profileFromContextOrDefault(ctx))
	if err != nil {
		return nil, &endpointError{
			status:      http.StatusBadGateway,
			code:        ErrCodeProfileUnreachable,
			description: err.Error(),
		}
	}
	return db, nil
}

// rowToMap turns a driver row into a plain map[string]any keyed by
// column name. Used by the SHOW-* read paths (USERS, POLICIES,
// MIGRATIONS, BACKUPS, ROLES) where the row shape is open and the
// UI consumes whatever columns Geode emits today.
func rowToMap(cols []string, row []any) map[string]any {
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
// schema's optional-field semantics; columns we do not recognise are
// dropped (with a one-line drift warning so a future Geode column
// addition surfaces in logs rather than being silently lost — see
// GAP-Q8 #38).
//
// Recognised columns:
//
//   - `username` / `name` (string) -> Username
//   - `email` (string)             -> Email
//   - `role` (string, v0.5.15)     -> Roles[0]   (singular -> singleton slice)
//   - `roles` (list-shaped, legacy)-> Roles
//   - `active` (bool, v0.5.15)     -> Disabled = !active
//   - `disabled` (bool, legacy)    -> Disabled
//   - `mfa_enrolled` (bool, legacy)-> MfaEnrolled
//
// The v0.5.15 SHOW USERS shape is sourced from `handleUserList` in
// `src/execution/auth_dispatch.zig`: ("username", "email", "role",
// "active"). Pre-v0.5.15 column names are kept for back-compat with
// stub drivers and any older Geode build that still emits the legacy
// shape over the wire.
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
		case "role":
			// v0.5.15: SHOW USERS emits a single `role` column with the
			// built-in role name (admin / user / readwrite / readonly).
			// Lift into the typed []Roles slice so the SPA continues to
			// consume a list. Empty role -> no entry (zero-value slice).
			if v := asStr(row[i]); v != "" {
				u.Roles = []string{v}
			}
		case "roles":
			u.Roles = asStrs(row[i])
		case "active":
			// v0.5.15 inverts the polarity: the catalog tracks "is_active",
			// the typed schema tracks "disabled". Invert so SPA gates
			// (Disable button hidden when already disabled) keep working.
			u.Disabled = !asBool(row[i])
		case "disabled":
			u.Disabled = asBool(row[i])
		case "mfa_enrolled":
			u.MfaEnrolled = asBool(row[i])
		default:
			warnRowDrift("SHOW USERS", c)
		}
	}
	return u
}

// permissionFromRow projects a driver row from `SHOW PERMISSIONS FOR
// USER` onto the typed Permission schema. Known columns: permission,
// resource, scope. Unknown columns are dropped with a drift warning.
func permissionFromRow(cols []string, row []any) gentypes.Permission {
	var p gentypes.Permission
	for i, c := range cols {
		if i >= len(row) {
			break
		}
		switch c {
		case "permission", "privilege":
			p.Permission = asStr(row[i])
		case "resource", "object":
			p.Resource = asStr(row[i])
		case "scope", "graph":
			p.Scope = asStr(row[i])
		default:
			warnRowDrift("SHOW PERMISSIONS", c)
		}
	}
	return p
}

// driftSeen deduplicates the per-(statement,column) drift warning so a
// large result set does not spam the log with one line per row.
//
// PERF #221: the dedupe is overwhelmingly a read-mostly path — the
// first occurrence of a (stmt, col) pair writes once and every
// subsequent observation hits the existing-entry branch and reads
// only. Switch to sync.RWMutex so concurrent observers on already-
// seen keys take RLock() and proceed in parallel; only the cold
// "first sighting" path takes Lock().
var driftSeen = struct {
	mu  sync.RWMutex
	set map[string]struct{}
}{set: map[string]struct{}{}}

// warnRowDrift logs (once per process per statement+column) that a
// SHOW-catalogue query returned a column the row-projection helper does
// not map. The data for that column is dropped from the typed response;
// the warning is the signal to extend the projection (and the geode.json
// schema) when the upstream Geode catalogue grows.
//
// PERF #221: hot path takes RLock() on existing entries. The "first
// sighting" path takes Lock() and re-checks the set under the write
// lock so a racing pair of first-sightings does not double-log.
func warnRowDrift(stmt, col string) {
	key := stmt + "\x00" + col

	// Read-mostly fast path: already-seen entries return immediately.
	driftSeen.mu.RLock()
	if _, ok := driftSeen.set[key]; ok {
		driftSeen.mu.RUnlock()
		return
	}
	driftSeen.mu.RUnlock()

	// Cold path: first sighting. Take the write lock + re-check (a
	// concurrent caller may have inserted between our RUnlock and
	// Lock; if so, drop the duplicate log line).
	driftSeen.mu.Lock()
	if _, ok := driftSeen.set[key]; ok {
		driftSeen.mu.Unlock()
		return
	}
	driftSeen.set[key] = struct{}{}
	driftSeen.mu.Unlock()
	slog.Warn("row-projection drift: unmapped column dropped from typed response",
		"statement", stmt, "column", col)
}
