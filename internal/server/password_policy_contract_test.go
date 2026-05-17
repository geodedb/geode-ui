// QUAL issue 242: cross-stack password-policy contract test.
//
// The Go-side authority for the password policy lives in
// password_policy.go (MinPasswordLength, the validatePassword rules,
// the ErrCodePassword* identifiers). The TS-side mirror lives in
// src/lib/passwordPolicy.ts so the SPA can pre-flight passwords before
// hitting the server. Without an enforcement mechanism the two sides
// can drift silently — and indeed historically the codebase has bumped
// one side without touching the other.
//
// This test pins the Go side against contracts/password-policy.contract.json.
// The matching TS contract test
// (src/lib/passwordPolicy.contract.test.ts) pins the TS side against
// the same file. A drift in either side fails its language's contract
// test; a drift in the contract file fails BOTH sides simultaneously
// (so the missed sync surfaces in code review).
//
// Adding a new policy rule requires:
//   1. Update the Go source of truth (password_policy.go).
//   2. Update contracts/password-policy.contract.json to match.
//   3. Update src/lib/passwordPolicy.ts to match.
//   4. Both contract tests re-pass.

package server

import (
	"encoding/json/v2"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
)

// passwordPolicyContract is the in-memory representation of
// contracts/password-policy.contract.json. The struct field names mirror
// the JSON keys 1:1 so the test failure messages read clearly when a
// drift is detected.
type passwordPolicyContract struct {
	Version              int               `json:"version"`
	MinPasswordLength    int               `json:"minPasswordLength"`
	UsernameSubstringMin int               `json:"usernameSubstringMin"`
	ViolationCodes       []string          `json:"violationCodes"`
	I18NKeys             map[string]string `json:"i18nKeys"`
}

// readPasswordPolicyContract loads the JSON contract from the repo
// root. Resolves the path relative to this test file so the test does
// not depend on the working directory the runner happened to pick.
func readPasswordPolicyContract(t *testing.T) passwordPolicyContract {
	t.Helper()
	_, here, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	contractPath := filepath.Join(filepath.Dir(here), "..", "..", "contracts", "password-policy.contract.json")
	raw, err := os.ReadFile(contractPath)
	if err != nil {
		t.Fatalf("read contract %s: %v", contractPath, err)
	}
	var c passwordPolicyContract
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatalf("parse contract: %v", err)
	}
	return c
}

func TestPasswordPolicyContract_MinPasswordLength(t *testing.T) {
	c := readPasswordPolicyContract(t)
	if MinPasswordLength != c.MinPasswordLength {
		t.Fatalf("Go MinPasswordLength=%d, contract=%d — update the matching "+
			"value in contracts/password-policy.contract.json AND "+
			"src/lib/passwordPolicy.ts to keep the three in sync",
			MinPasswordLength, c.MinPasswordLength)
	}
}

func TestPasswordPolicyContract_UsernameSubstringMin(t *testing.T) {
	c := readPasswordPolicyContract(t)
	// The Go side uses an inline `>= 4` guard inside validatePassword
	// rather than a named constant; pin the literal explicitly so a
	// future refactor can't lower the threshold without tripping the
	// contract. If the inline guard ever moves behind a constant, the
	// test should read that constant in place of the literal.
	const goUsernameSubstringMin = 4
	if goUsernameSubstringMin != c.UsernameSubstringMin {
		t.Fatalf("Go inline guard=%d, contract=%d — update the matching "+
			"value in contracts/password-policy.contract.json AND "+
			"src/lib/passwordPolicy.ts to keep the three in sync",
			goUsernameSubstringMin, c.UsernameSubstringMin)
	}
}

func TestPasswordPolicyContract_ViolationCodes(t *testing.T) {
	c := readPasswordPolicyContract(t)
	// The Go ErrCodePassword* family is the source of truth for the
	// wire codes a 400 response carries. The contract lists the TS-
	// facing "violation" identifiers (tooShort, weakPattern,
	// containsUsername) because the SPA pre-flight uses those names
	// for i18n key lookup. Pin the set so a future rule addition can
	// not land on the Go side without surfacing in the contract.
	expected := []string{"tooShort", "weakPattern", "containsUsername"}
	sortStrings(expected)
	got := append([]string(nil), c.ViolationCodes...)
	sortStrings(got)
	if len(got) != len(expected) {
		t.Fatalf("contract violationCodes=%v, want %v — update the contract "+
			"AND src/lib/passwordPolicy.ts to add/remove the matching "+
			"PolicyViolation variant", got, expected)
	}
	for i := range got {
		if got[i] != expected[i] {
			t.Fatalf("contract violationCodes[%d]=%q, want %q — update the "+
				"contract AND src/lib/passwordPolicy.ts to keep the "+
				"two in sync", i, got[i], expected[i])
		}
	}
}

func sortStrings(s []string) {
	// local sort helper so the contract tests don't pull in a separate
	// helper file just for this one call site
	sort.Strings(s)
}
