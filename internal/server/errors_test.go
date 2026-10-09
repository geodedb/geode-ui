package server

import (
	"errors"
	"fmt"
	"testing"
)

// fakeStatusClasser implements the unexported `statusClasser`
// interface that `isWireFeatureMissing` and `isAuthError` look for via
// errors.As. It pins the typed-error path so a driver that DOES
// expose StatusClass() bypasses the substring fallback entirely.
type fakeStatusClasser struct {
	cls string
	msg string
}

func (e *fakeStatusClasser) Error() string       { return "fake: " + e.cls + ": " + e.msg }
func (e *fakeStatusClasser) StatusClass() string { return e.cls }

// TestIsWireFeatureMissing_TypedSentinel pins the GAP-Q6 sentinel
// path: callers that wrap errWireFeatureMissing via %w must be
// detected without any substring sniffing.
func TestIsWireFeatureMissing_TypedSentinel(t *testing.T) {
	wrapped := fmt.Errorf("admin DDL refused: %w", errWireFeatureMissing)
	if !isWireFeatureMissing(wrapped) {
		t.Fatalf("wrapped sentinel not detected: %v", wrapped)
	}
	if !errors.Is(wrapped, errWireFeatureMissing) {
		t.Fatalf("errors.Is round-trip failed for %v", wrapped)
	}
	// Bare unrelated error must not match the sentinel.
	bare := errors.New("something else entirely")
	if isWireFeatureMissing(bare) {
		t.Fatalf("bare unrelated error matched sentinel: %v", bare)
	}
}

// TestIsWireFeatureMissing_TypedStatusClass pins the interface-based
// path: a driver-shaped error implementing StatusClass()=="42000"
// short-circuits the substring fallback.
func TestIsWireFeatureMissing_TypedStatusClass(t *testing.T) {
	cases := []struct {
		name string
		cls  string
		want bool
	}{
		{"42000_parse_class_matches", "42000", true},
		{"28000_auth_class_does_not_match", "28000", false},
		{"08p01_password_reset_does_not_match", "08P01", false},
		{"empty_class_does_not_match", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := &fakeStatusClasser{cls: tc.cls, msg: "anything"}
			if got := isWireFeatureMissing(err); got != tc.want {
				t.Fatalf("got=%v want=%v", got, tc.want)
			}
		})
	}
}

// TestIsWireFeatureMissing_PinnedSubstrings exhaustively pins every
// substring listed in `wireFeatureMissingSubstrings`. If a future
// PR adds or removes an entry from that slice without updating
// this test, the suite will fail loudly — that's the point.
func TestIsWireFeatureMissing_PinnedSubstrings(t *testing.T) {
	// Ensure the pinned list is what we expect — defensive read. If
	// you add a substring, add a row in the table below too.
	wantSubstrings := map[string]bool{
		"parse error":         true,
		"expected token":      true,
		"expected identifier": true,
	}
	got := wireFeatureMissingSubstrings()
	if len(got) != len(wantSubstrings) {
		t.Fatalf("wireFeatureMissingSubstrings drift: have %v, expected size %d",
			got, len(wantSubstrings))
	}
	for _, s := range got {
		if !wantSubstrings[s] {
			t.Fatalf("unexpected substring in fallback list: %q (update test if intentional)", s)
		}
	}

	// Each substring, when paired with the 42000 status code, must
	// trigger the predicate. The "42000 alone" and "substring alone"
	// cases must NOT trigger — both signals are required.
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"42000+parse_error_lower", errors.New("geode: 42000: parse error near token"), true},
		{"42000+parse_error_caps", errors.New("GEODE: 42000: PARSE ERROR near"), true}, // case-insensitive
		{"42000+expected_token", errors.New("status_class=42000 message=expected token 'l_paren'"), true},
		{"42000+expected_identifier", errors.New("42000 expected identifier or keyword"), true},

		// Both signals required — neither alone matches.
		{"42000_alone_does_not_match", errors.New("status_class=42000 some other message"), false},
		{"parse_error_alone_does_not_match", errors.New("driver: parse error in client"), false},
		{"expected_token_alone_does_not_match", errors.New("expected token at line 3"), false},

		// Defence-in-depth: completely unrelated errors stay false.
		{"nil_err_is_false", nil, false},
		{"network_err_is_false", errors.New("dial tcp: connection refused"), false},
		{"auth_err_is_false", errors.New("geode: 28000: invalid credentials"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := isWireFeatureMissing(tc.err)
			if got != tc.want {
				t.Fatalf("isWireFeatureMissing(%v)=%v want=%v", tc.err, got, tc.want)
			}
		})
	}
}

// TestWireErr_UpgradesToNotImplementedOnMissingFeature pins the
// integration shape used by every wire-level admin handler: when a
// "feature missing" error reaches `wireErr`, the response is a 501
// `wire_feature_missing`, not a 422 `user_admin_error`. Without
// this pin the typed-vs-substring detection could drift the user-
// facing status code silently.
func TestWireErr_UpgradesToNotImplementedOnMissingFeature(t *testing.T) {
	cases := []struct {
		name       string
		in         error
		wantStatus int
		wantCode   string
	}{
		{
			name:       "sentinel_wrap_yields_501",
			in:         fmt.Errorf("admin: %w", errWireFeatureMissing),
			wantStatus: 501,
			wantCode:   "wire_feature_missing",
		},
		{
			name:       "typed_42000_yields_501",
			in:         &fakeStatusClasser{cls: "42000", msg: "parse error"},
			wantStatus: 501,
			wantCode:   "wire_feature_missing",
		},
		{
			name:       "substring_42000_parse_error_yields_501",
			in:         errors.New("geode: 42000: parse error near 'SHOW'"),
			wantStatus: 501,
			wantCode:   "wire_feature_missing",
		},
		{
			name:       "generic_error_yields_422_user_admin_error",
			in:         errors.New("permission denied"),
			wantStatus: 422,
			wantCode:   "user_admin_error",
		},
		{
			name:       "nil_in_yields_nil_out",
			in:         nil,
			wantStatus: 0,
			wantCode:   "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := wireErr(tc.in)
			if tc.in == nil {
				if got != nil {
					t.Fatalf("wireErr(nil)=%v want nil", got)
				}
				return
			}
			ep := asEndpointError(got)
			if ep == nil {
				t.Fatalf("wireErr(%v) did not return *endpointError, got %T", tc.in, got)
			}
			if ep.status != tc.wantStatus {
				t.Errorf("status=%d want %d", ep.status, tc.wantStatus)
			}
			if ep.code != tc.wantCode {
				t.Errorf("code=%q want %q", ep.code, tc.wantCode)
			}
		})
	}
}
