// QUAL/SEC issue 241: cross-stack profile-name normalisation contract test.
//
// The TS-side SPA normaliser lives inside ProfileEditorModal.tsx
// (`s.normalize('NFKC').trim().toLowerCase()`); the Go-side authority
// is NormalizeProfileName in this package. Both MUST produce the same
// canonical form for every input. This test pins the Go side against
// contracts/profile-name-normalization.contract.json; the matching TS
// test (src/components/profiles/normalizeProfileName.contract.test.ts)
// pins the SPA side against the same vectors.

package profilestore

import (
	"context"
	"encoding/json/v2"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"geodedb.com/geode-ui/internal/conn"
)

type normVector struct {
	Description string `json:"description"`
	Input       string `json:"input"`
	Expected    string `json:"expected"`
}

type normContract struct {
	Version   int          `json:"version"`
	Operation string       `json:"operation"`
	Vectors   []normVector `json:"vectors"`
}

func readNormalizationContract(t *testing.T) normContract {
	t.Helper()
	_, here, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	contractPath := filepath.Join(filepath.Dir(here), "..", "..", "contracts", "profile-name-normalization.contract.json")
	raw, err := os.ReadFile(contractPath)
	if err != nil {
		t.Fatalf("read contract %s: %v", contractPath, err)
	}
	var c normContract
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatalf("parse contract: %v", err)
	}
	if len(c.Vectors) == 0 {
		t.Fatal("contract has no vectors")
	}
	return c
}

func TestNormalizeProfileName_Contract(t *testing.T) {
	c := readNormalizationContract(t)
	for _, v := range c.Vectors {
		v := v
		t.Run(v.Description, func(t *testing.T) {
			got := NormalizeProfileName(v.Input)
			if got != v.Expected {
				t.Fatalf("NormalizeProfileName(%q) = %q, contract = %q — "+
					"update the matching helper in "+
					"src/components/profiles/ProfileEditorModal.tsx if the "+
					"Go side has the new authority, or fix the Go side if the "+
					"TS side does",
					v.Input, got, v.Expected)
			}
		})
	}
}

// TestNormalizeProfileName_DuplicateBypassClosed pins the SECURITY-side
// effect: with the server-side normalised duplicate check in place
// (sqlite.go::checkNormalizedNameUnique), a programmatic caller cannot
// POST a name that would have been a duplicate under the SPA's
// nameIsDuplicate but slips past the BINARY UNIQUE constraint.
func TestNormalizeProfileName_DuplicateBypassClosed(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ctx := context.Background()

	// First profile uses composed-é + capital initial; the second
	// attempts the decomposed-é + lowercase variant. Both forms
	// normalise to the same string, but the byte representations
	// differ — pre-fix, the second INSERT succeeded because the
	// BINARY UNIQUE on `name` saw two distinct strings.
	first := conn.Profile{
		Scope: conn.ProfileScopePersonal,
		Name:  "Café", // composed-é (U+00E9)
		DSN:   "quic://h:1",
	}
	if _, err := store.Put(ctx, first); err != nil {
		t.Fatalf("Put first: %v", err)
	}
	second := conn.Profile{
		Scope: conn.ProfileScopePersonal,
		Name:  "café", // decomposed-é (U+0065 U+0301), lower-cased
		DSN:   "quic://h:2",
	}
	_, putErr := store.Put(ctx, second)
	if putErr == nil {
		t.Fatal("expected ErrConflict on NFKC-equivalent duplicate, got nil")
	}
	if !errors.Is(putErr, ErrConflict) {
		t.Fatalf("expected ErrConflict, got %v", putErr)
	}

	// Case-only duplicate also blocked.
	caseOnly := conn.Profile{
		Scope: conn.ProfileScopePersonal,
		Name:  "CAFÉ",
		DSN:   "quic://h:3",
	}
	_, caseErr := store.Put(ctx, caseOnly)
	if caseErr == nil || !errors.Is(caseErr, ErrConflict) {
		t.Fatalf("expected ErrConflict on case-only duplicate, got %v", caseErr)
	}
}
