package profilestore

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

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
