package server

import (
	"context"
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	gentypes "geodedb.com/geode-ui/gen/types"
	"geodedb.com/geode-ui/internal/conn"
)

// fakeProfileLookup is a tiny ProfileLookup implementation for tests
// that don't want to spin up a real *conn.Pool.
type fakeProfileLookup struct {
	prof conn.Profile
	err  error
}

func (f fakeProfileLookup) Lookup(_ string) (conn.Profile, error) {
	return f.prof, f.err
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

// TestLogin_UnknownProfile surfaces a Lookup error as a 502
// upstream_error rather than a 500. The Profile dial layer is what
// reports unknown profile names.
func TestLogin_UnknownProfile(t *testing.T) {
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
	if w.Code != http.StatusBadGateway {
		t.Fatalf("status=%d want 502", w.Code)
	}
	if !strings.Contains(w.Body.String(), "upstream_error") {
		t.Fatalf("body=%q want upstream_error", w.Body.String())
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
		AccessToken: "ey.dummy.token",
		TokenType:   "Bearer",
		ExpiresIn:   3600,
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
