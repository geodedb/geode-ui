package server

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strings"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// Login implements POST /api/v1/auth/login.
//
// The request carries username/password/profile (form-encoded — see the
// generated route in gen/api/handlers_gen.go). We authenticate against
// the named upstream Geode profile by opening a short-lived *sql.DB
// with the user-supplied credentials injected into the DSN, run a
// `SHOW USER ROLES` to harvest the role list, then mint a JWT carrying
// the subject / profile / roles back to the client.
//
// genapi calls this method "Login" — derived from the path's terminal
// segment, /api/v1/auth/login, with the path containing no other
// disambiguating tokens.
func (s *GraphServer) Login(w http.ResponseWriter, r *http.Request, req *gentypes.LoginReq) (*gentypes.LoginResp, error) {
	if s.cfg.JWT == nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusInternalServerError,
			code:        "server_misconfigured",
			description: "jwt issuer not configured",
		})
		return nil, nil
	}
	if s.cfg.Profiles == nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusInternalServerError,
			code:        "server_misconfigured",
			description: "profile lookup not configured",
		})
		return nil, nil
	}
	profile := req.Profile
	if profile == "" {
		profile = "default"
	}
	ok, roles, err := s.authenticateUpstream(r.Context(), profile, req.Username, req.Password)
	if err != nil {
		emitAudit(auditEventLoginFailure,
			"user", req.Username,
			"profile", profile,
			"reason", "upstream_error",
		)
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadGateway,
			code:        "upstream_error",
			description: err.Error(),
		})
		return nil, nil
	}
	if !ok {
		emitAudit(auditEventLoginFailure,
			"user", req.Username,
			"profile", profile,
			"reason", "invalid_credentials",
		)
		writeEndpointError(w, &endpointError{
			status:      http.StatusUnauthorized,
			code:        "invalid_credentials",
			description: "username or password incorrect",
		})
		return nil, nil
	}
	// Grant the "admin" role to configured bootstrap admins. Geode v0.5.11
	// doesn't expose a queryable role-enumeration form (see
	// authenticateUpstream comment), so without this the bootstrap user
	// would carry empty roles and every required_roles=["admin"] gate
	// would 403. AdminUsernames is configured at startup via -admin-users.
	if s.cfg.AdminUsernames[req.Username] {
		roles = appendUnique(roles, "admin")
	}

	token, exp, err := s.cfg.JWT.Issue(req.Username, profile, roles)
	if err != nil {
		return nil, err
	}
	emitAudit(auditEventLoginSuccess,
		"user", req.Username,
		"profile", profile,
		"roles", roles,
	)
	expiresIn := int64(exp.Sub(timeNow()).Seconds())
	if expiresIn < 1 {
		// Schema requires expires_in >= 1 — clamp to 1 second on the
		// vanishingly unlikely race where the wall clock advanced
		// past the expiry between Issue() and the Sub() call.
		expiresIn = 1
	}
	return &gentypes.LoginResp{
		AccessToken: token,
		TokenType:   "Bearer",
		ExpiresIn:   expiresIn,
	}, nil
}

// authenticateUpstream opens a fresh *sql.DB for the named profile with
// the submitted credentials inlined into its DSN, then issues a
// no-op probe (`RETURN 1`) to force the driver to actually round-trip
// auth to Geode. A successful probe (returning ok=true) means the
// upstream accepted the credentials. A driver/transport error is
// classified by the GQL status class (ISO/IEC 39075 §3.1.6):
//
//   - 28000 ("invalid authorization specification") and 08P01
//     ("password reset required") indicate auth failure — surface as
//     401 invalid_credentials.
//   - Anything else (parse error, network failure, server error)
//     indicates the credentials were *not* the problem — return as
//     a 502 upstream_error so the client doesn't silently retype its
//     password against an unrelated server bug.
//
// Roles are best-effort. Geode v0.5.11's wire dialect does not yet
// expose a queryable role-enumeration form (`SHOW USER ROLES`,
// `SHOW ROLES`, etc. all return status_class=42000 "parse error").
// Until the server adds one we return an empty role list — the JWT
// still carries the (sub, profile), and per-graph authorization is
// enforced by Geode itself on subsequent queries.
//
// `error`s from this function are reserved for *infrastructure*
// problems (unknown profile, driver init failure) — callers translate
// those to 502.
func (s *GraphServer) authenticateUpstream(ctx context.Context, profile, username, password string) (bool, []string, error) {
	prof, err := s.cfg.Profiles.Lookup(profile)
	if err != nil {
		return false, nil, err
	}
	dsn := injectCreds(prof.DSN, username, password)
	db, err := sql.Open("geode", dsn)
	if err != nil {
		return false, nil, err
	}
	defer func() { _ = db.Close() }()

	// `RETURN 1` is the smallest valid GQL statement. It forces the
	// driver to open a session, complete the auth handshake, and emit
	// a row — every step that can fail authentication.
	rows, err := db.QueryContext(ctx, "RETURN 1")
	if err != nil {
		// Treat 28000 (auth) and 08P01 (password reset required) as
		// invalid credentials. Everything else is an upstream issue —
		// surface a generic ok=false so the user is not told their
		// password is wrong because of, say, a parse-error server bug.
		// We deliberately discard the error message because the
		// upstream may include the username verbatim, which would
		// leak through any 4xx description.
		if isAuthError(err) {
			return false, nil, nil
		}
		return false, nil, err
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		// Drain the result; we don't need the values, just confirmation
		// that the server actually sent a row (i.e. auth succeeded).
		var ignore any
		if err := rows.Scan(&ignore); err != nil {
			return false, nil, err
		}
	}
	if err := rows.Err(); err != nil {
		if isAuthError(err) {
			return false, nil, nil
		}
		return false, nil, err
	}
	// Roles unavailable in v0.5.11 wire dialect — see function comment.
	return true, nil, nil
}

// appendUnique appends s to roles unless it is already present (case-
// insensitive — the role gate uses securex.RoleFromString which is also
// case-insensitive). Returns the (possibly-extended) slice.
func appendUnique(roles []string, s string) []string {
	for _, r := range roles {
		if strings.EqualFold(r, s) {
			return roles
		}
	}
	return append(roles, s)
}

// isAuthError reports whether err carries a GQL status class that
// indicates an authentication problem rather than an unrelated query
// or transport failure. Handles both wrapped and bare errors via
// errors.As + a fallback string match for transports that don't yet
// expose a typed StatusClass.
func isAuthError(err error) bool {
	if err == nil {
		return false
	}
	type statusClasser interface{ StatusClass() string }
	var sc statusClasser
	if errors.As(err, &sc) {
		switch sc.StatusClass() {
		case "28000", // invalid_authorization_specification
			"08P01": // password reset required (Geode-specific)
			return true
		}
		return false
	}
	// Fallback: substring match. Older driver versions wrap the
	// status_class JSON into a generic error.
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "authentication failed") ||
		strings.Contains(msg, "invalid credentials") ||
		strings.Contains(msg, "password reset required")
}

// injectCreds rewrites a Geode DSN to carry the supplied username and
// password in its userinfo segment. If the original DSN already has
// credentials they are stripped first. Returns the original DSN
// unchanged if it has no `://` (test seam — lets a non-URL DSN flow
// through the stub driver in tests without panicking).
func injectCreds(dsn, username, password string) string {
	idx := strings.Index(dsn, "://")
	if idx < 0 {
		return dsn
	}
	scheme := dsn[:idx+3]
	rest := dsn[idx+3:]
	if at := strings.Index(rest, "@"); at >= 0 {
		rest = rest[at+1:]
	}
	return scheme + url.UserPassword(username, password).String() + "@" + rest
}
