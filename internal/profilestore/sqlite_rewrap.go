package profilestore

import (
	"context"
	"fmt"
)

// Rewrapper is the SEC-NEW-8 (#211) optional Store interface for the
// `-profilestore-rewrap-from <hex>` startup sweep. The implementation
// re-seals every encrypted column under the store's active cipher
// after decrypting with the supplied legacy cipher.
type Rewrapper interface {
	RewrapSensitiveColumns(ctx context.Context, prev *Cipher) (RewrapResult, error)
}

// RewrapResult is the SEC-NEW-8 (#211) RewrapSensitiveColumns summary
// surfaced in startup logs so an operator can confirm what the sweep
// actually touched. RowsTouched is the count of profiles that had at
// least one re-sealed column; SealsRewritten is the total re-sealed
// columns across all rows. SkippedPlaintext counts legacy plaintext
// columns the sweep left alone (those will be re-sealed by the next
// Patch through the row — back-fill is out of scope here).
type RewrapResult struct {
	RowsTouched      int
	SealsRewritten   int
	SkippedPlaintext int
}

// RewrapSensitiveColumns walks every profile row and re-seals the four
// encrypted columns (dsn, tls_ca_pem, tls_cert_pem, tls_key_pem) under
// the receiver's cipher. Sealed bytes that decrypt cleanly under prev
// are re-encrypted under s.cipher; raw plaintext bytes (legacy rows
// from before encryption rolled out) are left alone so the read path's
// dispatch on IsCiphertext continues to handle them. Returns a counts
// summary and an error if any decrypt-under-prev failure happened
// (that means a row was sealed under a third key, which is the
// "operator pointed -profilestore-rewrap-from at the wrong secret"
// fail-loud case).
//
// RewrapSensitiveColumns is the implementation backing the
// `-profilestore-rewrap-from <hex>` one-shot startup sweep wired in
// cmd/server/app.go. It uses the single-writer handle so it serialises
// correctly with any concurrent profile CRUD (in practice the sweep
// runs before the listener is accepting traffic, so there is no
// concurrent writer — but the serialisation makes the operation safe
// even if an operator chose to re-run it on a hot deployment).
func (s *sqliteStore) RewrapSensitiveColumns(ctx context.Context, prev *Cipher) (RewrapResult, error) {
	var res RewrapResult
	if s.cipher == nil {
		return res, fmt.Errorf("profilestore: rewrap: store was not opened with a cipher")
	}
	if prev == nil {
		return res, fmt.Errorf("profilestore: rewrap: prev cipher is required")
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, dsn, tls_ca_pem, tls_cert_pem, tls_key_pem
		FROM profiles
		ORDER BY id
	`)
	if err != nil {
		return res, fmt.Errorf("profilestore: rewrap: select: %w", err)
	}
	type rewrap struct {
		id                          string
		dsn, caPem, certPem, keyPem []byte
		changed                     bool
	}
	var todo []rewrap
	for rows.Next() {
		var r rewrap
		if err := rows.Scan(&r.id, &r.dsn, &r.caPem, &r.certPem, &r.keyPem); err != nil {
			_ = rows.Close()
			return res, fmt.Errorf("profilestore: rewrap: scan: %w", err)
		}
		todo = append(todo, r)
	}
	if err := rows.Close(); err != nil {
		return res, fmt.Errorf("profilestore: rewrap: rows.Close: %w", err)
	}
	if err := rows.Err(); err != nil {
		return res, fmt.Errorf("profilestore: rewrap: rows.Err: %w", err)
	}
	// Phase 2: per-row attempt to re-seal each encrypted column.
	for i := range todo {
		r := &todo[i]
		for _, col := range []*[]byte{&r.dsn, &r.caPem, &r.certPem, &r.keyPem} {
			val := *col
			if !IsCiphertext(val) {
				// Legacy plaintext row — leave it alone. The next Patch
				// through this row re-encrypts under the active cipher.
				if len(val) > 0 {
					res.SkippedPlaintext++
				}
				continue
			}
			resealed, err := s.cipher.Rewrap(prev, val)
			if err != nil {
				return res, fmt.Errorf("profilestore: rewrap: row id=%s: %w", r.id, err)
			}
			*col = resealed
			r.changed = true
			res.SealsRewritten++
		}
		if r.changed {
			res.RowsTouched++
		}
	}
	// Phase 3: write back the touched rows. Wrap in a transaction so a
	// partial failure can't leave half a row reseaaled.
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return res, fmt.Errorf("profilestore: rewrap: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, r := range todo {
		if !r.changed {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE profiles
			SET dsn = ?, tls_ca_pem = ?, tls_cert_pem = ?, tls_key_pem = ?,
				updated_at = strftime('%s', 'now')
			WHERE id = ?
		`, r.dsn, r.caPem, r.certPem, r.keyPem, r.id); err != nil {
			return res, fmt.Errorf("profilestore: rewrap: update id=%s: %w", r.id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return res, fmt.Errorf("profilestore: rewrap: commit: %w", err)
	}
	return res, nil
}
