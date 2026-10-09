package jwt

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"
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
	for range 200 {
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

// --- PERF-2026-05-11-09 (#150): split RO/RW handles for revocation ---

// openTestRWRO opens a writer + a read-only handle on the SAME temp
// SQLite file, mirroring the profile store's two-handle model: the
// writer is pinned to one connection (SetMaxOpenConns(1)) and sets WAL;
// the reader is opened mode=ro with several connections. Returns
// (rw, ro, path).
func openTestRWRO(t *testing.T) (*sql.DB, *sql.DB, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "rev.db")
	rw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open rw: %v", err)
	}
	rw.SetMaxOpenConns(1)
	if _, err := rw.ExecContext(context.Background(),
		`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`); err != nil {
		t.Fatalf("rw pragmas: %v", err)
	}
	// A revocation table or two so the file exists for the RO open.
	if _, err := rw.ExecContext(context.Background(), revocationSchema); err != nil {
		t.Fatalf("rw schema: %v", err)
	}
	ro, err := sql.Open("sqlite", "file:"+path+"?mode=ro&_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatalf("open ro: %v", err)
	}
	ro.SetMaxOpenConns(8)
	ro.SetMaxIdleConns(8)
	if err := ro.PingContext(context.Background()); err != nil {
		t.Fatalf("ro ping: %v", err)
	}
	t.Cleanup(func() { _ = ro.Close(); _ = rw.Close() })
	return rw, ro, path
}

// TestSQLiteRevocation_AttachRW_ReadsFromROHandle: AttachSQLiteRW(rw,ro)
// hydrates the cache through the RO handle and persists writes through
// the RW handle; the file ends up in WAL mode; the RO handle rejects
// writes.
func TestSQLiteRevocation_AttachRW_ReadsFromROHandle(t *testing.T) {
	rw, ro, path := openTestRWRO(t)

	rs := NewRevocationSet()
	now := time.Date(2026, 5, 11, 12, 0, 0, 0, time.UTC)
	rs.nowFn = func() time.Time { return now }
	if err := rs.AttachSQLiteRW(rw, ro); err != nil {
		t.Fatalf("AttachSQLiteRW: %v", err)
	}
	// Write a revocation through the RW path.
	rs.Revoke("jti-1", now.Add(time.Hour))
	if !rs.IsRevoked(&Claims{RegisteredClaims: jjwt.RegisteredClaims{ID: "jti-1"}}) {
		t.Fatal("jti-1 should be revoked")
	}
	// The RO handle can see the row but cannot write.
	var cnt int
	if err := ro.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM revoked_jti WHERE jti = 'jti-1'`).Scan(&cnt); err != nil {
		t.Fatalf("ro read: %v", err)
	}
	if cnt != 1 {
		t.Fatalf("RO handle sees %d rows for jti-1, want 1", cnt)
	}
	if _, err := ro.ExecContext(context.Background(),
		`INSERT INTO revoked_jti (jti, exp) VALUES ('x', 1)`); err == nil {
		t.Fatal("RO handle accepted a write; expected SQLITE_READONLY")
	}
	// WAL mode is visible on a fresh connection.
	fresh, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open fresh: %v", err)
	}
	defer func() { _ = fresh.Close() }()
	var mode string
	if err := fresh.QueryRowContext(context.Background(), `PRAGMA journal_mode`).Scan(&mode); err != nil {
		t.Fatalf("PRAGMA journal_mode: %v", err)
	}
	if mode != "wal" {
		t.Fatalf("journal_mode = %q, want wal", mode)
	}
}

// TestSQLiteRevocation_AttachSQLite_AliasesRW: the single-handle
// AttachSQLite(db) keeps working (rw == ro path) — equivalent to
// AttachSQLiteRW(db, db).
func TestSQLiteRevocation_AttachSQLite_AliasesRW(t *testing.T) {
	db := openTestDB(t, ":memory:")
	rs := NewRevocationSet()
	if err := rs.AttachSQLite(db); err != nil {
		t.Fatalf("AttachSQLite: %v", err)
	}
	rs.Revoke("jti-z", time.Now().Add(time.Hour))
	if !rs.IsRevoked(&Claims{RegisteredClaims: jjwt.RegisteredClaims{ID: "jti-z"}}) {
		t.Fatal("jti-z should be revoked")
	}
	if rs.backend.rw != db || rs.backend.ro != db {
		t.Fatalf("AttachSQLite must alias rw==ro==db; got rw=%v ro=%v", rs.backend.rw, rs.backend.ro)
	}
}

// TestSQLiteRevocation_ROLoadConcurrentWithWrites: many concurrent
// revocation reloads (load() via the RO handle) and IsRevoked calls
// while a writer churns the SAME file through the RW handle (Revoke /
// Sweep) — no deadlock, every reload completes, results are correct.
// This pins the PERF-2026-05-11-09 (#150) goal: revocation reads do not
// serialise behind the single-writer handle.
func TestSQLiteRevocation_ROLoadConcurrentWithWrites(t *testing.T) {
	rw, ro, _ := openTestRWRO(t)
	now := time.Date(2026, 5, 11, 12, 0, 0, 0, time.UTC)

	rs := NewRevocationSet()
	rs.nowFn = func() time.Time { return now }
	if err := rs.AttachSQLiteRW(rw, ro); err != nil {
		t.Fatalf("AttachSQLiteRW: %v", err)
	}
	// Seed a durable revocation so reloads see something.
	rs.Revoke("seed-jti", now.Add(time.Hour))
	rs.RevokeUser("seed-user")

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	stop := make(chan struct{})
	var writerWG sync.WaitGroup
	writerWG.Add(1)
	go func() {
		defer writerWG.Done()
		i := 0
		for {
			select {
			case <-stop:
				return
			default:
			}
			i++
			rs.Revoke(fmt.Sprintf("churn-%d", i), now.Add(time.Hour))
			if i%50 == 0 {
				rs.Sweep(48 * time.Hour) // DELETEs through the RW handle
			}
		}
	}()

	const (
		numReaders = 8
		perReader  = 100
		wantLoads  = numReaders * perReader
	)
	var readerWG sync.WaitGroup
	var loads atomic.Int64
	for range numReaders {
		readerWG.Add(1)
		go func() {
			defer readerWG.Done()
			for range perReader {
				jtis, users, err := rs.backend.load(now)
				if err != nil {
					t.Errorf("revocation load: %v", err)
					return
				}
				if _, ok := jtis["seed-jti"]; !ok {
					t.Errorf("reload missing seed-jti")
					return
				}
				if _, ok := users["seed-user"]; !ok {
					t.Errorf("reload missing seed-user")
					return
				}
				// IsRevoked must also stay correct under churn.
				if !rs.IsRevoked(&Claims{RegisteredClaims: jjwt.RegisteredClaims{ID: "seed-jti"}}) {
					t.Errorf("seed-jti not revoked")
					return
				}
				loads.Add(1)
			}
		}()
	}

	readersDone := make(chan struct{})
	go func() { readerWG.Wait(); close(readersDone) }()
	select {
	case <-readersDone:
	case <-ctx.Done():
		t.Fatal("test timed out — possible deadlock between RO revocation reloads and the single-writer handle")
	}
	close(stop)
	writerWG.Wait()

	if got := loads.Load(); got < int64(wantLoads) {
		t.Fatalf("only %d reloads completed, want %d", got, wantLoads)
	}
}

// BenchmarkRevocationReloadUnderWrite measures revocation reload
// (load() via the RO handle) throughput while a writer churns the SAME
// file through the RW handle — the PERF-2026-05-11-09 (#150) shape.
func BenchmarkRevocationReloadUnderWrite(b *testing.B) {
	path := filepath.Join(b.TempDir(), "rev.db")
	rw, err := sql.Open("sqlite", path)
	if err != nil {
		b.Fatalf("open rw: %v", err)
	}
	defer func() { _ = rw.Close() }()
	rw.SetMaxOpenConns(1)
	if _, err := rw.ExecContext(context.Background(),
		`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`); err != nil {
		b.Fatalf("rw pragmas: %v", err)
	}
	if _, err := rw.ExecContext(context.Background(), revocationSchema); err != nil {
		b.Fatalf("rw schema: %v", err)
	}
	ro, err := sql.Open("sqlite", "file:"+path+"?mode=ro&_pragma=busy_timeout(5000)")
	if err != nil {
		b.Fatalf("open ro: %v", err)
	}
	defer func() { _ = ro.Close() }()
	ro.SetMaxOpenConns(8)
	ro.SetMaxIdleConns(8)
	if err := ro.PingContext(context.Background()); err != nil {
		b.Fatalf("ro ping: %v", err)
	}

	rs := NewRevocationSet()
	now := time.Now()
	if err := rs.AttachSQLiteRW(rw, ro); err != nil {
		b.Fatalf("AttachSQLiteRW: %v", err)
	}
	for i := range 200 {
		rs.Revoke(fmt.Sprintf("seed-%d", i), now.Add(time.Hour))
	}

	stop := make(chan struct{})
	var writerWG sync.WaitGroup
	writerWG.Add(1)
	go func() {
		defer writerWG.Done()
		i := 0
		for {
			select {
			case <-stop:
				return
			default:
			}
			i++
			rs.Revoke(fmt.Sprintf("churn-%d", i), now.Add(time.Hour))
		}
	}()

	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			if _, _, err := rs.backend.load(now); err != nil {
				b.Errorf("load: %v", err)
				return
			}
		}
	})
	b.StopTimer()
	close(stop)
	writerWG.Wait()
}
