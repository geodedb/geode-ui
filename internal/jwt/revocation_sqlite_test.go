package jwt

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	jjwt "github.com/golang-jwt/jwt/v5"
	_ "modernc.org/sqlite"
)

// openTestDB opens a SQLite DB at the given DSN with the same
// single-connection model the profile store uses. Pass ":memory:" for
// an ephemeral DB, or a file path for a restart-survival test (the
// caller is responsible for re-opening the same path).
func openTestDB(t *testing.T, dsn string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.ExecContext(context.Background(),
		`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`); err != nil {
		t.Fatalf("pragmas: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func attachedSet(t *testing.T, db *sql.DB) *RevocationSet {
	t.Helper()
	rs := NewRevocationSet()
	if err := rs.AttachSQLite(db); err != nil {
		t.Fatalf("AttachSQLite: %v", err)
	}
	return rs
}

// TestSQLiteRevocation_RevokeByJTI_RoundTrips: Revoke(jti, exp) on a
// SQLite-backed set then IsRevoked returns true for that jti.
func TestSQLiteRevocation_RevokeByJTI_RoundTrips(t *testing.T) {
	rs := attachedSet(t, openTestDB(t, ":memory:"))
	exp := time.Now().Add(time.Hour)
	rs.Revoke("jti-abc", exp)

	c := &Claims{RegisteredClaims: jjwt.RegisteredClaims{ID: "jti-abc"}}
	if !rs.IsRevoked(c) {
		t.Fatal("expected jti-abc to be revoked after Revoke")
	}
	other := &Claims{RegisteredClaims: jjwt.RegisteredClaims{ID: "jti-xyz"}}
	if rs.IsRevoked(other) {
		t.Fatal("a different jti should not be revoked")
	}
}

// TestSQLiteRevocation_JTISurvivesRestart: revoke a jti, "restart" by
// constructing a fresh RevocationSet against the SAME db file, and
// confirm the jti is still revoked.
func TestSQLiteRevocation_JTISurvivesRestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "rev.db")

	db1 := openTestDB(t, dbPath)
	rs1 := attachedSet(t, db1)
	exp := time.Now().Add(2 * time.Hour)
	rs1.Revoke("survivor", exp)
	if !rs1.IsRevoked(&Claims{RegisteredClaims: jjwt.RegisteredClaims{ID: "survivor"}}) {
		t.Fatal("precondition: survivor should be revoked in rs1")
	}
	_ = db1.Close()

	// Fresh process: new DB handle on the same file, new RevocationSet.
	db2 := openTestDB(t, dbPath)
	rs2 := attachedSet(t, db2)
	if !rs2.IsRevoked(&Claims{RegisteredClaims: jjwt.RegisteredClaims{ID: "survivor"}}) {
		t.Fatal("revoked jti did not survive restart")
	}
	// An unrelated jti is still fine.
	if rs2.IsRevoked(&Claims{RegisteredClaims: jjwt.RegisteredClaims{ID: "fresh"}}) {
		t.Fatal("unrelated jti should not be revoked after restart")
	}
}

// TestSQLiteRevocation_ExpiredJTINotLoadedOnRestart: a revoked-jti row
// whose exp is in the past must not be loaded into the cache on restart
// (the token's own TTL guard already rejects it), and the stale row is
// GC'd by load().
func TestSQLiteRevocation_ExpiredJTINotLoadedOnRestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "rev.db")

	db1 := openTestDB(t, dbPath)
	rs1 := attachedSet(t, db1)
	rs1.Revoke("stale", time.Now().Add(-time.Minute)) // already expired
	_ = db1.Close()

	db2 := openTestDB(t, dbPath)
	rs2 := attachedSet(t, db2)
	// Not in cache.
	if _, ok := rs2.revoked.Load("stale"); ok {
		t.Fatal("expired jti should not be loaded into the cache")
	}
	// GC'd from SQLite.
	var n int
	if err := db2.QueryRow(`SELECT COUNT(*) FROM revoked_jti`).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("expected stale row GC'd, found %d rows", n)
	}
}

// TestSQLiteRevocation_RevokeUser_RoundTripsAndSurvivesRestart: after
// RevokeUser(user), a token with iat <= changed_at fails IsRevoked;
// after a "restart" against the same db file it still fails.
func TestSQLiteRevocation_RevokeUser_RoundTripsAndSurvivesRestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "rev.db")

	db1 := openTestDB(t, dbPath)
	rs1 := attachedSet(t, db1)

	// Old token: iat one hour ago, definitely before the revoke instant.
	oldClaims := &Claims{
		Subject: "alice",
		RegisteredClaims: jjwt.RegisteredClaims{
			Subject:  "alice",
			IssuedAt: jjwt.NewNumericDate(time.Now().Add(-time.Hour)),
		},
	}
	if rs1.IsRevoked(oldClaims) {
		t.Fatal("precondition: nothing revoked yet")
	}
	rs1.RevokeUser("alice")
	if !rs1.IsRevoked(oldClaims) {
		t.Fatal("old token should be revoked after RevokeUser")
	}
	// A token issued well after the revoke instant is unaffected.
	freshClaims := &Claims{
		Subject: "alice",
		RegisteredClaims: jjwt.RegisteredClaims{
			Subject:  "alice",
			IssuedAt: jjwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	if rs1.IsRevoked(freshClaims) {
		t.Fatal("a post-change token should validate")
	}
	_ = db1.Close()

	// Restart.
	db2 := openTestDB(t, dbPath)
	rs2 := attachedSet(t, db2)
	if !rs2.IsRevoked(oldClaims) {
		t.Fatal("RevokeUser did not survive restart")
	}
	if rs2.IsRevoked(freshClaims) {
		t.Fatal("post-change token should still validate after restart")
	}
	// A different user is unaffected.
	if rs2.IsRevoked(&Claims{Subject: "bob", RegisteredClaims: jjwt.RegisteredClaims{Subject: "bob", IssuedAt: jjwt.NewNumericDate(time.Now().Add(-time.Hour))}}) {
		t.Fatal("a different user should not be revoked")
	}
}

// TestSQLiteRevocation_Sweep_RemovesFromBothLayers: Sweep deletes
// expired revoked_jti rows and stale password_changed_at rows from
// SQLite AND from the in-memory cache.
func TestSQLiteRevocation_Sweep_RemovesFromBothLayers(t *testing.T) {
	db := openTestDB(t, ":memory:")
	rs := NewRevocationSet()
	now := time.Date(2026, 5, 11, 12, 0, 0, 0, time.UTC)
	rs.nowFn = func() time.Time { return now }
	if err := rs.AttachSQLite(db); err != nil {
		t.Fatalf("AttachSQLite: %v", err)
	}

	rs.Revoke("live", now.Add(time.Hour))    // keep
	rs.Revoke("dead", now.Add(-time.Minute)) // expired — drop
	rs.RevokeUser("recent")                  // changed_at == now — keep (within TTL)
	// A stale user marker: write directly so we control changed_at.
	rs.passwordChangedAt.Store("ancient", now.Add(-48*time.Hour))
	if _, err := db.Exec(`INSERT OR REPLACE INTO password_changed_at (username, changed_at) VALUES (?, ?)`,
		"ancient", now.Add(-48*time.Hour).UnixNano()); err != nil {
		t.Fatalf("seed ancient: %v", err)
	}

	rs.Sweep(24 * time.Hour)

	// Cache.
	if _, ok := rs.revoked.Load("live"); !ok {
		t.Fatal("Sweep dropped a still-valid jti from cache")
	}
	if _, ok := rs.revoked.Load("dead"); ok {
		t.Fatal("Sweep kept an expired jti in cache")
	}
	if _, ok := rs.passwordChangedAt.Load("recent"); !ok {
		t.Fatal("Sweep dropped a recent user marker from cache")
	}
	if _, ok := rs.passwordChangedAt.Load("ancient"); ok {
		t.Fatal("Sweep kept an ancient user marker in cache")
	}

	// SQLite.
	var jtiCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM revoked_jti`).Scan(&jtiCount); err != nil {
		t.Fatalf("count jti: %v", err)
	}
	if jtiCount != 1 {
		t.Fatalf("revoked_jti rows after Sweep = %d, want 1 (only 'live')", jtiCount)
	}
	var liveExists int
	if err := db.QueryRow(`SELECT COUNT(*) FROM revoked_jti WHERE jti = 'live'`).Scan(&liveExists); err != nil {
		t.Fatalf("check live: %v", err)
	}
	if liveExists != 1 {
		t.Fatal("'live' jti missing from SQLite after Sweep")
	}
	var ancientExists int
	if err := db.QueryRow(`SELECT COUNT(*) FROM password_changed_at WHERE username = 'ancient'`).Scan(&ancientExists); err != nil {
		t.Fatalf("check ancient: %v", err)
	}
	if ancientExists != 0 {
		t.Fatal("'ancient' user marker still in SQLite after Sweep")
	}
}

// TestSQLiteRevocation_HotPath_ZeroQueries: after AttachSQLite (which
// does the one-time hydration), IsRevoked must NOT issue any SQL query —
// it reads the in-memory cache only. We instrument the backend's query
// counter and assert it stays at zero across many IsRevoked calls,
// including ones that hit the stale-entry-drop branch.
func TestSQLiteRevocation_HotPath_ZeroQueries(t *testing.T) {
	db := openTestDB(t, ":memory:")
	rs := NewRevocationSet()
	now := time.Date(2026, 5, 11, 12, 0, 0, 0, time.UTC)
	rs.nowFn = func() time.Time { return now }
	if err := rs.AttachSQLite(db); err != nil {
		t.Fatalf("AttachSQLite: %v", err)
	}
	// Seed some state with writes (these DO count — we snapshot after).
	rs.Revoke("revoked-jti", now.Add(time.Hour))
	rs.Revoke("expired-jti", now.Add(-time.Minute)) // will be dropped on first IsRevoked
	rs.RevokeUser("alice")

	queriesBefore := rs.backend.queryCount()
	if queriesBefore == 0 {
		t.Fatal("sanity: the seeding writes should have bumped the query counter")
	}

	// Now hammer IsRevoked across every code path.
	for i := 0; i < 200; i++ {
		// hit: revoked jti
		_ = rs.IsRevoked(&Claims{RegisteredClaims: jjwt.RegisteredClaims{ID: "revoked-jti"}})
		// hit: expired jti (drops the cache entry, must not query SQLite)
		_ = rs.IsRevoked(&Claims{RegisteredClaims: jjwt.RegisteredClaims{ID: "expired-jti"}})
		// miss: unknown jti
		_ = rs.IsRevoked(&Claims{RegisteredClaims: jjwt.RegisteredClaims{ID: "unknown-jti"}})
		// hit: revoked user, old iat
		_ = rs.IsRevoked(&Claims{Subject: "alice", RegisteredClaims: jjwt.RegisteredClaims{Subject: "alice", IssuedAt: jjwt.NewNumericDate(now.Add(-time.Hour))}})
		// miss: revoked user, new iat
		_ = rs.IsRevoked(&Claims{Subject: "alice", RegisteredClaims: jjwt.RegisteredClaims{Subject: "alice", IssuedAt: jjwt.NewNumericDate(now.Add(time.Hour))}})
		// miss: unknown user
		_ = rs.IsRevoked(&Claims{Subject: "bob", RegisteredClaims: jjwt.RegisteredClaims{Subject: "bob", IssuedAt: jjwt.NewNumericDate(now)}})
	}

	if got := rs.backend.queryCount(); got != queriesBefore {
		t.Fatalf("IsRevoked issued %d SQL queries; the hot path must be zero-query (counter %d -> %d)",
			got-queriesBefore, queriesBefore, got)
	}
}

// TestSQLiteRevocation_Issuer_EndToEnd: the Issuer's Parse path
// consults the SQLite-backed revocation set, and a revoked token stays
// revoked after rebuilding the Issuer's revocation set from the same db.
func TestSQLiteRevocation_Issuer_EndToEnd(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "rev.db")
	secret := newSecret(t)

	iss1, err := NewIssuer(secret, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	db1 := openTestDB(t, dbPath)
	if err := iss1.Revocation().AttachSQLite(db1); err != nil {
		t.Fatalf("AttachSQLite: %v", err)
	}
	tok, exp, err := iss1.Issue("carol", "p", []string{"reader"}, "")
	if err != nil {
		t.Fatal(err)
	}
	c, err := iss1.Parse(tok)
	if err != nil {
		t.Fatalf("token should parse before revoke: %v", err)
	}
	iss1.Revocation().Revoke(c.ID, exp)
	if _, err := iss1.Parse(tok); err == nil {
		t.Fatal("revoked token should not parse")
	}
	_ = db1.Close()

	// Restart: fresh Issuer + fresh revocation set on the same db file.
	iss2, err := NewIssuer(secret, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	db2 := openTestDB(t, dbPath)
	if err := iss2.Revocation().AttachSQLite(db2); err != nil {
		t.Fatalf("AttachSQLite (restart): %v", err)
	}
	if _, err := iss2.Parse(tok); err == nil {
		t.Fatal("revoked token should still be rejected after restart")
	}
}
