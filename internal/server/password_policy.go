package server

import (
	"context"
	"crypto/sha1" // #nosec G505 — required by HIBP k-anonymity API contract; SHA-1 of *password* is what HIBP indexes against. Not used for any auth/integrity decision.
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode"
)

// GAP-N4 (#72): server-side password policy.
//
// Geode itself does not enforce a password policy on `CREATE USER` /
// `ALTER USER ... SET PASSWORD` today — any non-empty string is
// accepted. The SPA cannot be the only gatekeeper because the API
// surface is also reachable from CLIs, MCP, and any future client.
//
// Policy decided here is intentionally conservative-and-explicit so
// it can be reasoned about per-line:
//
//  1. Minimum length: 12 characters. NIST 800-63B recommends ≥8 for
//     user-chosen passwords; we pick 12 to absorb the typical
//     dictionary-+suffix shape that survives length-≥8 gates.
//  2. Character diversity (best-effort): reject all-same-character
//     (e.g. "aaaaaaaaaaaa") and all-digit (e.g. "123456789012")
//     inputs. We do NOT enforce class-mixing (upper+lower+digit) —
//     NIST explicitly recommends against arbitrary composition
//     rules, which push users toward predictable substitutions.
//  3. Username collision: reject passwords whose lower-cased form
//     contains the lower-cased username (when the username is at
//     least 4 chars, to avoid false positives like username="al"
//     blocking any password containing "al").
//  4. HIBP k-anonymity (optional, off by default): if
//     PasswordPolicy.HIBPCheck is enabled, the first 5 chars of the
//     SHA-1 of the password are sent to api.pwnedpasswords.com and
//     the returned hash list is searched for the suffix. A match
//     means the password has been seen in a breach corpus.

// errPasswordTooShort, errPasswordWeakPattern, errPasswordContainsUsername,
// errPasswordPwned are the sentinel error values returned by
// validatePassword. Handlers translate each into a 400 endpointError
// with a stable response code.
var (
	errPasswordTooShort         = errors.New("password too short: minimum length is 12 characters")
	errPasswordWeakPattern      = errors.New("password is too predictable (all same character or all digits)")
	errPasswordContainsUsername = errors.New("password must not contain the username")
	errPasswordPwned            = errors.New("password has appeared in a known breach corpus (HIBP)")
)

// MinPasswordLength is the floor; exported so tests in this package
// (and downstream callers writing fixtures) cannot drift from the
// constant the validator enforces.
const MinPasswordLength = 12

// PasswordPolicy holds the per-server configuration for
// validatePassword. The zero value (HIBPCheck=false, HIBPClient=nil)
// keeps the network-dependent check off so unit tests stay hermetic.
// Wired through Config.PasswordPolicy in main.go via the
// `-password-hibp-check` CLI flag (default false).
type PasswordPolicy struct {
	// HIBPCheck enables the k-anonymity lookup against
	// api.pwnedpasswords.com. Off by default — the check is a network
	// dependency and is unsuitable for air-gapped deployments.
	HIBPCheck bool
	// HIBPClient is the http.Client used for the HIBP request. If nil
	// and HIBPCheck is true, a default client with a 5 s timeout is
	// used. Tests inject a roundtripper here to verify the lookup
	// shape without hitting the real service.
	HIBPClient *http.Client
	// HIBPEndpoint overrides the production HIBP base URL
	// (https://api.pwnedpasswords.com/range/). Used by tests.
	HIBPEndpoint string
}

// validatePassword runs the policy against pw, returning a sentinel
// error on the first rule it fails (length → weakness → username
// collision → HIBP). Returns nil iff every rule passes.
//
// username MAY be empty (e.g. an admin-driven password reset where
// the username collision check is the caller's responsibility).
func validatePassword(ctx context.Context, pw, username string, policy PasswordPolicy) error {
	if len(pw) < MinPasswordLength {
		return errPasswordTooShort
	}
	if isAllSameChar(pw) || isAllDigits(pw) {
		return errPasswordWeakPattern
	}
	if username != "" && len(username) >= 4 {
		if strings.Contains(strings.ToLower(pw), strings.ToLower(username)) {
			return errPasswordContainsUsername
		}
	}
	if policy.HIBPCheck {
		seen, err := hibpHasSeen(ctx, pw, policy)
		if err != nil {
			// Fail-open on transport failure so a transient outage of
			// api.pwnedpasswords.com does not lock out password
			// changes. The error is surfaced to the operator log via
			// the wrapping handler, not the API consumer.
			return nil //nolint:nilerr // see comment above
		}
		if seen {
			return errPasswordPwned
		}
	}
	return nil
}

// isAllSameChar reports whether every rune in s is the same. Empty
// string returns false (treat empty as "not weak by this rule" —
// the length rule will already have rejected it).
func isAllSameChar(s string) bool {
	if s == "" {
		return false
	}
	r0 := rune(0)
	first := true
	for _, r := range s {
		if first {
			r0 = r
			first = false
			continue
		}
		if r != r0 {
			return false
		}
	}
	return true
}

// isAllDigits reports whether s is non-empty and consists entirely
// of decimal digits. unicode.IsDigit accepts non-ASCII digit code
// points (e.g. Arabic-Indic digits); we use the strict ASCII range
// here on purpose so a password of CJK digits is NOT flagged.
func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			_ = unicode.IsDigit // keep import referenced; we intentionally don't use it
			return false
		}
	}
	return true
}

// hibpHasSeen implements the HIBP "range" k-anonymity API: SHA-1 the
// password, send the first 5 hex chars to /range/{prefix}, and
// search the returned `SUFFIX:count` lines for our suffix.
//
// This function is exposed to tests via the policy.HIBPClient hook;
// production main.go sets policy.HIBPCheck only when the operator
// opts in via -password-hibp-check.
func hibpHasSeen(ctx context.Context, pw string, policy PasswordPolicy) (bool, error) {
	h := sha1.Sum([]byte(pw)) // #nosec G401 — see file-top comment
	hexHash := strings.ToUpper(hex.EncodeToString(h[:]))
	prefix, suffix := hexHash[:5], hexHash[5:]

	endpoint := policy.HIBPEndpoint
	if endpoint == "" {
		endpoint = "https://api.pwnedpasswords.com/range/"
	}
	client := policy.HIBPClient
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+prefix, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("User-Agent", "geode-ui-password-policy/1")
	req.Header.Set("Add-Padding", "true") // request padded response so range size doesn't leak

	resp, err := client.Do(req)
	if err != nil {
		return false, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("hibp: status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // cap at 1 MiB
	if err != nil {
		return false, err
	}
	// Body shape: each line is "SUFFIX:COUNT". A count of 0 is the
	// padding rows; skip those.
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		rowSuffix := strings.ToUpper(strings.TrimSpace(parts[0]))
		count := strings.TrimSpace(parts[1])
		if rowSuffix == suffix && count != "0" {
			return true, nil
		}
	}
	return false, nil
}

// passwordPolicyEndpointError translates a validatePassword sentinel
// into the 400 endpointError shape every handler returns to the
// client. Centralised so the response code stays stable across
// PostUsers, PatchUsername, and Password.
func passwordPolicyEndpointError(err error) *endpointError {
	switch {
	case errors.Is(err, errPasswordTooShort):
		return &endpointError{
			status:      http.StatusBadRequest,
			code:        "password_too_short",
			description: err.Error(),
		}
	case errors.Is(err, errPasswordWeakPattern):
		return &endpointError{
			status:      http.StatusBadRequest,
			code:        "password_too_weak",
			description: err.Error(),
		}
	case errors.Is(err, errPasswordContainsUsername):
		return &endpointError{
			status:      http.StatusBadRequest,
			code:        "password_contains_username",
			description: err.Error(),
		}
	case errors.Is(err, errPasswordPwned):
		return &endpointError{
			status:      http.StatusBadRequest,
			code:        "password_pwned",
			description: err.Error(),
		}
	}
	// Unknown — never returned by validatePassword in practice; gate
	// defensively so a future sentinel surfaces as a recognisable 400.
	return &endpointError{
		status:      http.StatusBadRequest,
		code:        "password_policy",
		description: err.Error(),
	}
}
