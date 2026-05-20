package server

import (
	"strings"

	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

// NormaliseAdminLookupKey returns the canonical key under which an
// admin username lives in Config.AdminUsernames. NFKC folds Unicode
// compatibility variants (fullwidth latin, ligatures, NFKD-decomposed
// forms); case-folding produces the Unicode-aware lowercase so
// "ＢＯＢ", "BOB", and "bob" all collapse to the same bucket.
//
// Empty / whitespace-only inputs return "". The same canonical form
// is applied at both the ingestion site (cmd/server/app.go's
// buildAdminSet) and the lookup site (handlers_auth.go's
// adminRolesFor), so the bootstrap admin gate cannot fail open or
// closed because of a case / Unicode-normalisation mismatch.
//
// S-NEW-B (#304): CWE-178 — improper case handling in security
// decisions.
func NormaliseAdminLookupKey(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	// NFKC first, then case-fold. Order matters: NFKC may expand a
	// single fullwidth letter into a Latin character that then has a
	// different case-folded form.
	nfkc := norm.NFKC.String(trimmed)
	return cases.Fold().String(nfkc)
}

// normaliseAdminLookupKey is the package-private alias the handler
// uses so the call site reads as a local helper. Public callers
// import the capitalised form.
func normaliseAdminLookupKey(raw string) string { return NormaliseAdminLookupKey(raw) }
