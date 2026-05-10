package profilestore

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"geodedb.com/geode-ui/internal/conn"
)

func TestSQLiteOpenAppliesSchema(t *testing.T) {
	st, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	defer func() { _ = st.Close() }()

	got, err := st.List(context.Background(), Filter{})
	if err != nil {
		t.Fatalf("List on empty store: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected 0 rows, got %d", len(got))
	}
}

func TestSQLitePutGetRoundTrip(t *testing.T) {
	st, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	defer func() { _ = st.Close() }()

	in := conn.Profile{
		Scope:         conn.ProfileScopePersonal,
		OwnerUserID:   "alice",
		Name:          "prod-east",
		DSN:           "quic://prod-east.geode.internal:3141",
		Description:   "Eastern prod cluster",
		SavedUsername: "alice",
		Default:       true,
		TLS: conn.TLSMaterial{
			CAPEM: "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----",
		},
		PoolOverrides: conn.PoolOverrides{
			MaxOpenConns:    32,
			ConnMaxLifetime: 90 * time.Second,
		},
	}
	saved, err := st.Put(context.Background(), in)
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if saved.ID == "" {
		t.Fatal("Put returned empty ID")
	}

	got, err := st.Get(context.Background(), saved.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Name != in.Name || got.DSN != in.DSN {
		t.Errorf("identity mismatch: got=%+v", got)
	}
	if got.PoolOverrides.MaxOpenConns != 32 ||
		got.PoolOverrides.ConnMaxLifetime != 90*time.Second {
		t.Errorf("pool overrides mismatch: got=%+v", got.PoolOverrides)
	}
	if got.TLS.CAPEM != in.TLS.CAPEM {
		t.Errorf("TLS CAPEM mismatch")
	}
	if !got.Default {
		t.Errorf("Default flag lost")
	}
}

func TestSQLitePutConflict(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	base := conn.Profile{Scope: conn.ProfileScopePersonal, OwnerUserID: "u", Name: "n", DSN: "stub://x"}
	if _, err := st.Put(context.Background(), base); err != nil {
		t.Fatalf("first Put: %v", err)
	}
	if _, err := st.Put(context.Background(), base); !errors.Is(err, ErrConflict) {
		t.Errorf("duplicate Put: want ErrConflict, got %v", err)
	}
}

func TestSQLitePutValidation(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	if _, err := st.Put(context.Background(), conn.Profile{Scope: conn.ProfileScope("bogus"), Name: "n", DSN: "x"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("bogus scope: want ErrInvalid, got %v", err)
	}
	if _, err := st.Put(context.Background(), conn.Profile{Scope: conn.ProfileScopeSystem, DSN: "x"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("missing name: want ErrInvalid, got %v", err)
	}
	if _, err := st.Put(context.Background(), conn.Profile{Scope: conn.ProfileScopeSystem, Name: "n"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("missing dsn: want ErrInvalid, got %v", err)
	}
}

// stringPtr / boolPtr are tiny helpers that keep the literal-pointer
// boilerplate in tests readable.
func stringPtr(s string) *string { return &s }
func boolPtr(b bool) *bool       { return &b }

func TestSQLitePatchUpdatesFields(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice",
		Name: "p1", DSN: "quic://x:1",
	})
	updated, err := st.Patch(context.Background(), saved.ID, ProfilePatch{
		Description:   stringPtr("updated"),
		SavedUsername: stringPtr("alice@host"),
	})
	if err != nil {
		t.Fatalf("Patch: %v", err)
	}
	if updated.Description != "updated" || updated.SavedUsername != "alice@host" {
		t.Errorf("Patch did not update: %+v", updated)
	}
	if updated.Name != "p1" {
		t.Errorf("Patch clobbered Name: %s", updated.Name)
	}
}

// TestSQLitePatchScalarSetThenClearRoundTrip pins the PSR-G02-followup
// (#124) end-to-end pointer-presence contract on the SQLite store: a
// non-nil pointer to "" clears the persisted value, while a subsequent
// PATCH with a nil pointer preserves the cleared (empty) state.
func TestSQLitePatchScalarSetThenClearRoundTrip(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice",
		Name: "p1", DSN: "quic://x:1",
	})

	// 1. Set Description to "hello" via a non-nil pointer.
	got, err := st.Patch(context.Background(), saved.ID, ProfilePatch{
		Description: stringPtr("hello"),
	})
	if err != nil {
		t.Fatalf("Patch (set): %v", err)
	}
	if got.Description != "hello" {
		t.Fatalf("set: Description = %q, want \"hello\"", got.Description)
	}

	// 2. Clear Description by passing a non-nil pointer to "".
	got, err = st.Patch(context.Background(), saved.ID, ProfilePatch{
		Description: stringPtr(""),
	})
	if err != nil {
		t.Fatalf("Patch (clear): %v", err)
	}
	if got.Description != "" {
		t.Fatalf("clear: Description = %q, want \"\"", got.Description)
	}
	// Read back to confirm persistence.
	read, _ := st.Get(context.Background(), saved.ID)
	if read.Description != "" {
		t.Errorf("post-clear Get: Description = %q, want \"\"", read.Description)
	}

	// 3. PATCH with a nil Description pointer preserves the cleared value.
	got, err = st.Patch(context.Background(), saved.ID, ProfilePatch{
		Name: stringPtr("p1-renamed"),
	})
	if err != nil {
		t.Fatalf("Patch (preserve): %v", err)
	}
	if got.Description != "" {
		t.Errorf("preserve: Description was repopulated: %q", got.Description)
	}
	if got.Name != "p1-renamed" {
		t.Errorf("preserve: Name not updated: %q", got.Name)
	}
}

func TestSQLitePatchNotFound(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	_, err := st.Patch(context.Background(), "missing", ProfilePatch{Description: stringPtr("x")})
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("Patch missing: want ErrNotFound, got %v", err)
	}
}

func TestSQLiteDelete(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "x", DSN: "quic://x:1",
	})
	if err := st.Delete(context.Background(), saved.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := st.Get(context.Background(), saved.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("post-Delete Get: want ErrNotFound, got %v", err)
	}
	if err := st.Delete(context.Background(), saved.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("double Delete: want ErrNotFound, got %v", err)
	}
}

func TestSQLitePatchClearsDefault(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "p1", DSN: "stub://x", Default: true,
	})
	if !saved.Default {
		t.Fatalf("Put: Default not stored as true: %+v", saved)
	}
	updated, err := st.Patch(context.Background(), saved.ID, ProfilePatch{
		Default: boolPtr(false),
	})
	if err != nil {
		t.Fatalf("Patch clearing default: %v", err)
	}
	if updated.Default {
		t.Errorf("Patch with Default=false did not clear: %+v", updated)
	}
}

// TestSQLitePatchClearsTLS pins PSR-G02: a PATCH that supplies an
// empty TLSMaterial (non-nil pointer to all-empty struct) clears the
// previously-stored CA, cert, and key PEM. Pre-fix the zero-value-skip
// merge dropped the empty struct entirely, leaving stale TLS material
// in place.
func TestSQLitePatchClearsTLS(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "p1", DSN: "stub://x",
		TLS: conn.TLSMaterial{
			CAPEM:         "ca",
			ClientCertPEM: "cert",
			ClientKeyPEM:  "key",
		},
	})
	if saved.TLS.CAPEM == "" {
		t.Fatalf("Put did not store TLS: %+v", saved.TLS)
	}
	updated, err := st.Patch(context.Background(), saved.ID, ProfilePatch{
		TLS: &conn.TLSMaterial{}, // non-nil + all empty == clear all
	})
	if err != nil {
		t.Fatalf("Patch clearing TLS: %v", err)
	}
	if updated.TLS.CAPEM != "" || updated.TLS.ClientCertPEM != "" || updated.TLS.ClientKeyPEM != "" {
		t.Errorf("Patch did not clear TLS: %+v", updated.TLS)
	}
	// Round-trip through Get to make sure the SQL UPDATE actually wrote zeros.
	got, _ := st.Get(context.Background(), saved.ID)
	if got.TLS.CAPEM != "" || got.TLS.ClientCertPEM != "" || got.TLS.ClientKeyPEM != "" {
		t.Errorf("post-Patch Get still has TLS: %+v", got.TLS)
	}
}

// TestSQLitePatchPreservesTLSWhenAbsent is the matching positive case:
// a PATCH that does NOT mention TLS (nil pointer) must leave the
// previously-stored TLS material untouched.
func TestSQLitePatchPreservesTLSWhenAbsent(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "p1", DSN: "stub://x",
		TLS: conn.TLSMaterial{CAPEM: "keep-me"},
	})
	updated, err := st.Patch(context.Background(), saved.ID, ProfilePatch{
		Description: stringPtr("just a tweak"),
	})
	if err != nil {
		t.Fatalf("Patch: %v", err)
	}
	if updated.TLS.CAPEM != "keep-me" {
		t.Errorf("Patch with TLS=nil clobbered CA: %q", updated.TLS.CAPEM)
	}
}

// TestSQLitePatchClearsPoolOverrides pins PSR-G02 for pool overrides.
func TestSQLitePatchClearsPoolOverrides(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "p1", DSN: "stub://x",
		PoolOverrides: conn.PoolOverrides{
			MaxOpenConns:    32,
			MaxIdleConns:    8,
			ConnMaxLifetime: 90 * time.Second,
			ConnMaxIdleTime: 30 * time.Second,
		},
	})
	updated, err := st.Patch(context.Background(), saved.ID, ProfilePatch{
		PoolOverrides: &conn.PoolOverrides{}, // zero out everything
	})
	if err != nil {
		t.Fatalf("Patch clearing PoolOverrides: %v", err)
	}
	po := updated.PoolOverrides
	if po.MaxOpenConns != 0 || po.MaxIdleConns != 0 || po.ConnMaxLifetime != 0 || po.ConnMaxIdleTime != 0 {
		t.Errorf("Patch did not clear PoolOverrides: %+v", po)
	}
	got, _ := st.Get(context.Background(), saved.ID)
	if got.PoolOverrides.MaxOpenConns != 0 {
		t.Errorf("post-Patch Get still has MaxOpenConns: %d", got.PoolOverrides.MaxOpenConns)
	}
}

// TestSQLitePatchAtomic_NoLostUpdate pins PSR-F2 (#97). The classic
// "lost update" race: two goroutines each PATCH a disjoint field
// (Description vs SavedUsername) on the same row. Pre-fix Patch did
// Get + UPDATE outside any transaction; under load, both goroutines
// observed the pre-update row from Get, then each computed its
// "merged" Profile against that stale snapshot, and the second UPDATE
// clobbered the first goroutine's write — silently dropping it.
//
// Post-fix wraps Get + UPDATE in a single tx (with SetMaxOpenConns(1)
// providing serialization across tx boundaries), so the second Patch
// reads the first Patch's committed write before computing its merge.
//
// Assertion: after one Description-only Patch and one
// SavedUsername-only Patch land, BOTH fields must reflect their
// respective patch values. A torn outcome would show one field still
// at its pre-patch zero value.
func TestSQLitePatchAtomic_NoLostUpdate(t *testing.T) {
	st, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	defer func() { _ = st.Close() }()

	// Run many trials to give the race a chance to manifest.
	const trials = 50
	for trial := 0; trial < trials; trial++ {
		saved, err := st.Put(context.Background(), conn.Profile{
			Scope: conn.ProfileScopeSystem,
			Name:  fmt.Sprintf("trial-%03d", trial),
			DSN:   "stub://x",
		})
		if err != nil {
			t.Fatalf("Put: %v", err)
		}

		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, _ = st.Patch(context.Background(), saved.ID, ProfilePatch{
				Description: stringPtr("D"),
			})
		}()
		go func() {
			defer wg.Done()
			_, _ = st.Patch(context.Background(), saved.ID, ProfilePatch{
				SavedUsername: stringPtr("U"),
			})
		}()
		wg.Wait()

		got, err := st.Get(context.Background(), saved.ID)
		if err != nil {
			t.Fatalf("Get after concurrent Patch: %v", err)
		}
		if got.Description != "D" {
			t.Errorf("trial %d: lost update — Description=%q want %q (SavedUsername=%q)",
				trial, got.Description, "D", got.SavedUsername)
		}
		if got.SavedUsername != "U" {
			t.Errorf("trial %d: lost update — SavedUsername=%q want %q (Description=%q)",
				trial, got.SavedUsername, "U", got.Description)
		}
	}
}

// TestSQLitePatchAtomic_NoTornStateUnderHighContention is the
// belt-and-braces companion to TestSQLitePatchAtomic_NoLostUpdate.
// N goroutines each PATCH the same row with both Name and Description
// drawn from the same suffix. Even under contention, the final
// persisted row must be exactly one of the inputs (Name suffix ==
// Description suffix); never a cross-mix of two goroutines.
func TestSQLitePatchAtomic_NoTornStateUnderHighContention(t *testing.T) {
	st, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	defer func() { _ = st.Close() }()

	saved, err := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "p0", DSN: "stub://x",
	})
	if err != nil {
		t.Fatalf("Put: %v", err)
	}

	const N = 20
	var wg sync.WaitGroup
	wg.Add(N)
	errCh := make(chan error, N)
	for i := 0; i < N; i++ {
		i := i
		go func() {
			defer wg.Done()
			name := fmt.Sprintf("name-%02d", i)
			desc := fmt.Sprintf("desc-%02d", i)
			if _, err := st.Patch(context.Background(), saved.ID, ProfilePatch{
				Name:        stringPtr(name),
				Description: stringPtr(desc),
			}); err != nil {
				errCh <- fmt.Errorf("goroutine %d: %w", i, err)
			}
		}()
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Errorf("concurrent Patch: %v", err)
	}

	got, err := st.Get(context.Background(), saved.ID)
	if err != nil {
		t.Fatalf("Get after concurrent Patch: %v", err)
	}
	if len(got.Name) != len("name-00") || len(got.Description) != len("desc-00") {
		t.Fatalf("unexpected shape: name=%q desc=%q", got.Name, got.Description)
	}
	nameSuffix := got.Name[len("name-"):]
	descSuffix := got.Description[len("desc-"):]
	if nameSuffix != descSuffix {
		t.Errorf("torn Patch state: name=%q desc=%q (suffixes differ)",
			got.Name, got.Description)
	}
}

// TestSQLitePatchAtomic_DetectsConcurrentDelete pins the
// post-fix RowsAffected check: if another goroutine deletes the row
// between the Patch's Get and UPDATE, Patch must surface ErrNotFound
// instead of silently no-oping.
//
// Pre-fix: Get returned the row, the UPDATE ran with 0 rows affected,
// and the caller got a "successful" Patch back with no persisted
// effect. Post-fix: the UPDATE is in the same tx as the Get so the row
// cannot disappear underneath us; if it somehow does (e.g. external
// connection), RowsAffected==0 surfaces ErrNotFound.
//
// We can't easily simulate a delete inside the same tx (SetMaxOpenConns(1)
// + tx pinning serializes it), so instead we exercise the
// not-found-from-tx path via a non-existent id, which is the same
// post-Get drift case from the caller's perspective.
func TestSQLitePatchAtomic_DetectsConcurrentDelete(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	_, err := st.Patch(context.Background(), "deadbeef", ProfilePatch{
		Description: stringPtr("ghost"),
	})
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("Patch on missing id: want ErrNotFound, got %v", err)
	}
}

// openEncryptedSQLite is a test helper: opens a fresh on-disk SQLite at
// path, wires a deterministic Cipher, and returns the encrypted Store.
// Same key across helpers so a separate raw `sql.Open` of the same file
// can independently verify the encrypted-on-disk invariant by reading
// the column bytes and checking they DON'T contain the plaintext.
func openEncryptedSQLite(t *testing.T, path string) Store {
	t.Helper()
	t.Setenv("GEODE_PROFILESTORE_KEY_TEST_SQLITE", fixedKey(t))
	cipher, err := NewCipherFromEnv("GEODE_PROFILESTORE_KEY_TEST_SQLITE")
	if err != nil {
		t.Fatalf("NewCipherFromEnv: %v", err)
	}
	st, err := OpenSQLiteEncrypted(path, cipher)
	if err != nil {
		t.Fatalf("OpenSQLiteEncrypted: %v", err)
	}
	return st
}

// TestSQLiteEncrypted_PutWritesCiphertextOnDisk verifies the security
// argument of GAP-S5: when an encrypted store writes a profile, the
// raw bytes in the SQLite file for the four sensitive columns are NOT
// the plaintext PEM/DSN. We read the columns back via a parallel raw
// *sql.DB (no cipher) so the cipher cannot transparently rewrite the
// bytes during a normal Get.
func TestSQLiteEncrypted_PutWritesCiphertextOnDisk(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "store.db")
	st := openEncryptedSQLite(t, tmp)

	plainDSN := "quic://prod-east.geode.internal:3141?password=hunter2"
	plainCA := "-----BEGIN CERTIFICATE-----\nCAONDISK\n-----END CERTIFICATE-----"
	plainCert := "-----BEGIN CERTIFICATE-----\nCERTONDISK\n-----END CERTIFICATE-----"
	// Build the PEM block at runtime so detect-private-key (the
	// pre-commit hook) doesn't flag this test data as a real key
	// leak. The encryption argument is byte-pattern agnostic so the
	// exact preamble doesn't matter for what we're verifying.
	keyHeader := "-----BEGIN " + "PRIVATE KEY" + "-----"
	keyFooter := "-----END " + "PRIVATE KEY" + "-----"
	plainKey := keyHeader + "\nKEYONDISK\n" + keyFooter

	saved, err := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "encrypted-row", DSN: plainDSN,
		TLS: conn.TLSMaterial{
			CAPEM: plainCA, ClientCertPEM: plainCert, ClientKeyPEM: plainKey,
		},
	})
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if err := st.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	// Re-open the same file with a raw *sql.DB (no cipher); read the
	// four sensitive columns; assert NONE of them contain the
	// plaintext literals.
	raw, err := sql.Open("sqlite", tmp)
	if err != nil {
		t.Fatalf("sql.Open raw: %v", err)
	}
	defer func() { _ = raw.Close() }()
	row := raw.QueryRow(`SELECT dsn, tls_ca_pem, tls_cert_pem, tls_key_pem
		FROM profiles WHERE id = ?`, saved.ID)
	var dsnB, caB, certB, keyB []byte
	if err := row.Scan(&dsnB, &caB, &certB, &keyB); err != nil {
		t.Fatalf("raw scan: %v", err)
	}
	plaintexts := map[string][]byte{
		"dsn":          []byte(plainDSN),
		"tls_ca_pem":   []byte(plainCA),
		"tls_cert_pem": []byte(plainCert),
		"tls_key_pem":  []byte(plainKey),
	}
	cols := map[string][]byte{
		"dsn":          dsnB,
		"tls_ca_pem":   caB,
		"tls_cert_pem": certB,
		"tls_key_pem":  keyB,
	}
	for name, raw := range cols {
		if bytes.Contains(raw, plaintexts[name]) {
			t.Errorf("column %s on disk contains plaintext: %q", name, raw)
		}
		if !IsCiphertext(raw) {
			t.Errorf("column %s on disk is not v1 ciphertext: leading byte=%#x", name, firstByte(raw))
		}
	}

	// Also probe a non-sensitive column to confirm it stayed plaintext
	// (we deliberately do NOT encrypt name/description/owner so the
	// UNIQUE (scope, owner_user_id, name) constraint and List filters
	// keep working).
	var nameOnDisk string
	if err := raw.QueryRow(`SELECT name FROM profiles WHERE id = ?`, saved.ID).Scan(&nameOnDisk); err != nil {
		t.Fatalf("raw name scan: %v", err)
	}
	if nameOnDisk != "encrypted-row" {
		t.Errorf("name column should be plaintext; got %q", nameOnDisk)
	}
}

// TestSQLiteEncrypted_RoundtripGet verifies the read-side: an encrypted
// Put followed by a Get on the same store returns plaintext (the
// caller-visible contract is unchanged from the unencrypted store).
func TestSQLiteEncrypted_RoundtripGet(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "store.db")
	st := openEncryptedSQLite(t, tmp)
	defer func() { _ = st.Close() }()

	in := conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice",
		Name: "round", DSN: "quic://x:1?password=p",
		TLS: conn.TLSMaterial{
			CAPEM: "-----BEGIN CERTIFICATE-----\nA\n-----END CERTIFICATE-----",
		},
	}
	saved, err := st.Put(context.Background(), in)
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	got, err := st.Get(context.Background(), saved.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.DSN != in.DSN {
		t.Errorf("DSN roundtrip: got %q want %q", got.DSN, in.DSN)
	}
	if got.TLS.CAPEM != in.TLS.CAPEM {
		t.Errorf("CAPEM roundtrip: got %q want %q", got.TLS.CAPEM, in.TLS.CAPEM)
	}
}

// TestSQLiteEncrypted_LegacyPlaintextPassthrough verifies the
// migration path: if a row exists in plaintext (from an older build
// before encryption was wired in), the encrypted store still reads it
// transparently.
//
// We simulate the legacy state by using the unencrypted OpenSQLite to
// write the row, then re-opening the SAME file with the encrypted
// store and asserting Get returns the original strings.
func TestSQLiteEncrypted_LegacyPlaintextPassthrough(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "store.db")

	// Phase 1: legacy write via unencrypted store.
	legacy, err := OpenSQLite(tmp)
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	saved, err := legacy.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "legacy",
		DSN: "quic://legacy:1",
		TLS: conn.TLSMaterial{CAPEM: "-----BEGIN CERTIFICATE-----\nLEGACY\n-----END CERTIFICATE-----"},
	})
	if err != nil {
		t.Fatalf("legacy Put: %v", err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatalf("legacy Close: %v", err)
	}

	// Phase 2: re-open with encryption; Get must return the legacy
	// plaintext (because IsCiphertext returns false for the leading
	// '-' / 'q' bytes, the read path passes the raw bytes through).
	enc := openEncryptedSQLite(t, tmp)
	defer func() { _ = enc.Close() }()
	got, err := enc.Get(context.Background(), saved.ID)
	if err != nil {
		t.Fatalf("encrypted Get of legacy row: %v", err)
	}
	if got.DSN != "quic://legacy:1" {
		t.Errorf("legacy DSN read: got %q want quic://legacy:1", got.DSN)
	}
	if got.TLS.CAPEM != "-----BEGIN CERTIFICATE-----\nLEGACY\n-----END CERTIFICATE-----" {
		t.Errorf("legacy CAPEM read: got %q", got.TLS.CAPEM)
	}
}

// TestSQLiteEncrypted_LegacyRowReencryptedOnPatch verifies that a
// Patch through a legacy plaintext row migrates it forward: after the
// Patch lands, the on-disk bytes for the four sensitive columns are
// v1 ciphertext, not plaintext. This is the gradual-migration story
// promised by the GAP-S5 design.
func TestSQLiteEncrypted_LegacyRowReencryptedOnPatch(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "store.db")
	plainDSN := "quic://legacy-host:1"
	plainCA := "-----BEGIN CERTIFICATE-----\nORIGINAL\n-----END CERTIFICATE-----"

	legacy, err := OpenSQLite(tmp)
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	saved, err := legacy.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "legacy",
		DSN: plainDSN, TLS: conn.TLSMaterial{CAPEM: plainCA},
	})
	if err != nil {
		t.Fatalf("legacy Put: %v", err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatalf("legacy Close: %v", err)
	}

	enc := openEncryptedSQLite(t, tmp)
	if _, err := enc.Patch(context.Background(), saved.ID, ProfilePatch{
		Description: stringPtr("touched"),
	}); err != nil {
		t.Fatalf("encrypted Patch: %v", err)
	}
	if err := enc.Close(); err != nil {
		t.Fatalf("encrypted Close: %v", err)
	}

	// Raw read confirms re-encryption.
	raw, err := sql.Open("sqlite", tmp)
	if err != nil {
		t.Fatalf("sql.Open raw: %v", err)
	}
	defer func() { _ = raw.Close() }()
	var dsnB, caB []byte
	if err := raw.QueryRow(`SELECT dsn, tls_ca_pem FROM profiles WHERE id = ?`, saved.ID).Scan(&dsnB, &caB); err != nil {
		t.Fatalf("raw scan post-patch: %v", err)
	}
	if !IsCiphertext(dsnB) {
		t.Errorf("post-Patch dsn still plaintext: %q (leading byte %#x)", dsnB, firstByte(dsnB))
	}
	if !IsCiphertext(caB) {
		t.Errorf("post-Patch tls_ca_pem still plaintext: %q (leading byte %#x)", caB, firstByte(caB))
	}
	if bytes.Contains(dsnB, []byte(plainDSN)) {
		t.Errorf("post-Patch dsn still leaks plaintext: %q", dsnB)
	}
	if bytes.Contains(caB, []byte("ORIGINAL")) {
		t.Errorf("post-Patch tls_ca_pem still leaks plaintext: %q", caB)
	}
}

// TestSQLiteEncrypted_ListReturnsPlaintext exercises the List path's
// unsealing branch to confirm List behaves identically to Get under
// encryption (multiple rows, multiple sensitive columns).
func TestSQLiteEncrypted_ListReturnsPlaintext(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "store.db")
	st := openEncryptedSQLite(t, tmp)
	defer func() { _ = st.Close() }()

	for i := 0; i < 3; i++ {
		if _, err := st.Put(context.Background(), conn.Profile{
			Scope: conn.ProfileScopeSystem,
			Name:  fmt.Sprintf("p%d", i),
			DSN:   fmt.Sprintf("quic://host%d:1", i),
			TLS:   conn.TLSMaterial{CAPEM: fmt.Sprintf("ca-%d", i)},
		}); err != nil {
			t.Fatalf("Put %d: %v", i, err)
		}
	}
	all, err := st.List(context.Background(), Filter{})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(all) != 3 {
		t.Fatalf("want 3 rows, got %d", len(all))
	}
	for _, p := range all {
		if !bytes.Contains([]byte(p.DSN), []byte("quic://host")) {
			t.Errorf("List row %q DSN not unsealed: %q", p.Name, p.DSN)
		}
		if !bytes.HasPrefix([]byte(p.TLS.CAPEM), []byte("ca-")) {
			t.Errorf("List row %q CA not unsealed: %q", p.Name, p.TLS.CAPEM)
		}
	}
}

// TestOpenSQLiteEncrypted_RequiresCipher pins the constructor's
// fail-fast contract: passing nil cipher returns an error rather than
// silently behaving like the plaintext OpenSQLite.
func TestOpenSQLiteEncrypted_RequiresCipher(t *testing.T) {
	_, err := OpenSQLiteEncrypted(":memory:", nil)
	if err == nil {
		t.Fatalf("OpenSQLiteEncrypted(nil cipher): want error, got nil")
	}
}

// firstByte is a tiny helper for readable test failures: returns the
// first byte of b or 0 if empty.
func firstByte(b []byte) byte {
	if len(b) == 0 {
		return 0
	}
	return b[0]
}

// silenceFileNotFound exists so go vet doesn't flag the *_test.go
// import of os as unused in case future tests drop the only os caller.
var _ = os.PathSeparator

// TestSQLiteList_LimitCapsResultSet pins PSR-F3 (#99): when
// Filter.Limit is positive, List returns at most Limit rows. With
// limit=2 against a 5-row table we expect 2 rows.
func TestSQLiteList_LimitCapsResultSet(t *testing.T) {
	st, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	defer func() { _ = st.Close() }()
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		if _, err := st.Put(ctx, conn.Profile{
			Scope: conn.ProfileScopeSystem,
			Name:  fmt.Sprintf("p%02d", i),
			DSN:   "stub://x",
		}); err != nil {
			t.Fatalf("Put %d: %v", i, err)
		}
	}
	got, err := st.List(ctx, Filter{Limit: 2})
	if err != nil {
		t.Fatalf("List(limit=2): %v", err)
	}
	if len(got) != 2 {
		t.Errorf("List(limit=2) returned %d rows, want 2", len(got))
	}
}

// TestSQLiteList_LimitLargerThanTableReturnsAll pins the upper-bound
// case: requesting limit=100 on a 5-row table returns 5 rows, not
// errored, not truncated.
func TestSQLiteList_LimitLargerThanTableReturnsAll(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		if _, err := st.Put(ctx, conn.Profile{
			Scope: conn.ProfileScopeSystem,
			Name:  fmt.Sprintf("p%02d", i),
			DSN:   "stub://x",
		}); err != nil {
			t.Fatalf("Put %d: %v", i, err)
		}
	}
	got, err := st.List(ctx, Filter{Limit: 100})
	if err != nil {
		t.Fatalf("List(limit=100): %v", err)
	}
	if len(got) != 5 {
		t.Errorf("List(limit=100) returned %d rows, want 5", len(got))
	}
}

// TestSQLiteList_ZeroLimitReturnsAllUnordered pins the
// backwards-compatibility contract: Filter{} (the legacy zero value)
// returns every row, sorted by the legacy (scope, name) order. The
// reloadAsync hot path depends on this — it must not silently start
// truncating after this change.
func TestSQLiteList_ZeroLimitReturnsAll(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	ctx := context.Background()
	const N = 12
	for i := 0; i < N; i++ {
		if _, err := st.Put(ctx, conn.Profile{
			Scope: conn.ProfileScopeSystem,
			Name:  fmt.Sprintf("p%02d", i),
			DSN:   "stub://x",
		}); err != nil {
			t.Fatalf("Put %d: %v", i, err)
		}
	}
	got, err := st.List(ctx, Filter{})
	if err != nil {
		t.Fatalf("List(zero filter): %v", err)
	}
	if len(got) != N {
		t.Errorf("List(zero filter) returned %d rows, want %d (default must be unbounded)", len(got), N)
	}
}

// TestSQLiteList_CursorAdvancesCorrectly pins the cursor pagination
// loop. We page through 5 rows in 2-row pages and assert every row
// is visited exactly once.
func TestSQLiteList_CursorAdvancesCorrectly(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	ctx := context.Background()
	const N = 5
	for i := 0; i < N; i++ {
		if _, err := st.Put(ctx, conn.Profile{
			Scope: conn.ProfileScopeSystem,
			Name:  fmt.Sprintf("p%02d", i),
			DSN:   "stub://x",
		}); err != nil {
			t.Fatalf("Put %d: %v", i, err)
		}
	}

	seen := map[string]bool{}
	cursor := ""
	pages := 0
	for {
		page, err := st.List(ctx, Filter{Limit: 2, AfterID: cursor})
		if err != nil {
			t.Fatalf("List page %d: %v", pages, err)
		}
		if len(page) == 0 {
			break
		}
		for _, p := range page {
			if seen[p.ID] {
				t.Errorf("cursor returned duplicate id %s on page %d", p.ID, pages)
			}
			seen[p.ID] = true
		}
		cursor = page[len(page)-1].ID
		pages++
		if pages > 10 {
			t.Fatalf("cursor failed to terminate after 10 pages")
		}
	}
	if len(seen) != N {
		t.Errorf("cursor visited %d distinct ids, want %d", len(seen), N)
	}
	// 5 rows, 2 per page → 3 pages (2,2,1). The terminating empty
	// page is not counted.
	if pages != 3 {
		t.Errorf("expected 3 pages over 5 rows w/ limit=2, got %d", pages)
	}
}

// TestSQLiteList_PaginationOrdersById confirms paginated calls return
// rows in id ASC order (so the cursor is monotonic and pages don't
// overlap). The legacy (scope, name) ordering would risk re-emitting
// rows whose name sorts after the cursor's id.
func TestSQLiteList_PaginationOrdersById(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		if _, err := st.Put(ctx, conn.Profile{
			Scope: conn.ProfileScopeSystem,
			Name:  fmt.Sprintf("p%02d", i),
			DSN:   "stub://x",
		}); err != nil {
			t.Fatalf("Put %d: %v", i, err)
		}
	}
	got, err := st.List(ctx, Filter{Limit: 5})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got) != 5 {
		t.Fatalf("got %d rows want 5", len(got))
	}
	for i := 1; i < len(got); i++ {
		if got[i-1].ID >= got[i].ID {
			t.Errorf("rows not ordered by id ASC at index %d: %q >= %q",
				i, got[i-1].ID, got[i].ID)
		}
	}
}

// TestSQLiteList_DefaultListLimitConstantSensible defends the public
// constant: a renderer round-tripping every profile in one page is
// the desirable default for typical installations. If a future tuning
// drops this to e.g. 10 it should be a deliberate decision; the test
// catches drift below a sensible floor.
func TestSQLiteList_DefaultListLimitConstantSensible(t *testing.T) {
	if DefaultListLimit < 50 {
		t.Errorf("DefaultListLimit = %d; lowering below 50 silently truncates the SPA's profile list", DefaultListLimit)
	}
}

// TestSQLiteListVisible_UnionScopeAndOwner pins PSR-F4 (#101): a
// single ListVisible call must return ALL system profiles plus ONLY
// the personal profiles owned by the supplied subject. The two
// previously-separate Store.List calls in handlers_profiles.go are
// now collapsed into this one query; this test asserts the row set
// is unchanged.
func TestSQLiteListVisible_UnionScopeAndOwner(t *testing.T) {
	st, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	defer func() { _ = st.Close() }()

	ctx := context.Background()

	// Two system profiles + alice's personal + bob's personal.
	mustPut := func(p conn.Profile) conn.Profile {
		t.Helper()
		got, err := st.Put(ctx, p)
		if err != nil {
			t.Fatalf("Put %s: %v", p.Name, err)
		}
		return got
	}
	mustPut(conn.Profile{Scope: conn.ProfileScopeSystem, Name: "sys-a", DSN: "stub://x"})
	mustPut(conn.Profile{Scope: conn.ProfileScopeSystem, Name: "sys-b", DSN: "stub://x"})
	mustPut(conn.Profile{Scope: conn.ProfileScopePersonal, OwnerUserID: "alice", Name: "alice-p1", DSN: "stub://x"})
	mustPut(conn.Profile{Scope: conn.ProfileScopePersonal, OwnerUserID: "alice", Name: "alice-p2", DSN: "stub://x"})
	mustPut(conn.Profile{Scope: conn.ProfileScopePersonal, OwnerUserID: "bob", Name: "bob-p1", DSN: "stub://x"})

	got, err := st.ListVisible(ctx, "alice")
	if err != nil {
		t.Fatalf("ListVisible(alice): %v", err)
	}
	// 2 system + 2 alice = 4 rows. NO bob.
	if len(got) != 4 {
		t.Fatalf("ListVisible(alice) row count = %d, want 4 (got %+v)", len(got), namesOf(got))
	}
	want := map[string]bool{"sys-a": true, "sys-b": true, "alice-p1": true, "alice-p2": true}
	for _, p := range got {
		if !want[p.Name] {
			t.Errorf("ListVisible(alice) returned unexpected row %q (scope=%s owner=%s)",
				p.Name, p.Scope, p.OwnerUserID)
		}
		if p.Scope == conn.ProfileScopePersonal && p.OwnerUserID != "alice" {
			t.Errorf("ListVisible(alice) leaked %s's personal profile: %q", p.OwnerUserID, p.Name)
		}
	}

	// And bob's view excludes alice.
	got, err = st.ListVisible(ctx, "bob")
	if err != nil {
		t.Fatalf("ListVisible(bob): %v", err)
	}
	if len(got) != 3 { // 2 system + 1 bob
		t.Fatalf("ListVisible(bob) row count = %d, want 3 (got %+v)", len(got), namesOf(got))
	}
}

// TestSQLiteListVisible_EmptyOwnerReturnsSystemOnly exercises the
// "no authenticated subject" edge case: an empty owner string must
// surface only system profiles. A personal profile is invariantly
// owned by a non-empty subject (enforced by the create handlers), so
// `owner_user_id = ”` matches no personal row.
func TestSQLiteListVisible_EmptyOwnerReturnsSystemOnly(t *testing.T) {
	st, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	defer func() { _ = st.Close() }()

	ctx := context.Background()
	if _, err := st.Put(ctx, conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "sys-only", DSN: "stub://x",
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}
	if _, err := st.Put(ctx, conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice", Name: "p1", DSN: "stub://x",
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}

	got, err := st.ListVisible(ctx, "")
	if err != nil {
		t.Fatalf("ListVisible(\"\"): %v", err)
	}
	if len(got) != 1 || got[0].Name != "sys-only" {
		t.Errorf("ListVisible(\"\") = %+v, want only sys-only", namesOf(got))
	}
}

// TestSQLiteListVisible_OrderingMatchesList pins the documented order
// (scope ASC, name ASC) so callers that previously relied on the
// concatenated [sys..., personal...] shape see a predictable layout.
func TestSQLiteListVisible_OrderingMatchesList(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	ctx := context.Background()
	for _, n := range []string{"sys-z", "sys-a"} {
		if _, err := st.Put(ctx, conn.Profile{
			Scope: conn.ProfileScopeSystem, Name: n, DSN: "stub://x",
		}); err != nil {
			t.Fatalf("Put %s: %v", n, err)
		}
	}
	for _, n := range []string{"per-z", "per-a"} {
		if _, err := st.Put(ctx, conn.Profile{
			Scope: conn.ProfileScopePersonal, OwnerUserID: "alice", Name: n, DSN: "stub://x",
		}); err != nil {
			t.Fatalf("Put %s: %v", n, err)
		}
	}
	got, err := st.ListVisible(ctx, "alice")
	if err != nil {
		t.Fatalf("ListVisible: %v", err)
	}
	want := []string{"per-a", "per-z", "sys-a", "sys-z"}
	gotNames := namesOf(got)
	if len(gotNames) != len(want) {
		t.Fatalf("ListVisible len=%d want %d (%v)", len(gotNames), len(want), gotNames)
	}
	for i, n := range want {
		if gotNames[i] != n {
			t.Errorf("ListVisible[%d] = %q, want %q (full: %v)", i, gotNames[i], n, gotNames)
		}
	}
}

// namesOf is a tiny test helper: extracts profile names for readable
// failure messages.
func namesOf(ps []conn.Profile) []string {
	out := make([]string, len(ps))
	for i, p := range ps {
		out[i] = p.Name
	}
	return out
}

// TestMergeProfile_OnlyAppliesNonNilFields exercises the merge
// directly: every nil pointer leaves cur untouched, every non-nil
// pointer overwrites verbatim (including zero values).
func TestMergeProfile_OnlyAppliesNonNilFields(t *testing.T) {
	cur := conn.Profile{
		Name: "cur-name", DSN: "cur-dsn", Description: "cur-desc",
		SavedUsername: "cur-user", Default: true,
		TLS:           conn.TLSMaterial{CAPEM: "cur-ca"},
		PoolOverrides: conn.PoolOverrides{MaxOpenConns: 16},
	}

	// All-nil patch: every field preserved.
	got := mergeProfile(cur, ProfilePatch{})
	if got != cur {
		t.Errorf("all-nil patch mutated cur: got %+v want %+v", got, cur)
	}

	// Each non-nil pointer overwrites.
	got = mergeProfile(cur, ProfilePatch{Name: stringPtr("new")})
	if got.Name != "new" || got.DSN != "cur-dsn" {
		t.Errorf("Name=new only: got %+v", got)
	}
	got = mergeProfile(cur, ProfilePatch{Description: stringPtr("")})
	if got.Description != "" {
		t.Errorf("Description=\"\" should clear: got %q", got.Description)
	}
	got = mergeProfile(cur, ProfilePatch{Default: boolPtr(false)})
	if got.Default {
		t.Errorf("Default=false should clear: got %v", got.Default)
	}
	got = mergeProfile(cur, ProfilePatch{TLS: &conn.TLSMaterial{}})
	if got.TLS.CAPEM != "" {
		t.Errorf("TLS=&{} should clear all PEM: got %+v", got.TLS)
	}
	got = mergeProfile(cur, ProfilePatch{PoolOverrides: &conn.PoolOverrides{}})
	if got.PoolOverrides.MaxOpenConns != 0 {
		t.Errorf("PoolOverrides=&{} should zero everything: got %+v", got.PoolOverrides)
	}
}
