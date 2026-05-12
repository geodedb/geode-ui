package jwt

import (
	"context"
	"database/sql"
	"fmt"
	"sync/atomic"
	"time"
)

// revocationSchema is the DDL for the two revocation tables. They live
// in the SAME SQLite file as the profile store (a new table in the
// existing DB) — geode-ui does not open a second file. CREATE TABLE IF
// NOT EXISTS keeps it idempotent across restarts; a future schema
// version would migrate forward from a schema_migrations table just
// like profilestore.Schema.
//
//	revoked_jti(jti, exp)            — per-token revocation; exp is the
//	                                   token's expiry as Unix nanos. A
//	                                   row past its exp is dead weight
//	                                   (the JWT TTL guard already rejects
//	                                   the token) and is GC'd at startup
//	                                   and by Sweep.
//	password_changed_at(username, changed_at)
//	                                 — per-user revoke-all; changed_at is
//	                                   the password-change instant as
//	                                   Unix nanos. A token whose iat is
//	                                   at or before changed_at is stale.
const revocationSchema = `
CREATE TABLE IF NOT EXISTS revoked_jti (
	jti TEXT PRIMARY KEY,
	exp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS password_changed_at (
	username   TEXT PRIMARY KEY,
	changed_at INTEGER NOT NULL
);
`

// sqliteRevocationBackend persists revocation state to a SQLite DB in the
// same file the profile store uses (a separate revoked_jti /
// password_changed_at table pair, not a second file). It is the durable
// source of truth; RevocationSet's sync.Maps are the in-memory
// read-through cache loaded from here at startup and kept in sync
// write-through on every Revoke/RevokeUser.
//
// PERF-2026-05-11-09 (#150): the backend holds TWO handles on that file:
//
//	rw — the profile store's single-writer handle (SetMaxOpenConns(1)).
//	     ALL writes (the CREATE TABLE migrations, putJTI/putUser, sweep's
//	     DELETEs) go through it so they serialise correctly with profile
//	     CRUD. Two independent writers, each capped at one connection, on
//	     the same WAL file would deadlock — there is exactly one writer.
//	ro — the profile store's read-only handle (mode=ro, up to GOMAXPROCS
//	     connections). The hydration SELECTs in load() go through it so a
//	     revocation reload never queues behind an in-flight profile-CRUD
//	     write. WAL means these reads never block the writer either.
//
// When the profile store is in-memory (':memory:'), rw == ro — there is
// no separate file to share, and the single-connection writer handle is
// used for everything, identical to the pre-#150 behaviour.
//
// queries counts the SQL statements issued by the backend AFTER the
// initial load() (so tests can assert IsRevoked never touches SQLite).
// It is incremented by putJTI/putUser/sweep — load() is the startup
// hydration and is deliberately not counted.
type sqliteRevocationBackend struct {
	rw      *sql.DB // single-writer handle: migrations + putJTI/putUser/sweep.
	ro      *sql.DB // read-only handle on the same file: load() hydration SELECTs.
	queries atomic.Int64
}

// newSQLiteRevocationBackend runs the CREATE TABLE IF NOT EXISTS
// migrations (on the writer handle) and returns the backend. It does not
// load the cache — callers (RevocationSet.AttachSQLite*) call load()
// right after. ro may equal rw (in-memory DSN); rw must not be nil. A
// nil ro is treated as "use rw for reads too".
func newSQLiteRevocationBackend(rw, ro *sql.DB) (*sqliteRevocationBackend, error) {
	if rw == nil {
		return nil, fmt.Errorf("jwt: revocation backend: nil db")
	}
	if ro == nil {
		ro = rw
	}
	if _, err := rw.ExecContext(context.Background(), revocationSchema); err != nil {
		return nil, fmt.Errorf("jwt: revocation schema: %w", err)
	}
	return &sqliteRevocationBackend{rw: rw, ro: ro}, nil
}

// load reads every still-relevant row into two maps: revoked jtis whose
// exp is in the future, and all password_changed_at entries. Rows whose
// exp has already passed are skipped (they'd be GC'd immediately
// anyway). load also DELETEs the stale revoked_jti rows so the table
// doesn't grow unbounded across restarts — that one DELETE is part of
// startup hydration and is intentionally NOT counted in queries.
//
// PERF-2026-05-11-09 (#150): the hydration SELECTs go through b.ro (the
// read-only handle on the same file) so they never queue behind an
// in-flight profile-CRUD write; the GC DELETE still goes through b.rw
// (the single-writer handle) because it mutates the file.
func (b *sqliteRevocationBackend) load(now time.Time) (map[string]time.Time, map[string]time.Time, error) {
	ctx := context.Background()
	nowNs := now.UnixNano()

	jtis := map[string]time.Time{}
	rows, err := b.ro.QueryContext(ctx, `SELECT jti, exp FROM revoked_jti`)
	if err != nil {
		return nil, nil, fmt.Errorf("jwt: revocation load jti: %w", err)
	}
	for rows.Next() {
		var jti string
		var expNs int64
		if err := rows.Scan(&jti, &expNs); err != nil {
			_ = rows.Close()
			return nil, nil, fmt.Errorf("jwt: revocation scan jti: %w", err)
		}
		if expNs <= nowNs {
			continue // expired — skip; GC'd below.
		}
		jtis[jti] = time.Unix(0, expNs)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, nil, fmt.Errorf("jwt: revocation rows jti: %w", err)
	}
	_ = rows.Close()

	users := map[string]time.Time{}
	urows, err := b.ro.QueryContext(ctx, `SELECT username, changed_at FROM password_changed_at`)
	if err != nil {
		return nil, nil, fmt.Errorf("jwt: revocation load users: %w", err)
	}
	for urows.Next() {
		var username string
		var changedNs int64
		if err := urows.Scan(&username, &changedNs); err != nil {
			_ = urows.Close()
			return nil, nil, fmt.Errorf("jwt: revocation scan user: %w", err)
		}
		users[username] = time.Unix(0, changedNs)
	}
	if err := urows.Err(); err != nil {
		_ = urows.Close()
		return nil, nil, fmt.Errorf("jwt: revocation rows users: %w", err)
	}
	_ = urows.Close()

	// GC stale revoked_jti rows. Not counted in queries — this is part
	// of one-time startup hydration, not the steady-state hot path.
	if _, err := b.rw.ExecContext(ctx, `DELETE FROM revoked_jti WHERE exp <= ?`, nowNs); err != nil {
		return nil, nil, fmt.Errorf("jwt: revocation gc: %w", err)
	}
	return jtis, users, nil
}

// putJTI write-through-upserts a revoked-jti row. INSERT OR REPLACE so a
// re-revoke (or a later exp) overwrites cleanly.
func (b *sqliteRevocationBackend) putJTI(jti string, exp time.Time) error {
	b.queries.Add(1)
	_, err := b.rw.ExecContext(context.Background(),
		`INSERT OR REPLACE INTO revoked_jti (jti, exp) VALUES (?, ?)`,
		jti, exp.UnixNano())
	if err != nil {
		return fmt.Errorf("jwt: revocation put jti: %w", err)
	}
	return nil
}

// putUser write-through-upserts a password_changed_at row. The caller
// (RevokeUser) only calls this when the new instant is strictly newer
// than the cached one, so INSERT OR REPLACE is safe — it can never move
// the persisted marker backward.
func (b *sqliteRevocationBackend) putUser(username string, changedAt time.Time) error {
	b.queries.Add(1)
	_, err := b.rw.ExecContext(context.Background(),
		`INSERT OR REPLACE INTO password_changed_at (username, changed_at) VALUES (?, ?)`,
		username, changedAt.UnixNano())
	if err != nil {
		return fmt.Errorf("jwt: revocation put user: %w", err)
	}
	return nil
}

// sweep deletes expired revoked_jti rows and password_changed_at rows
// older than maxTokenAge from SQLite. The in-memory cache is pruned by
// RevocationSet.Sweep; this is the durable half.
func (b *sqliteRevocationBackend) sweep(now time.Time, maxTokenAge time.Duration) error {
	ctx := context.Background()
	b.queries.Add(1)
	if _, err := b.rw.ExecContext(ctx, `DELETE FROM revoked_jti WHERE exp <= ?`, now.UnixNano()); err != nil {
		return fmt.Errorf("jwt: revocation sweep jti: %w", err)
	}
	if maxTokenAge > 0 {
		b.queries.Add(1)
		cutoff := now.Add(-maxTokenAge).UnixNano()
		if _, err := b.rw.ExecContext(ctx, `DELETE FROM password_changed_at WHERE changed_at < ?`, cutoff); err != nil {
			return fmt.Errorf("jwt: revocation sweep users: %w", err)
		}
	}
	return nil
}

// queryCount returns the number of SQL statements the backend has
// issued since (and not including) the initial load(). Test-only — used
// to assert IsRevoked never bypasses the cache.
func (b *sqliteRevocationBackend) queryCount() int64 { return b.queries.Load() }
