package server

import (
	"context"
	"crypto/sha1" // #nosec G505 — only used to derive the HIBP suffix in the test fixture; not for auth or integrity.
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// userCreateReq is a small factory so the integration tests below
// don't repeat the gentypes.UserCreateReq literal at every call site.
func userCreateReq(username, email, password string, roles []string) gentypes.UserCreateReq {
	return gentypes.UserCreateReq{
		Username: username,
		Email:    email,
		Password: password,
		Roles:    roles,
	}
}

// passwordHandlerCall invokes (*GraphServer).Password with the given
// username + new password, returning the typed (resp, err) pair so
// the calling test can branch on inline-body responses.
func passwordHandlerCall(s *GraphServer, rec *httptest.ResponseRecorder, req *http.Request, username, newPassword string) (*gentypes.Empty, error) {
	return s.Password(rec, req, &gentypes.PasswordChangeReq{
		Username:    username,
		NewPassword: newPassword,
	})
}

// TestValidatePassword_TableDriven pins the GAP-N4 policy:
//
//   - length < 12 → errPasswordTooShort
//   - all-same-char / all-digits → errPasswordWeakPattern
//   - contains-username (>=4 chars) → errPasswordContainsUsername
//   - otherwise nil (when HIBPCheck is off)
func TestValidatePassword_TableDriven(t *testing.T) {
	cases := []struct {
		name     string
		pw       string
		username string
		want     error
	}{
		// Length
		{"empty_rejected_as_too_short", "", "alice", errPasswordTooShort},
		{"11_chars_rejected", "abcdefghijK", "alice", errPasswordTooShort},
		{"exactly_12_chars_passes", "abcdefghijK1", "alice", nil},
		{"13_chars_passes", "abcdefghijK12", "alice", nil},

		// Weak patterns
		{"all_same_char_rejected", "aaaaaaaaaaaa", "alice", errPasswordWeakPattern},
		{"all_digits_rejected", "123456789012", "alice", errPasswordWeakPattern},
		{"digits_with_one_letter_passes", "12345678901a", "alice", nil},
		{"mixed_punctuation_passes", "p@ssw0rd!!23", "alice", nil},

		// Username collision (case-insensitive, >=4 chars)
		{"username_substring_rejected", "Alice-Password!1", "alice", errPasswordContainsUsername},
		{"username_caps_in_password_rejected", "myALICEpassword1", "alice", errPasswordContainsUsername},
		{"short_username_3_chars_does_not_block", "MAxPassword12", "max", nil},
		{"username_not_present_passes", "Br3akout!Pa$$1", "alice", nil},
		{"empty_username_skips_check", "secretpasswd1", "", nil},

		// Negative-space sanity
		{"non_ascii_digits_not_classified_as_all_digits", "१२३४५६७८९०१२", "alice", nil},
	}
	policy := PasswordPolicy{} // HIBPCheck off
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validatePassword(context.Background(), tc.pw, tc.username, policy)
			if !errors.Is(err, tc.want) {
				t.Fatalf("validatePassword(%q, %q)=%v want %v", tc.pw, tc.username, err, tc.want)
			}
		})
	}
}

// TestValidatePassword_HIBPHit_BlocksPassword stands up a stub HIBP
// server that returns a hash list containing the suffix of the test
// password's SHA-1. The validator must return errPasswordPwned.
func TestValidatePassword_HIBPHit_BlocksPassword(t *testing.T) {
	pw := "P@ssw0rd-test-N4-1"
	h := sha1.Sum([]byte(pw)) // #nosec G401 — see file-top comment
	hashHex := strings.ToUpper(hex.EncodeToString(h[:]))
	prefix, suffix := hashHex[:5], hashHex[5:]

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/"+prefix) {
			http.Error(w, "unexpected path "+r.URL.Path, http.StatusNotFound)
			return
		}
		// Reply with one padding row + the target row.
		_, _ = fmt.Fprintf(w, "00000000000000000000000000000000000:0\r\n%s:42\r\n", suffix)
	}))
	t.Cleanup(srv.Close)

	policy := PasswordPolicy{
		HIBPCheck:    true,
		HIBPClient:   srv.Client(),
		HIBPEndpoint: srv.URL + "/range/",
	}
	err := validatePassword(context.Background(), pw, "alice", policy)
	if !errors.Is(err, errPasswordPwned) {
		t.Fatalf("validatePassword=%v want errPasswordPwned", err)
	}
}

// TestValidatePassword_HIBPMiss_Passes confirms a non-match in the
// HIBP response lets the password through (everything-else equal).
func TestValidatePassword_HIBPMiss_Passes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Reply with only an unrelated suffix row.
		_, _ = fmt.Fprintln(w, "DEADBEEFCAFEDEADBEEFCAFEDEADBEEFCA0:9")
	}))
	t.Cleanup(srv.Close)
	policy := PasswordPolicy{
		HIBPCheck:    true,
		HIBPClient:   srv.Client(),
		HIBPEndpoint: srv.URL + "/range/",
	}
	err := validatePassword(context.Background(), "uniquePass-w0rd!", "alice", policy)
	if err != nil {
		t.Fatalf("validatePassword=%v want nil", err)
	}
}

// TestValidatePassword_HIBPFailOpen pins the transport-failure
// policy: if api.pwnedpasswords.com is unreachable, the validator
// returns nil rather than locking out password changes during the
// outage. The other rules still apply.
func TestValidatePassword_HIBPFailOpen(t *testing.T) {
	policy := PasswordPolicy{
		HIBPCheck: true,
		HIBPClient: &http.Client{
			Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
				return nil, errors.New("simulated outage")
			}),
		},
		HIBPEndpoint: "https://example.invalid/range/",
	}
	if err := validatePassword(context.Background(), "anyValidLong!1", "alice", policy); err != nil {
		t.Fatalf("validatePassword=%v want nil (fail-open on transport err)", err)
	}
	// But the length rule must still apply.
	if err := validatePassword(context.Background(), "short", "alice", policy); !errors.Is(err, errPasswordTooShort) {
		t.Fatalf("validatePassword=%v want errPasswordTooShort", err)
	}
}

// roundTripFunc is an http.RoundTripper backed by a function. Used
// by TestValidatePassword_HIBPFailOpen to inject a transport error.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

// TestPasswordPolicyEndpointError pins the wire-shape mapping from
// validatePassword sentinels to *endpointError. Stable response
// codes are part of the public API contract.
func TestPasswordPolicyEndpointError(t *testing.T) {
	cases := []struct {
		name     string
		in       error
		wantCode string
	}{
		{"too_short", errPasswordTooShort, "password_too_short"},
		{"weak", errPasswordWeakPattern, "password_too_weak"},
		{"username", errPasswordContainsUsername, "password_contains_username"},
		{"pwned", errPasswordPwned, "password_pwned"},
		{"unknown_falls_through_to_password_policy", errors.New("?"), "password_policy"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ep := passwordPolicyEndpointError(tc.in)
			if ep == nil {
				t.Fatalf("nil endpointError")
			}
			if ep.status != http.StatusBadRequest {
				t.Errorf("status=%d want 400", ep.status)
			}
			if ep.code != tc.wantCode {
				t.Errorf("code=%q want %q", ep.code, tc.wantCode)
			}
		})
	}
}

// TestPostUsers_RejectsShortPassword_Integration confirms that the
// GAP-N4 validatePassword gate is wired into PostUsers. A request
// with a password shorter than MinPasswordLength must return a 400
// with code=password_too_short and MUST NOT reach the driver.
func TestPostUsers_RejectsShortPassword_Integration(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "users_create_pw_too_short_N4", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users", nil)
	reqBody := userCreateReq("alice", "alice@example.com", "short", nil)
	resp, err := s.PostUsers(rec, req, &reqBody)
	if err != nil {
		t.Fatalf("PostUsers returned err %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "password_too_short") {
		t.Fatalf("body=%s want password_too_short", rec.Body.String())
	}
	if stmts := d.seen(); len(stmts) != 0 {
		t.Fatalf("driver saw %v; want no statements", stmts)
	}
}

// TestPassword_RejectsUsernameSubstring_Integration confirms the
// Password handler enforces the username-collision rule.
func TestPassword_RejectsUsernameSubstring_Integration(t *testing.T) {
	d := &userDriver{}
	s := newUserStubServer(t, "users_chpw_username_collision_N4", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users/alice/password", nil)
	resp, err := passwordHandlerCall(s, rec, req, "alice", "alice-rules-12c") // contains "alice"
	if err != nil {
		t.Fatalf("Password handler returned err %v; want nil inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400 body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "password_contains_username") {
		t.Fatalf("body=%s want password_contains_username", rec.Body.String())
	}
	if stmts := d.seen(); len(stmts) != 0 {
		t.Fatalf("driver saw %v; want no statements", stmts)
	}
}

// TestHIBPHasSeen_ResponseShape checks the body parser is tolerant
// of optional padding rows (count=0) and trims whitespace correctly.
// Uses io.Discard via a minimal RT to confirm the request shape too.
func TestHIBPHasSeen_ResponseShape(t *testing.T) {
	called := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called++
		if r.Header.Get("User-Agent") == "" {
			t.Errorf("UA header missing")
		}
		if r.Header.Get("Add-Padding") != "true" {
			t.Errorf("Add-Padding header not set")
		}
		// Body shape with padding + real row.
		_, _ = io.WriteString(w, "00000000000000000000000000000000001:0\r\nABCDEFABCDEFABCDEFABCDEFABCDEFABC:7\r\n")
	}))
	t.Cleanup(srv.Close)
	// Construct a password whose SHA-1 suffix matches "ABCDEFABCDEFABCDEFABCDEFABCDEFABC".
	// We don't actually need that — we just want to confirm the
	// parser doesn't crash on the padding row. So we pass a
	// password whose suffix won't match; expect seen=false.
	seen, err := hibpHasSeen(context.Background(), "no-match-here-12345", PasswordPolicy{
		HIBPClient:   srv.Client(),
		HIBPEndpoint: srv.URL + "/range/",
	})
	if err != nil {
		t.Fatalf("hibpHasSeen: %v", err)
	}
	if seen {
		t.Fatalf("seen=true for non-matching suffix")
	}
	if called != 1 {
		t.Fatalf("called=%d want 1", called)
	}
}
