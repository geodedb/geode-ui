package server

import (
	"context"
	"encoding/json/v2"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	gentypes "geodedb.com/geode-ui/gen/types"
	"geodedb.com/geode-ui/internal/conn"
)

// fakeProfileLookup is a tiny ProfileLookup implementation for tests
// that don't want to spin up a real *conn.Pool.
type fakeProfileLookup struct {
	prof  conn.Profile
	err   error
	names []string
}

func (f fakeProfileLookup) Lookup(_ string) (conn.Profile, error) {
	return f.prof, f.err
}

func (f fakeProfileLookup) Names() []string {
	return f.names
}

// TestLogin_RejectsWhenJWTNil exercises the server-misconfigured guard
// for a server with no Issuer attached.
func TestLogin_RejectsWhenJWTNil(t *testing.T) {
	srv := New(Config{Profiles: fakeProfileLookup{}})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	resp, err := srv.Login(w, r, &gentypes.LoginReq{Username: "alice", Password: "p"})
	if err != nil {
		t.Fatalf("err=%v want nil (handler writes inline)", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d want 500", w.Code)
	}
	if !strings.Contains(w.Body.String(), "server_misconfigured") {
		t.Fatalf("body=%q want server_misconfigured", w.Body.String())
	}
}

// TestLogin_RejectsWhenProfilesNil exercises the parallel guard for a
// server with an Issuer but no ProfileLookup.
func TestLogin_RejectsWhenProfilesNil(t *testing.T) {
	srv := New(Config{JWT: newTestIssuer(t)})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	resp, err := srv.Login(w, r, &gentypes.LoginReq{Username: "alice", Password: "p"})
	if err != nil {
		t.Fatalf("err=%v want nil", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d want 500", w.Code)
	}
}

// TestLogin_UnknownProfile asserts an upstream / profile-lookup
// failure now surfaces as the same 401 invalid_credentials response
// as a wrong-password attempt — GAP-N10 constant-time auth-failure
// path. The audit log still distinguishes upstream_error vs
// invalid_credentials for operator diagnostics; only the *wire-
// visible* shape is collapsed.
func TestLogin_UnknownProfile(t *testing.T) {
	// Lower the latency floor for the test so we don't pay the
	// production 250 ms wall-clock wait on every run.
	prev := loginMinFailureLatency
	loginMinFailureLatency = 0
	t.Cleanup(func() { loginMinFailureLatency = prev })

	srv := New(Config{
		JWT:      newTestIssuer(t),
		Profiles: fakeProfileLookup{err: errMissingProfile},
	})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	resp, err := srv.Login(w, r, &gentypes.LoginReq{
		Username: "alice", Password: "p", Profile: "nope",
	})
	if err != nil {
		t.Fatalf("err=%v want nil", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401 (collapsed via SEC-N10)", w.Code)
	}
	if !strings.Contains(w.Body.String(), "invalid_credentials") {
		t.Fatalf("body=%q want invalid_credentials (collapsed shape)", w.Body.String())
	}
	if strings.Contains(w.Body.String(), "upstream_error") {
		t.Fatalf("body=%q must not leak upstream_error to wire (SEC-N10)", w.Body.String())
	}
}

// errMissingProfile is the canned error shape fakeProfileLookup
// returns to drive the unknown-profile code path. We use a sentinel
// rather than fmt.Errorf so the comparison in the handler stays
// stable regardless of fmt's output formatting choices.
var errMissingProfile = stringErr("conn: unknown profile \"nope\"")

type stringErr string

func (s stringErr) Error() string { return string(s) }

// TestInjectCreds_StripsExistingUserinfo confirms the helper rewrites
// a DSN to carry only the new credentials and never leaks the prior
// userinfo segment back into the request.
func TestInjectCreds_StripsExistingUserinfo(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"no userinfo", "quic://host:3141", "quic://alice:s3cr3t@host:3141"},
		{"with userinfo", "quic://old:gone@host:3141", "quic://alice:s3cr3t@host:3141"},
		{"http scheme", "http://host:8080", "http://alice:s3cr3t@host:8080"},
		{"no scheme passes through", "weird-dsn", "weird-dsn"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := injectCreds(tc.in, "alice", "s3cr3t")
			if got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

// TestInjectCreds_PercentEncodesPassword confirms a password with
// reserved characters (':', '@', '/') is percent-encoded so the DSN
// remains a valid URL.
func TestInjectCreds_PercentEncodesPassword(t *testing.T) {
	got := injectCreds("quic://host:3141", "alice", "p:@/word")
	// url.UserPassword percent-encodes ':' '@' '/' inside the
	// password segment, producing %3A %40 %2F respectively.
	if !strings.Contains(got, "p%3A%40%2Fword") {
		t.Fatalf("got %q want password to be percent-encoded", got)
	}
}

// TestLoginRespShape sanity-checks that LoginResp.Valid (generated)
// passes the field-shape we plan to emit. Catches schema drift
// between Issue's outputs and the generated response validator.
func TestLoginRespShape(t *testing.T) {
	resp := &gentypes.LoginResp{
		AccessToken:  "ey.dummy.token",
		TokenType:    "Bearer",
		ExpiresIn:    3600,
		ConnectionID: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4", // 32 hex chars
	}
	if err := resp.Valid(); err != nil {
		t.Fatalf("LoginResp.Valid: %v", err)
	}
	// Encode-decode round trip — guards against any json/v2 quirk.
	raw, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var decoded gentypes.LoginResp
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if decoded.AccessToken != resp.AccessToken {
		t.Fatalf("round-trip access_token=%q want %q", decoded.AccessToken, resp.AccessToken)
	}
}

// quietCtx returns a background context plus a cancel that's invoked
// by the test cleanup. This is the pattern used by handlers_users_test
// for short-lived contexts in unit tests.
//
//nolint:unused // reserved for future Login tests that need a context.
func quietCtx(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return ctx
}

// TestAppendUnique covers the role-list helper used by Login to add the
// admin role for configured bootstrap users without producing duplicates.
func TestAppendUnique(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		add  string
		want []string
	}{
		{"appends to empty", nil, "admin", []string{"admin"}},
		{"appends new", []string{"user"}, "admin", []string{"user", "admin"}},
		{"skips exact dup", []string{"admin"}, "admin", []string{"admin"}},
		{"skips case-insensitive dup", []string{"ADMIN"}, "admin", []string{"ADMIN"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := appendUnique(tc.in, tc.add)
			if !equalStrings(got, tc.want) {
				t.Fatalf("got=%v want=%v", got, tc.want)
			}
		})
	}
}

// equalStrings is defined in handlers_schema_test.go (same package).

// TestAdminRolesFor covers the -admin-users membership → grant "admin"
// role helper extracted from Login (#146 / Q12).
func TestAdminRolesFor(t *testing.T) {
	s := &GraphServer{cfg: Config{AdminUsernames: map[string]bool{"root": true}}}
	if got := s.adminRolesFor("alice", []string{"reader"}); !equalStrings(got, []string{"reader"}) {
		t.Fatalf("non-admin user: got=%v want unchanged [reader]", got)
	}
	if got := s.adminRolesFor("root", nil); !equalStrings(got, []string{"admin"}) {
		t.Fatalf("admin user empty roles: got=%v want [admin]", got)
	}
	if got := s.adminRolesFor("root", []string{"admin"}); !equalStrings(got, []string{"admin"}) {
		t.Fatalf("admin user already-admin: got=%v want [admin] (no dup)", got)
	}
	// Nil AdminUsernames map: a map index on a nil map returns the zero
	// value (false), so no user is treated as admin.
	sNil := &GraphServer{cfg: Config{}}
	if got := sNil.adminRolesFor("root", []string{"reader"}); !equalStrings(got, []string{"reader"}) {
		t.Fatalf("nil AdminUsernames: got=%v want unchanged [reader]", got)
	}
}

// TestMintAndSetAuthCookie covers the SEC-F7 cookie helper extracted from
// Login (#146 / Q12): the cookie shape, the Secure flag tracking
// SecureCookies, and the expires_in >= 1 clamp.
func TestMintAndSetAuthCookie(t *testing.T) {
	t.Run("normal TTL", func(t *testing.T) {
		s := &GraphServer{cfg: Config{SecureCookies: true}}
		rec := httptest.NewRecorder()
		exp := time.Now().Add(30 * time.Minute)
		gotExpires := s.mintAndSetAuthCookie(rec, "tok-123", exp)
		if gotExpires < 1 || gotExpires > 1800 {
			t.Fatalf("expiresIn=%d want in (0,1800]", gotExpires)
		}
		c := findCookie(t, rec, AuthCookieName)
		if c.Value != "tok-123" || c.Path != "/" || !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteStrictMode {
			t.Fatalf("cookie shape wrong: %+v", c)
		}
		if c.MaxAge != int(gotExpires) {
			t.Fatalf("cookie MaxAge=%d want %d", c.MaxAge, gotExpires)
		}
	})
	t.Run("already-expired clamps to 1", func(t *testing.T) {
		s := &GraphServer{cfg: Config{SecureCookies: false}}
		rec := httptest.NewRecorder()
		exp := time.Now().Add(-time.Hour)
		gotExpires := s.mintAndSetAuthCookie(rec, "tok", exp)
		if gotExpires != 1 {
			t.Fatalf("expiresIn=%d want 1 (clamp)", gotExpires)
		}
		c := findCookie(t, rec, AuthCookieName)
		if c.Secure {
			t.Fatalf("cookie Secure=true want false (SecureCookies=false)")
		}
		if c.MaxAge != 1 {
			t.Fatalf("cookie MaxAge=%d want 1", c.MaxAge)
		}
	})
}

// findCookie returns the named cookie from rec or fails the test.
func findCookie(t *testing.T, rec *httptest.ResponseRecorder, name string) *http.Cookie {
	t.Helper()
	for _, c := range rec.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("cookie %q not set; got %v", name, rec.Result().Cookies())
	return nil
}

// TestLogin_ReturnsConnectionID asserts that Login mints a non-empty,
// unique connection_id per call and that the value matches the cid
// claim embedded in the returned JWT.
func TestLogin_ReturnsConnectionID(t *testing.T) {
	iss := newTestIssuer(t)
	srv := New(Config{
		JWT:      iss,
		Profiles: fakeProfileLookup{prof: conn.Profile{Name: "default", DSN: "stub://x"}},
		testAuthenticate: func(_ context.Context, _, _, _ string) (bool, []string, error) {
			return true, nil, nil
		},
	})

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	resp, err := srv.Login(w, r, &gentypes.LoginReq{
		Username: "alice", Password: "p", Profile: "default",
	})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if resp.ConnectionID == "" {
		t.Errorf("ConnectionID is empty")
	}

	w2 := httptest.NewRecorder()
	r2 := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	resp2, _ := srv.Login(w2, r2, &gentypes.LoginReq{
		Username: "alice", Password: "p", Profile: "default",
	})
	if resp2.ConnectionID == resp.ConnectionID {
		t.Errorf("two Logins returned the same ConnectionID: %q", resp.ConnectionID)
	}

	claims, _ := iss.Parse(resp.AccessToken)
	if claims.ConnectionID != resp.ConnectionID {
		t.Errorf("JWT cid claim %q != LoginResp.ConnectionID %q", claims.ConnectionID, resp.ConnectionID)
	}
}

// TestLogin_SetsAuthCookie (SEC-F7 / #62 S3a) is a stub that exercises
// the cookie-write side of Login on an Authoritative path: a happy
// successful login MUST emit a `geode-ui-auth` cookie carrying the
// minted JWT, with HttpOnly + SameSite=Strict + Path=/ + Max-Age set
// to the issuer TTL in seconds. Secure is conditional (see SecureCookies
// config — defaults true for production).
//
// The test wires a fake ProfileLookup that accepts any credentials by
// stub-driver dial (we use a custom DSN that bypasses the normal driver).
// Since authenticateUpstream needs a real driver round-trip, this test
// short-circuits by setting a fakeAuthenticator on Config.
func TestLogin_SetsAuthCookie(t *testing.T) {
	srv := New(Config{
		JWT:           newTestIssuer(t),
		Profiles:      fakeProfileLookup{prof: conn.Profile{Name: "default", DSN: "stub://x"}},
		SecureCookies: true,
		// authenticator override for tests — see Config.testAuthenticate.
		testAuthenticate: func(_ context.Context, _, _, _ string) (bool, []string, error) {
			return true, []string{"admin"}, nil
		},
	})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	resp, err := srv.Login(w, r, &gentypes.LoginReq{
		Username: "alice", Password: "p", Profile: "default",
	})
	if err != nil {
		t.Fatalf("err=%v want nil", err)
	}
	if resp == nil {
		t.Fatalf("resp=nil want LoginResp")
	}
	cookies := w.Result().Cookies()
	var got *http.Cookie
	for _, c := range cookies {
		if c.Name == AuthCookieName {
			got = c
			break
		}
	}
	if got == nil {
		t.Fatalf("expected %s cookie; got %v", AuthCookieName, cookies)
	}
	if got.Value != resp.AccessToken {
		t.Fatalf("cookie value mismatch: cookie=%q resp.access_token=%q", got.Value, resp.AccessToken)
	}
	if !got.HttpOnly {
		t.Fatalf("cookie HttpOnly=false want true")
	}
	if got.SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie SameSite=%v want SameSiteStrictMode", got.SameSite)
	}
	if got.Path != "/" {
		t.Fatalf("cookie Path=%q want /", got.Path)
	}
	if got.MaxAge < 1 {
		t.Fatalf("cookie MaxAge=%d want >=1", got.MaxAge)
	}
	if !got.Secure {
		t.Fatalf("cookie Secure=false want true (SecureCookies=true)")
	}
}

// TestLogin_InsecureCookieFlag (SEC-F7 / #62 S3a) — when SecureCookies
// is false, the emitted cookie omits the Secure attribute so it works
// over plain HTTP for local dev.
func TestLogin_InsecureCookieFlag(t *testing.T) {
	srv := New(Config{
		JWT:           newTestIssuer(t),
		Profiles:      fakeProfileLookup{prof: conn.Profile{Name: "default", DSN: "stub://x"}},
		SecureCookies: false,
		testAuthenticate: func(_ context.Context, _, _, _ string) (bool, []string, error) {
			return true, nil, nil
		},
	})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	if _, err := srv.Login(w, r, &gentypes.LoginReq{
		Username: "alice", Password: "p",
	}); err != nil {
		t.Fatalf("err=%v want nil", err)
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == AuthCookieName && c.Secure {
			t.Fatalf("cookie Secure=true want false (SecureCookies=false)")
		}
	}
}

// TestLogin_NoCookieOnFailure (SEC-F7 / #62 S3a) — a failed login MUST
// NOT emit an auth cookie. This guards against a future regression that
// would set the cookie before the credential check.
func TestLogin_NoCookieOnFailure(t *testing.T) {
	// SEC-N10 introduced a 250 ms failure-path floor; disable for tests.
	prev := loginMinFailureLatency
	loginMinFailureLatency = 0
	t.Cleanup(func() { loginMinFailureLatency = prev })

	srv := New(Config{
		JWT:           newTestIssuer(t),
		Profiles:      fakeProfileLookup{prof: conn.Profile{Name: "default", DSN: "stub://x"}},
		SecureCookies: true,
		testAuthenticate: func(_ context.Context, _, _, _ string) (bool, []string, error) {
			return false, nil, nil // bad credentials
		},
	})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	if _, err := srv.Login(w, r, &gentypes.LoginReq{
		Username: "alice", Password: "wrong",
	}); err != nil {
		t.Fatalf("err=%v want nil", err)
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == AuthCookieName {
			t.Fatalf("did not expect %s cookie on failed login", AuthCookieName)
		}
	}
}

// TestLogin_FailureBodyIsIdentical_AcrossModes pins the SEC-N10
// invariant: a login attempt that fails because the user does not
// exist (upstream_error 28000), because the password is wrong
// (ok=false from the upstream), and because the profile lookup
// itself failed (transport error) must all produce **byte-identical**
// response bodies AND identical status codes. This denies a remote
// attacker the ability to enumerate user names by inspecting the
// 4xx shape.
func TestLogin_FailureBodyIsIdentical_AcrossModes(t *testing.T) {
	prev := loginMinFailureLatency
	loginMinFailureLatency = 0
	t.Cleanup(func() { loginMinFailureLatency = prev })

	type setup struct {
		name string
		cfg  Config
	}
	cases := []setup{
		{
			name: "user_not_found_or_wrong_password",
			cfg: Config{
				JWT:      newTestIssuer(t),
				Profiles: fakeProfileLookup{prof: conn.Profile{Name: "default", DSN: "stub://x"}},
				testAuthenticate: func(_ context.Context, _, _, _ string) (bool, []string, error) {
					return false, nil, nil
				},
			},
		},
		{
			name: "upstream_transport_failure",
			cfg: Config{
				JWT:      newTestIssuer(t),
				Profiles: fakeProfileLookup{prof: conn.Profile{Name: "default", DSN: "stub://x"}},
				testAuthenticate: func(_ context.Context, _, _, _ string) (bool, []string, error) {
					return false, nil, errors.New("dial tcp: connection refused")
				},
			},
		},
		{
			name: "unknown_profile_lookup_failure",
			cfg: Config{
				JWT:      newTestIssuer(t),
				Profiles: fakeProfileLookup{err: errMissingProfile},
			},
		},
	}
	var firstStatus int
	var firstBody string
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := New(tc.cfg)
			w := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
			if _, err := srv.Login(w, r, &gentypes.LoginReq{
				Username: "alice", Password: "wrong-password-12c", Profile: "default",
			}); err != nil {
				t.Fatalf("err=%v want nil", err)
			}
			if i == 0 {
				firstStatus = w.Code
				firstBody = w.Body.String()
				if w.Code != http.StatusUnauthorized {
					t.Fatalf("baseline status=%d want 401", w.Code)
				}
				return
			}
			if w.Code != firstStatus {
				t.Fatalf("status=%d differs from baseline %d (SEC-N10 leak)", w.Code, firstStatus)
			}
			if w.Body.String() != firstBody {
				t.Fatalf("body=%q differs from baseline %q (SEC-N10 leak)", w.Body.String(), firstBody)
			}
		})
	}
}

// TestLogin_LatencyFloor confirms the constant-time floor: a
// fast-failing login attempt sleeps for at least the configured
// minimum so the upstream's intrinsic timing diff cannot leak.
func TestLogin_LatencyFloor(t *testing.T) {
	prev := loginMinFailureLatency
	// Pick a small but observable floor to keep tests fast.
	loginMinFailureLatency = 20 * time.Millisecond
	t.Cleanup(func() { loginMinFailureLatency = prev })

	srv := New(Config{
		JWT:      newTestIssuer(t),
		Profiles: fakeProfileLookup{prof: conn.Profile{Name: "default", DSN: "stub://x"}},
		testAuthenticate: func(_ context.Context, _, _, _ string) (bool, []string, error) {
			return false, nil, nil // immediate failure
		},
	})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	start := time.Now()
	_, _ = srv.Login(w, r, &gentypes.LoginReq{
		Username: "alice", Password: "anything-12-chars-pw", Profile: "default",
	})
	elapsed := time.Since(start)
	// Allow a small jitter tolerance so the test stays flake-free on
	// loaded CI runners. 5 ms below the floor is well within scheduler
	// noise but still catches a regression that removes the floor.
	if elapsed < loginMinFailureLatency-5*time.Millisecond {
		t.Fatalf("Login took %v; want at least ~%v (SEC-N10 latency floor)", elapsed, loginMinFailureLatency)
	}
}

// TestLogout_ClearsAuthCookie (SEC-F7 / #62 S3a) — POST
// /api/v1/auth/logout returns 204 and emits a Set-Cookie that clears
// the geode-ui-auth cookie (Max-Age=0, empty value).
func TestLogout_ClearsAuthCookie(t *testing.T) {
	srv := New(Config{SecureCookies: true})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	srv.HandleLogout(w, r)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status=%d want 204", w.Code)
	}
	cookies := w.Result().Cookies()
	var got *http.Cookie
	for _, c := range cookies {
		if c.Name == AuthCookieName {
			got = c
			break
		}
	}
	if got == nil {
		t.Fatalf("expected %s cookie clearing; got %v", AuthCookieName, cookies)
	}
	if got.Value != "" {
		t.Fatalf("logout cookie value=%q want empty", got.Value)
	}
	if got.MaxAge != -1 {
		t.Fatalf("logout cookie MaxAge=%d want -1", got.MaxAge)
	}
	if got.Path != "/" {
		t.Fatalf("logout cookie Path=%q want /", got.Path)
	}
	if !got.HttpOnly {
		t.Fatalf("logout cookie HttpOnly=false want true")
	}
}

// TestIsWireFeatureMissing pins the parse-error detection used by the
// admin-list handlers (GetUsers/Roles/Policies/Backups/Migrations) to
// degrade to an empty 200 instead of a 422 when Geode v0.5.11 doesn't
// recognize the SHOW <thing> verb.
func TestIsWireFeatureMissing(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil err", nil, false},
		{"42000 parse error", errors.New("geode: 42000: parse error"), true},
		{"42000 expected token", errors.New("geode: 42000: expected token 'l_paren'"), true},
		{"42000 expected identifier", errors.New("geode: 42000: expected identifier or keyword, got 'invalid'"), true},
		{"plain 42000 only", errors.New("status_class=42000"), false}, // requires both signals
		{"auth error", errors.New("geode: 28000: invalid credentials"), false},
		{"network", errors.New("dial tcp: connection refused"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := isWireFeatureMissing(tc.err)
			if got != tc.want {
				t.Fatalf("got=%v want=%v for %v", got, tc.want, tc.err)
			}
		})
	}
}
