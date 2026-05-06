package server

import (
	"context"
	"database/sql"
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
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadGateway,
			code:        "upstream_error",
			description: err.Error(),
		})
		return nil, nil
	}
	if !ok {
		writeEndpointError(w, &endpointError{
			status:      http.StatusUnauthorized,
			code:        "invalid_credentials",
			description: "username or password incorrect",
		})
		return nil, nil
	}
	token, exp, err := s.cfg.JWT.Issue(req.Username, profile, roles)
	if err != nil {
		return nil, err
	}
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
// the submitted credentials inlined into its DSN, then issues
// `SHOW USER ROLES` and harvests the role names. A successful query
// (returning ok=true) means the upstream accepted the credentials; a
// query error is treated as a failed authentication (ok=false) — the
// Geode driver typically reports an auth failure as the first
// QueryContext error rather than at sql.Open time.
//
// errors are reserved for *infrastructure* problems (unknown profile,
// driver init failure, scan error) — callers translate those to 502.
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

	rows, err := db.QueryContext(ctx, "SHOW USER ROLES")
	if err != nil {
		// Driver reports auth failure here — surface as failed login,
		// not as a 502. We deliberately discard the error message
		// because the upstream may include the username verbatim,
		// which would leak through the 401 description.
		return false, nil, nil
	}
	defer func() { _ = rows.Close() }()

	var roles []string
	for rows.Next() {
		var role string
		if err := rows.Scan(&role); err != nil {
			return false, nil, err
		}
		roles = append(roles, role)
	}
	if err := rows.Err(); err != nil {
		return false, nil, err
	}
	return true, roles, nil
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
