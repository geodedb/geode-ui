// QUAL/SEC issue 241: cross-stack profile-name normalisation authority.
//
// The TS-side `nameIsDuplicate` in ProfileEditorModal.tsx applies
// `s.normalize('NFKC').trim().toLowerCase()` before comparing candidate
// profile names against the existing set, which gates the Save button
// and the inline duplicate-name hint. Until this file landed, the Go
// authoritative path (sqlite UNIQUE on (scope, owner_user_id, name)
// with default BINARY collation) compared raw bytes. That left a CSRF-
// / direct-API bypass: a programmatic caller could POST two profiles
// that the SPA UI considered duplicates ("Production" / "production",
// or composed-é / decomposed-é) and the server accepted both because
// neither byte-string matched the other.
//
// NormalizeProfileName is the Go-side mirror of the TS normalisation.
// It is exported so handlers, the profile store, and any future
// importer (seed JSON, MCP tool) can run names through the same
// canonical form. The result is what the duplicate check compares
// AGAINST the existing rows' normalised names; we still store the
// caller-supplied display form on disk so the UI can preserve the
// user's capitalisation/spacing on render.

package profilestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/text/unicode/norm"

	"geodedb.com/geode-ui/internal/conn"
)

// NormalizeProfileName returns the canonical form of a profile name for
// uniqueness comparison:
//
//  1. Unicode NFKC normalisation (so composed/decomposed code points
//     compare equal: café/café, ﬁle/file, etc.). NFKC also folds
//     compatibility characters (fullwidth digits, ligatures) which is
//     what the TS `s.normalize('NFKC')` call delivers.
//  2. trim leading/trailing whitespace (so "  prod  " == "prod").
//  3. lowercase (so "Production" == "production").
//
// The function is pure and panic-free for arbitrary UTF-8 input; an
// invalid UTF-8 sequence flows through unchanged because the underlying
// norm package preserves bytes that don't form valid code points.
//
// MUST stay byte-equivalent to the TS norm() helper inside
// src/components/profiles/ProfileEditorModal.tsx (`s.normalize('NFKC')
// .trim().toLowerCase()`). The QUAL issue 242 contract pattern is
// extended here for issue 241: a paired test
// (TestNormalizeProfileName_Contract) reads
// contracts/profile-name-normalization.contract.json and asserts the Go
// normaliser produces the expected output for every input vector. The
// matching TS test (src/components/profiles/normalizeProfileName.contract.test.ts)
// runs the SPA normaliser against the same vectors. Any divergence
// fails one side; a vector edit in the contract file fails both.
func NormalizeProfileName(name string) string {
	// NFKC first so trim/lower run over the canonical code point form.
	// Trim AFTER NFKC because NFKC may convert a non-breaking space
	// (U+00A0) or a fullwidth space (U+3000) to a normal space, which
	// strings.TrimSpace then strips. strings.ToLower last because
	// Unicode case-folding interacts with combining marks; running it
	// on the already-normalised form keeps the result stable.
	n := norm.NFKC.String(name)
	n = strings.TrimSpace(n)
	n = strings.ToLower(n)
	return n
}

// queryRowContext is the surface checkNormalizedNameUniqueTx needs from
// either *sql.DB or *sql.Tx so the helper can run either inline (Put)
// or inside an open transaction (Patch).
type queryRowContext interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// checkNormalizedNameUnique pre-flights the (scope, owner_user_id,
// normalized-name) uniqueness invariant before a Put. Returns
// ErrConflict if another row in the same (scope, owner) bucket has a
// name that normalises to the same canonical form.
//
// QUAL/SEC issue 241: this is the *application-level* enforcement of the
// invariant the SPA's nameIsDuplicate guards. The schema's UNIQUE
// (scope, owner_user_id, name) constraint is a backstop against pure
// byte-collision (`Production` twice), but it does NOT defend against
// NFKC / case bypass — that's what this helper does.
func (s *sqliteStore) checkNormalizedNameUnique(ctx context.Context, scope conn.ProfileScope, ownerUserID, name, excludeID string) error {
	return checkNormalizedNameUnique(ctx, s.db, scope, ownerUserID, name, excludeID)
}

// checkNormalizedNameUniqueTx is the Tx-scoped variant used by Patch so
// the comparison and the subsequent UPDATE share the same SQLite
// transaction (read-modify-write atomicity under SetMaxOpenConns(1) is
// already enforced by the single-connection pool, but matching tx scope
// keeps the contract explicit).
func (s *sqliteStore) checkNormalizedNameUniqueTx(ctx context.Context, tx *sql.Tx, scope conn.ProfileScope, ownerUserID, name, excludeID string) error {
	return checkNormalizedNameUnique(ctx, tx, scope, ownerUserID, name, excludeID)
}

func checkNormalizedNameUnique(ctx context.Context, q queryRowContext, scope conn.ProfileScope, ownerUserID, name, excludeID string) error {
	wanted := NormalizeProfileName(name)
	// Listing the (scope, owner) bucket scans only the profiles that
	// could possibly collide. The profile store's typical size (tens
	// to low-hundreds per owner) makes the Go-side comparison cheap;
	// SQL collations cannot express NFKC, so the comparison has to
	// happen in Go.
	rows, err := q.QueryContext(ctx,
		`SELECT id, name FROM profiles WHERE scope = ? AND owner_user_id = ?`,
		string(scope), ownerUserID)
	if err != nil {
		return fmt.Errorf("profilestore: dup check: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var id, existing string
		if err := rows.Scan(&id, &existing); err != nil {
			return fmt.Errorf("profilestore: dup check scan: %w", err)
		}
		if id == excludeID {
			continue
		}
		if NormalizeProfileName(existing) == wanted {
			return fmt.Errorf("%w: scope=%s name=%s (normalises to %q matching existing %q)",
				ErrConflict, scope, name, wanted, existing)
		}
	}
	if err := rows.Err(); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("profilestore: dup check rows: %w", err)
	}
	return nil
}
