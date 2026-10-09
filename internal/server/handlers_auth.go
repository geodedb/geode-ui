package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

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
			code:        ErrCodeServerMisconfigured,
			description: "jwt issuer not configured",
		})
		return responseWritten[gentypes.LoginResp]()
	}
	if s.cfg.Profiles == nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusInternalServerError,
			code:        ErrCodeServerMisconfigured,
			description: "profile lookup not configured",
		})
		return responseWritten[gentypes.LoginResp]()
	}
	// SEC-N10 (#76): start the auth-failure timer BEFORE any upstream
	// call so every failure path — unknown user, wrong password, and
	// transport / profile-lookup failure — observes the same minimum
	// wall-clock latency. The floor is intentionally generous (250 ms)
	// to swallow most cross-failure jitter without making successful
	// logins feel sluggish (success returns immediately when the
	// upstream answers faster than the floor).
	authStart := timeNow()

	// SEC-N3 (#65): canonicalise the profile early so audit logs, rate-
	// limit buckets (loginlimiter.go), and the upstream auth attempt all
	// agree on the bucket key. Empty or whitespace-only profile resolves
	// to "default" — preserved for backward compatibility with the
	// existing SPA which submits "" when the user has not picked a
	// profile. Any future requirement to *forbid* implicit-default would
	// be a clean follow-up: replace this call with an explicit 400 here.
	profile := canonicalProfile(req.Profile)
	authenticate := s.cfg.testAuthenticate
	if authenticate == nil {
		authenticate = s.authenticateUpstream
	}
	ok, roles, err := authenticate(r.Context(), profile, req.Username, req.Password)
	// SEC-N10 (#76): collapse every authentication-failure path into
	// the same 401 invalid_credentials response. We still keep the
	// operator-side audit detail (reason="upstream_error" vs
	// "invalid_credentials") so the security team can diagnose
	// infrastructure issues, but the on-the-wire body and status code
	// are byte-identical across all failure modes — denying the
	// attacker the side channel.
	if err != nil || !ok {
		reason := "invalid_credentials"
		if err != nil {
			reason = "upstream_error"
		}
		denyLogin(w, authStart, reason, req.Username, req.Password, profile)
		return responseWritten[gentypes.LoginResp]()
	}
	// Grant the "admin" role to configured bootstrap admins (see
	// adminRolesFor / authenticateUpstream).
	roles = s.adminRolesFor(req.Username, roles)

	connID := newConnectionID()
	token, exp, err := s.cfg.JWT.Issue(req.Username, profile, roles, connID)
	if err != nil {
		return nil, err
	}
	emitAudit(auditEventLoginSuccess,
		"user", req.Username,
		"profile", profile,
		auditKeyRoles, roles,
		"cid", connID,
	)
	expiresIn := s.mintAndSetAuthCookie(w, token, exp)
	return &gentypes.LoginResp{
		AccessToken:  token,
		TokenType:    "Bearer",
		ExpiresIn:    expiresIn,
		ConnectionID: connID,
	}, nil
}

// denyLogin executes the SEC-N10 (#76) constant-time authentication-
// failure path: pay the dummy hash-compare cost, emit the operator-side
// audit event (with the diagnostic reason), wait out the minimum-latency
// floor, then write the byte-identical 401 invalid_credentials response.
//
// The order of operations and the latency-floor arithmetic are deliberate
// — every failure mode (unknown user, wrong password, upstream/transport
// error) must observe the same observable wall-clock latency. authStart
// MUST have been captured before any upstream call. (password is taken
// alongside username only to feed the dummy constant-time compare; it is
// never logged or otherwise used.)
func denyLogin(w http.ResponseWriter, authStart time.Time, reason, username, password, profile string) {
	// Always pay the constant-time hash compare cost so a path
	// that *would* have early-returned at "user lookup failed"
	// still spends the same CPU as a path that did a real
	// password compare. This is the local-side complement to the
	// upstream constant-time auth — see authenticateUpstream
	// comment for why we cannot do a local hash compare.
	performDummyCompare(username, password)

	emitAudit(auditEventLoginFailure,
		"user", username,
		"profile", profile,
		"reason", reason,
	)
	// Min-latency floor — wait out the remainder of the policy
	// window so timing diffs between failure modes are masked.
	respectLoginLatencyFloor(authStart, loginMinFailureLatency)
	writeEndpointError(w, &endpointError{
		status:      http.StatusUnauthorized,
		code:        ErrCodeInvalidCredentials,
		description: "invalid credentials",
	})
}

// adminRolesFor returns upstreamRoles with the "admin" role appended when
// username is a configured bootstrap admin (-admin-users). Geode v0.5.11
// doesn't expose a queryable role-enumeration form (see
// authenticateUpstream comment), so without this the bootstrap user would
// carry empty roles and every required_roles=["admin"] gate would 403.
func (s *GraphServer) adminRolesFor(username string, upstreamRoles []string) []string {
	if s.cfg.AdminUsernames[username] {
		return appendUnique(upstreamRoles, "admin")
	}
	return upstreamRoles
}

// mintAndSetAuthCookie sets the SEC-F7 (#62) HttpOnly + SameSite=Strict
// access-token cookie on w and returns the clamped expires_in (seconds).
//
// The cookie's Max-Age tracks the JWT TTL so a stale browser session
// can't keep replaying a token whose JWT exp has passed. The token is
// still returned in the response body by the caller so programmatic
// callers (CLIs, MCP) keep working unchanged. The expires_in clamp
// arithmetic is preserved exactly.
func (s *GraphServer) mintAndSetAuthCookie(w http.ResponseWriter, token string, exp time.Time) int64 {
	// Schema requires expires_in >= 1 — clamp to 1 second on the
	// vanishingly unlikely race where the wall clock advanced
	// past the expiry between Issue() and the Sub() call.
	expiresIn := max(int64(exp.Sub(timeNow()).Seconds()), 1)
	//nolint:gosec // G124: HttpOnly and SameSite=Strict are set; Secure follows the operator's -secure-cookies flag (plain-HTTP dev).
	http.SetCookie(w, &http.Cookie{
		Name:     AuthCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(expiresIn),
		HttpOnly: true,
		Secure:   s.cfg.SecureCookies,
		SameSite: http.SameSiteStrictMode,
	})
	return expiresIn
}

// HandleLogout (SEC-F7 / #62) clears the geode-ui-auth cookie and
// returns 204. Idempotent — safe to call without an authenticated
// session. Server-side JWT revocation is out of scope (tracked
// separately under SEC-N2); the cookie clear is sufficient for
// browser-side logout because SameSite=Strict prevents cross-site
// replay even if the JWT is still cryptographically valid.
//
// Wired in cmd/server/main.go as a hand-rolled mux.HandleFunc rather
// than through genapi because the route is intentionally
// authentication-optional: a client that has lost track of its session
// must still be able to ask the server to clear the cookie.
func (s *GraphServer) HandleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	//nolint:gosec // G124: HttpOnly and SameSite=Strict are set; Secure follows the operator's -secure-cookies flag (plain-HTTP dev).
	http.SetCookie(w, &http.Cookie{
		Name:     AuthCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1, // delete; net/http renders MaxAge=-1 as "Max-Age=0".
		HttpOnly: true,
		Secure:   s.cfg.SecureCookies,
		SameSite: http.SameSiteStrictMode,
	})
	w.WriteHeader(http.StatusNoContent)
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

// newConnectionID returns a 16-byte hex-encoded random identifier
// used as the JWT cid claim and the LoginResp.connection_id body
// field. crypto/rand sourced; collision probability is negligible.
func newConnectionID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// loginMinFailureLatency is the minimum wall-clock duration every
// failed Login attempt observes (SEC-N10 / #76). Set to 250 ms — long
// enough to swallow practically all upstream-vs-local timing diffs
// without bothering users on the happy path (success returns
// immediately when the upstream answers faster). Lowercase / var so
// tests in this package can lower it to a few microseconds and avoid
// pegging the suite on real wall-clock waits.
//
//nolint:gochecknoglobals // test seam: tests lower the floor to avoid real wall-clock waits.
var loginMinFailureLatency = 250 * time.Millisecond

// dummyCompareTarget is a constant-time-compare sink: a fixed SHA-256
// of an arbitrary byte sequence. performDummyCompare hashes the
// caller-supplied username+password and compares the result against
// this sink. The comparison itself is constant-time via
// subtle.ConstantTimeCompare so the function's runtime is dominated
// by the hash, not by an unequal-byte short-circuit. The output is
// thrown away — we don't care whether they match.
//
//nolint:gochecknoglobals // fixed digest computed once; Go has no constant arrays.
var dummyCompareTarget = sha256.Sum256([]byte("SEC-N10 anti-timing sink"))

// performDummyCompare burns roughly the same CPU as a real password
// hash + compare so a request that fails at "user not found" inside
// the upstream still spends comparable CPU to one that fails at
// "wrong password". Combined with the loginMinFailureLatency floor
// below, this denies the attacker an information-leaking timing
// channel between failure modes.
func performDummyCompare(username, password string) {
	h := sha256.Sum256([]byte(username + ":" + password))
	_ = subtle.ConstantTimeCompare(h[:], dummyCompareTarget[:])
}

// respectLoginLatencyFloor sleeps until at least `floor` has elapsed
// since `start`. Combined with performDummyCompare it ensures every
// auth-failure path has the same observable latency from a remote
// attacker's perspective. A no-op if floor has already passed.
func respectLoginLatencyFloor(start time.Time, floor time.Duration) {
	if floor <= 0 {
		return
	}
	elapsed := timeNow().Sub(start)
	if remaining := floor - elapsed; remaining > 0 {
		time.Sleep(remaining)
	}
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
