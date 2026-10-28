package profilestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"time"

	_ "modernc.org/sqlite" // registers the pure-Go "sqlite" database/sql driver

	"geodedb.com/geode-ui/internal/conn"
)

// sqliteStore is the modernc.org/sqlite-backed Store. Concurrency
// model: SetMaxOpenConns(1) at Open time pins the *sql.DB to a single
// connection, which serializes all SQL through one driver pipeline.
// That is sufficient to make every method individually goroutine-safe
// without an in-process mutex.
//
// PSR-F2 (#97): the prior implementation relied on a sync.Mutex held
// only around UPDATE/DELETE while doing Get + compute outside the lock,
// which exposed a lost-update window for Patch. The fix wraps Get +
// UPDATE in a single sql.Tx so the read snapshot is bound to the same
// commit as the write; the mutex is dropped because SetMaxOpenConns(1)
// already provides single-flight serialization at the driver layer.
//
// GAP-S5 (#118): when cipher is non-nil the four sensitive columns
// (dsn, tls_ca_pem, tls_cert_pem, tls_key_pem) are AES-256-GCM-sealed
// before INSERT/UPDATE and unsealed transparently on read. Other
// columns (name, description, owner_user_id, scope, saved_username,
// timestamps, integers) are NOT encrypted: they have low individual
// sensitivity and need to remain queryable for the UNIQUE
// (scope, owner_user_id, name) constraint and the scope/owner filters
// on List. Legacy plaintext rows from before the encryption rollout
// are detected via IsCiphertext on the read path and surfaced
// transparently; the next Patch through the row will re-encrypt.
// PERF-2026-05-11-09 (#150): the profile store deliberately pins its
// primary handle (db) to a single connection — SetMaxOpenConns(1) — so
// every CRUD statement and every Patch transaction serialises through one
// driver pipeline (see the Patch concurrency notes). That is correct for
// the writer, but the JWT revocation subsystem (internal/jwt) used to be
// handed the *same* handle for its READ path (load()/queryCount) — so a
// revocation reload (or any future revocation SELECT) queued behind an
// in-flight profile-CRUD write.
//
// dbRO is a SECOND *sql.DB on the SAME on-disk file, opened read-only
// (`mode=ro`). WAL journal mode is a property of the file (set by the
// writer connection at open time and persisted in the DB header), so a
// `mode=ro` connection reads a consistent snapshot WITHOUT taking the
// write lock and WITHOUT blocking the writer. The RO handle is allowed
// GOMAXPROCS connections so concurrent revocation reads scale; the
// profile store owns BOTH handles' lifecycles and Close() closes both.
//
// For an in-memory DSN (":memory:" / "file::memory:" / "mode=memory")
// there is nothing to split — a second in-memory connection would open a
// fresh empty database — so dbRO aliases db in that case. Callers must
// continue to route WRITES through DBHandle() (the single-writer handle)
// and READS through DBHandleRO(); two writers, each capped at one
// connection, on the same WAL file would deadlock.
type sqliteStore struct {
	db     *sql.DB // single-writer handle: CRUD + Patch tx. SetMaxOpenConns(1).
	dbRO   *sql.DB // read-only handle on the same file (mode=ro). Aliases db for in-memory DSNs.
	cipher *Cipher
}

// OpenSQLite opens (or creates) a SQLite database at dsn and applies
// the schema. dsn is a modernc.org/sqlite DSN — a file path or
// ":memory:". The DB is opened with WAL + foreign_keys ON and is
// constrained to a single open connection: modernc serialises writes,
// and one connection avoids "database is locked" races on the embedded
// use case.
//
// SECURITY (GAP-S5): OpenSQLite leaves the column-level cipher field
// nil — DSN and TLS PEM material are written and read AS PLAINTEXT.
// Production callers MUST use OpenSQLiteEncrypted instead. The
// plain-OpenSQLite constructor is preserved only because every existing
// in-package test relies on it; downstream binaries should treat it as
// a legacy shim and migrate.
func OpenSQLite(dsn string) (Store, error) {
	return openSQLiteWithCipher(dsn, nil)
}

// OpenSQLiteEncrypted is the production constructor: it wires a
// non-nil Cipher into the store, so writes seal the four sensitive
// columns (dsn, tls_ca_pem, tls_cert_pem, tls_key_pem) before they
// reach the SQLite file and reads unseal them transparently. The
// cipher MUST be the same one across process restarts that share the
// same on-disk file — losing the key permanently locks the
// previously-written rows out of decryption.
//
// Legacy plaintext rows (those written by OpenSQLite or by an older
// build before encryption was wired in) are still readable: the read
// path uses IsCiphertext to distinguish v1-sealed bytes from raw
// plaintext, and PEM/DSN never collides with the v1 sentinel byte. The
// next Patch through a legacy row re-encrypts it; full back-fill is
// out of scope for this change (and unnecessary for the security
// argument so long as new writes are encrypted).
func OpenSQLiteEncrypted(dsn string, cipher *Cipher) (Store, error) {
	if cipher == nil {
		return nil, errors.New("profilestore: OpenSQLiteEncrypted: cipher is required")
	}
	return openSQLiteWithCipher(dsn, cipher)
}

// minReadConns is the floor on the read-only pool size so one slow read
// can never starve a second.
const minReadConns = 2

func openSQLiteWithCipher(dsn string, cipher *Cipher) (Store, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("profilestore: open: %w", err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.ExecContext(context.Background(),
		`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("profilestore: pragmas: %w", err)
	}
	if _, err := db.ExecContext(context.Background(), Schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("profilestore: schema: %w", err)
	}

	// PERF-2026-05-11-09 (#150): open a read-only second handle on the
	// same file for adjacent read-heavy subsystems (JWT revocation). For
	// in-memory DSNs there is nothing to share — alias the writer handle.
	dbRO := db
	if roDSN, ok := readOnlyDSN(dsn); ok {
		ro, err := sql.Open("sqlite", roDSN)
		if err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("profilestore: open ro: %w", err)
		}
		// Scale concurrent reads with the CPU count; never below 2 so a
		// single read can never starve a second.
		n := max(runtime.GOMAXPROCS(0), minReadConns)
		ro.SetMaxOpenConns(n)
		ro.SetMaxIdleConns(n)
		// Validate the RO DSN eagerly so a busted mode=ro (e.g. the file
		// does not exist yet, or the driver rejected the URI) fails at
		// construction time rather than on the first revocation reload.
		if err := ro.PingContext(context.Background()); err != nil {
			_ = ro.Close()
			_ = db.Close()
			return nil, fmt.Errorf("profilestore: ping ro: %w", err)
		}
		dbRO = ro
	}
	return &sqliteStore{db: db, dbRO: dbRO, cipher: cipher}, nil
}

// readOnlyDSN derives a read-only modernc.org/sqlite DSN from the
// writer DSN, or reports ok=false when no separate RO handle should be
// opened (in-memory databases, or a DSN shape we can't safely rewrite).
//
// modernc.org/sqlite opens every connection with SQLITE_OPEN_URI set, so
// a `file:<path>?mode=ro` URI is honoured by SQLite: the URI `mode`
// parameter narrows the connection (it is allowed to be MORE restrictive
// than the SQLITE_OPEN_READWRITE flag the driver passes). `mode=ro`
// requires the `file:` URI prefix — without it modernc strips the query
// from the path it hands to sqlite3_open_v2. busy_timeout is set via the
// driver's `_pragma=name(value)` form (the modernc spelling — NOT the
// mattn/go-sqlite3 `_busy_timeout`/`_txlock` spellings).
//
// We only rewrite the simple "bare filesystem path" shape (the only one
// the binary actually uses — see the -profile-store flag). A DSN that
// already carries a `?` query, or is already a `file:` URI, is left
// un-split (ok=false): merging query strings safely is more fragile than
// the contention win is worth, and the caller falls back to sharing the
// writer handle, which is no worse than the pre-#150 behaviour.
func readOnlyDSN(dsn string) (string, bool) {
	trimmed := strings.TrimSpace(dsn)
	low := strings.ToLower(trimmed)
	switch {
	case trimmed == "":
		return "", false
	case low == ":memory:":
		return "", false
	case strings.HasPrefix(low, "file::memory:"):
		return "", false
	case strings.Contains(low, "mode=memory"):
		return "", false
	case strings.HasPrefix(low, "file:"):
		// Already a URI — don't try to splice in mode=ro.
		return "", false
	case strings.ContainsAny(trimmed, "?#"):
		// Query/fragment present; rewriting it safely is out of scope.
		return "", false
	default:
		return "file:" + trimmed + "?mode=ro&_pragma=busy_timeout(5000)", true
	}
}

// Close closes both underlying handles. When dbRO aliases db (in-memory
// DSN) the second Close is skipped. A close error on either handle is
// returned; the writer handle's error takes precedence.
func (s *sqliteStore) Close() error {
	err := s.db.Close()
	if s.dbRO != nil && s.dbRO != s.db {
		if roErr := s.dbRO.Close(); roErr != nil && err == nil {
			err = roErr
		}
	}
	return err
}

// DBHandle exposes the underlying *sql.DB so adjacent subsystems can
// reuse the SAME SQLite file (a new table pair in the existing DB)
// rather than opening a second file. The JWT revocation store
// (internal/jwt) uses this to persist revoked-jti and
// password-changed-at rows alongside the profiles table — see
// cmd/server/main.go wiring and jwt.RevocationSet.AttachSQLite.
//
// Callers MUST NOT call Close on the returned handle (the profile store
// owns its lifecycle) and MUST respect the SetMaxOpenConns(1)
// single-flight model — every statement they issue is serialized with
// the profile store's own statements through the one driver pipeline.
//
// DBHandle is intentionally NOT on the profilestore.Store interface:
// the in-memory fakes used by handler tests don't have a *sql.DB, and
// only the production binary needs this. Callers type-assert for the
// DBHandleProvider optional interface.
//
// DBHandle returns the SINGLE-WRITER handle (SetMaxOpenConns(1)). All
// WRITES (schema migrations, INSERT/UPDATE/DELETE) MUST go through this
// handle. Adjacent subsystems that need a write path (e.g. the JWT
// revocation backend's putJTI/putUser/sweep) use this one.
func (s *sqliteStore) DBHandle() *sql.DB { return s.db }

// DBHandleRO returns the read-only handle on the same file
// (PERF-2026-05-11-09 / #150). It is opened `mode=ro` with up to
// GOMAXPROCS connections, so concurrent SELECTs do not serialise behind
// each other or behind the single-writer handle. Reads issued through
// it never block the writer (WAL). For an in-memory DSN this is the
// same handle as DBHandle(). Callers MUST NOT issue writes through it
// (SQLite returns SQLITE_READONLY) and MUST NOT Close it.
func (s *sqliteStore) DBHandleRO() *sql.DB { return s.dbRO }

// DBHandleProvider is the optional interface implemented by Store
// backends that are SQLite-file-backed. cmd/server type-asserts for it
// to hand the writer *sql.DB (for writes) and the RO *sql.DB (for
// reads) to jwt.RevocationSet.AttachSQLiteRW.
type DBHandleProvider interface {
	DBHandle() *sql.DB   // single-writer handle (writes)
	DBHandleRO() *sql.DB // read-only handle on the same file (reads)
}

// List returns profiles matching the supplied Filter.
//
// PSR-F3 (#99): the prior implementation was an unbounded full table
// scan, sorted by (scope, name). At scale (hundreds-to-thousands of
// profiles) every reload + every UI list paid full O(N) JSON encoding
// cost per request. List now honours Filter.Limit + Filter.AfterID so
// callers can page through the catalogue without buffering everything.
//
// Two ordering modes preserve compatibility:
//
//   - Limit==0 && AfterID=="" (the unbounded path used by reloadAsync):
//     results are sorted (scope ASC, name ASC) just like before. No
//     existing caller relies on id-ordering in this mode.
//   - Limit>0 || AfterID!="" (any paginated call): results are sorted
//     by id ASC so the cursor advances deterministically. Without
//     stable id-ordering, two pages could cover the same row twice or
//     skip rows entirely.
//
// We never apply OFFSET — cursor pagination by id is O(log N) per
// page (the PRIMARY KEY index covers it), while OFFSET is O(N) at the
// tail of a large table.
func (s *sqliteStore) List(ctx context.Context, f Filter) ([]conn.Profile, error) {
	q := `SELECT id, scope, owner_user_id, name, dsn, description,
	             saved_username, is_default, tls_ca_pem, tls_cert_pem,
	             tls_key_pem, max_open_conns, max_idle_conns,
	             conn_max_lifetime_ns, conn_max_idle_ns
	      FROM profiles WHERE 1=1`
	args := []any{}
	if f.Scope != "" {
		q += " AND scope = ?"
		args = append(args, string(f.Scope))
	}
	if f.OwnerUserID != "" {
		q += " AND owner_user_id = ?"
		args = append(args, f.OwnerUserID)
	}
	if f.AfterID != "" {
		q += " AND id > ?"
		args = append(args, f.AfterID)
	}
	// Pagination switches the sort to id ASC. Without it, the cursor
	// (`id > ?`) and the application-defined sort would disagree and
	// rows could be skipped or duplicated across pages.
	if f.Limit > 0 || f.AfterID != "" {
		q += " ORDER BY id ASC"
	} else {
		q += " ORDER BY scope ASC, name ASC"
	}
	if f.Limit > 0 {
		q += " LIMIT ?"
		args = append(args, f.Limit)
	}

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("profilestore: list: %w", err)
	}
	defer func() { _ = rows.Close() }()

	out := []conn.Profile{}
	for rows.Next() {
		p, err := s.scanProfile(rows.Scan)
		if err != nil {
			return nil, fmt.Errorf("profilestore: scan: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListVisible returns the union of all system profiles and the
// personal profiles owned by ownerUserID in a single SQL query.
//
// PSR-F4 (#101): the prior GET /profiles handler called Store.List
// twice (once for system, once for personal+owner) and concatenated
// the results in Go. Two sequential round-trips through the
// SetMaxOpenConns(1) pipeline meant the second always waited for the
// first to finish. Collapsing them into one query halves the round-
// trip count for the most common GET /profiles request.
//
// SQL semantics: `scope='system' OR (scope='personal' AND owner_user_id=?)`.
// When ownerUserID is empty, only system profiles match (the
// owner_user_id=” branch picks up no personal rows because personal
// profiles always carry a non-empty owner — that invariant is
// enforced upstream by handlers_profiles_crud.PostProfiles).
//
// Ordering matches List for shape compatibility with callers that
// previously concatenated sys+personal: scope ASC ('personal' <
// 'system' lexically), then name ASC. The `personal` rows therefore
// sort before the `system` rows; this differs from the old `sys then
// personal` Go-side concat order, but no caller depends on the
// scope-grouping order — the API contract is "an unordered set of
// visible profiles" and the renderer sorts client-side.
func (s *sqliteStore) ListVisible(ctx context.Context, ownerUserID string) ([]conn.Profile, error) {
	const q = `
		SELECT id, scope, owner_user_id, name, dsn, description,
		       saved_username, is_default, tls_ca_pem, tls_cert_pem,
		       tls_key_pem, max_open_conns, max_idle_conns,
		       conn_max_lifetime_ns, conn_max_idle_ns
		FROM profiles
		WHERE scope = ?
		   OR (scope = ? AND owner_user_id = ?)
		ORDER BY scope ASC, name ASC`
	rows, err := s.db.QueryContext(ctx, q,
		string(conn.ProfileScopeSystem),
		string(conn.ProfileScopePersonal),
		ownerUserID,
	)
	if err != nil {
		return nil, fmt.Errorf("profilestore: list_visible: %w", err)
	}
	defer func() { _ = rows.Close() }()

	out := []conn.Profile{}
	for rows.Next() {
		p, err := s.scanProfile(rows.Scan)
		if err != nil {
			return nil, fmt.Errorf("profilestore: list_visible scan: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// scanFn matches *sql.Row.Scan and *sql.Rows.Scan so scanProfile is
// reusable from both Get and List. scanProfile does not wrap the scan
// error so callers can distinguish sql.ErrNoRows.
type scanFn = func(dest ...any) error

func (s *sqliteStore) Put(ctx context.Context, p conn.Profile) (conn.Profile, error) {
	if !p.Scope.Valid() {
		return conn.Profile{}, fmt.Errorf("%w: scope=%q", ErrInvalid, p.Scope)
	}
	if p.Name == "" || p.DSN == "" {
		return conn.Profile{}, fmt.Errorf("%w: name and dsn are required", ErrInvalid)
	}
	if p.ID == "" {
		p.ID = newID()
	}
	now := time.Now().UnixNano()

	dsnSealed, err := s.sealString(p.DSN)
	if err != nil {
		return conn.Profile{}, err
	}
	caSealed, err := s.sealString(p.TLS.CAPEM)
	if err != nil {
		return conn.Profile{}, err
	}
	certSealed, err := s.sealString(p.TLS.ClientCertPEM)
	if err != nil {
		return conn.Profile{}, err
	}
	keySealed, err := s.sealString(p.TLS.ClientKeyPEM)
	if err != nil {
		return conn.Profile{}, err
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO profiles
		  (id, scope, owner_user_id, name, dsn, description, saved_username,
		   is_default, tls_ca_pem, tls_cert_pem, tls_key_pem,
		   max_open_conns, max_idle_conns, conn_max_lifetime_ns,
		   conn_max_idle_ns, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		p.ID, string(p.Scope), p.OwnerUserID, p.Name, dsnSealed, p.Description,
		p.SavedUsername, boolAsInt(p.Default),
		caSealed, certSealed, keySealed,
		p.PoolOverrides.MaxOpenConns, p.PoolOverrides.MaxIdleConns,
		durationAsNs(p.PoolOverrides.ConnMaxLifetime),
		durationAsNs(p.PoolOverrides.ConnMaxIdleTime),
		now, now,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return conn.Profile{}, fmt.Errorf("%w: scope=%s name=%s",
				ErrConflict, p.Scope, p.Name)
		}
		return conn.Profile{}, fmt.Errorf("profilestore: put: %w", err)
	}
	return p, nil
}

func (s *sqliteStore) Get(ctx context.Context, id string) (conn.Profile, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, scope, owner_user_id, name, dsn, description,
		       saved_username, is_default, tls_ca_pem, tls_cert_pem,
		       tls_key_pem, max_open_conns, max_idle_conns,
		       conn_max_lifetime_ns, conn_max_idle_ns
		FROM profiles WHERE id = ?`, id)
	p, err := s.scanProfile(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return conn.Profile{}, ErrNotFound
	}
	if err != nil {
		return conn.Profile{}, fmt.Errorf("profilestore: get: %w", err)
	}
	return p, nil
}

// Patch applies a ProfilePatch atomically: the read of the current row
// and the UPDATE that overwrites it run in the same sql.Tx so no other
// caller can interleave a write between Get and UPDATE.
//
// Concurrency notes:
//   - SetMaxOpenConns(1) at Open serializes all access to the single
//     underlying *sql.Conn. modernc.org/sqlite enforces SQLite's
//     transaction model on top of that, so a tx held by one goroutine
//     blocks every other goroutine's tx until Commit/Rollback. This is
//     equivalent in effect to BEGIN IMMEDIATE for our embedded use
//     case; we do not pass an explicit Isolation level because modernc
//     defers to SQLite's default and we are not relying on snapshot
//     isolation across multiple connections.
//   - RowsAffected on the UPDATE detects the case where the row was
//     deleted between the caller's Patch call and our tx Begin (only
//     possible via an external connection; with SetMaxOpenConns(1) the
//     in-process Delete cannot interleave a held tx). We surface
//     ErrNotFound in that case so the handler returns 404 instead of
//     a silent no-op success.
func (s *sqliteStore) Patch(ctx context.Context, id string, p ProfilePatch) (conn.Profile, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return conn.Profile{}, fmt.Errorf("profilestore: patch: begin: %w", err)
	}
	// rollback on every non-success path. Commit clears the rollback
	// (re-calling Rollback on a committed tx is documented as safe / no-op
	// returning sql.ErrTxDone, which we ignore).
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	row := tx.QueryRowContext(ctx, `
		SELECT id, scope, owner_user_id, name, dsn, description,
		       saved_username, is_default, tls_ca_pem, tls_cert_pem,
		       tls_key_pem, max_open_conns, max_idle_conns,
		       conn_max_lifetime_ns, conn_max_idle_ns
		FROM profiles WHERE id = ?`, id)
	cur, err := s.scanProfile(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return conn.Profile{}, ErrNotFound
	}
	if err != nil {
		return conn.Profile{}, fmt.Errorf("profilestore: patch: get: %w", err)
	}

	merged := mergeProfile(cur, p)
	now := time.Now().UnixNano()

	dsnSealed, err := s.sealString(merged.DSN)
	if err != nil {
		return conn.Profile{}, err
	}
	caSealed, err := s.sealString(merged.TLS.CAPEM)
	if err != nil {
		return conn.Profile{}, err
	}
	certSealed, err := s.sealString(merged.TLS.ClientCertPEM)
	if err != nil {
		return conn.Profile{}, err
	}
	keySealed, err := s.sealString(merged.TLS.ClientKeyPEM)
	if err != nil {
		return conn.Profile{}, err
	}

	res, err := tx.ExecContext(ctx, `
		UPDATE profiles SET
		  name = ?, dsn = ?, description = ?, saved_username = ?,
		  is_default = ?, tls_ca_pem = ?, tls_cert_pem = ?, tls_key_pem = ?,
		  max_open_conns = ?, max_idle_conns = ?,
		  conn_max_lifetime_ns = ?, conn_max_idle_ns = ?, updated_at = ?
		WHERE id = ?`,
		merged.Name, dsnSealed, merged.Description, merged.SavedUsername,
		boolAsInt(merged.Default), caSealed, certSealed,
		keySealed, merged.PoolOverrides.MaxOpenConns,
		merged.PoolOverrides.MaxIdleConns,
		durationAsNs(merged.PoolOverrides.ConnMaxLifetime),
		durationAsNs(merged.PoolOverrides.ConnMaxIdleTime),
		now, id,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return conn.Profile{}, fmt.Errorf("%w: name=%s", ErrConflict, merged.Name)
		}
		return conn.Profile{}, fmt.Errorf("profilestore: patch: update: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return conn.Profile{}, fmt.Errorf("profilestore: patch: rowsaffected: %w", err)
	}
	if n == 0 {
		// Row vanished between scanProfile (above) and UPDATE. Under
		// SetMaxOpenConns(1) this can't happen via this *sql.DB (the tx
		// holds the only connection), but a separate process opening the
		// same SQLite file could; surface as ErrNotFound rather than a
		// silent successful Patch returning the merged-but-unsaved row.
		return conn.Profile{}, ErrNotFound
	}
	if err := tx.Commit(); err != nil {
		return conn.Profile{}, fmt.Errorf("profilestore: patch: commit: %w", err)
	}
	committed = true
	return merged, nil
}

func (s *sqliteStore) Delete(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM profiles WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("profilestore: delete: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// sealString runs s through the column-level cipher and returns the
// resulting bytes. The bytes are stored in a TEXT SQLite column; that
// works because modernc.org/sqlite passes byte slices through TEXT
// columns as BLOBs without coercion, and SQLite itself treats the row
// as opaque bytes regardless of declared type. Reading back via Get
// /List uses unsealString to reverse the transform.
//
// When cipher is nil, sealString returns s unchanged so the
// non-encrypted fast-path through Put/Patch stays a single code path.
func (s *sqliteStore) sealString(plain string) (any, error) {
	if s.cipher == nil {
		return plain, nil
	}
	ct, err := s.cipher.Encrypt([]byte(plain))
	if err != nil {
		return nil, fmt.Errorf("profilestore: seal: %w", err)
	}
	return ct, nil
}

// unsealBytes is the read-side inverse of sealString. It accepts the
// value SQLite scanned into a []byte (the "any plaintext or any v1
// ciphertext" union) and returns the underlying plaintext string.
//
// Legacy migration path (GAP-S5): rows written by an older build
// before the encryption rollout still hold raw plaintext in the four
// sensitive columns. The leading byte of any v1 ciphertext is the
// sentinel 0x01, which never appears as the first byte of a legitimate
// PEM block (always '-' = 0x2D) or DSN scheme letter. We dispatch on
// IsCiphertext: if the bytes are sealed, decrypt; otherwise pass
// through unchanged. The next Patch through this row re-encrypts.
//
// Fail-loud (SEC F-INPUT-2 / #143): if a row holds v1 ciphertext but no
// cipher is configured, returning the raw bytes would hand the caller an
// undecryptable blob masquerading as a plaintext credential. Surface an
// error instead so the misconfiguration is visible rather than silently
// corrupting the read.
func (s *sqliteStore) unsealBytes(raw []byte) (string, error) {
	if s.cipher == nil {
		if IsCiphertext(raw) {
			return "", errors.New("profilestore: ciphertext present but no cipher configured")
		}
		return string(raw), nil
	}
	if !IsCiphertext(raw) {
		return string(raw), nil
	}
	plain, err := s.cipher.Decrypt(raw)
	if err != nil {
		return "", fmt.Errorf("profilestore: unseal: %w", err)
	}
	return string(plain), nil
}

// scanProfile materialises one row into a conn.Profile. The four
// sensitive columns (dsn, tls_ca_pem, tls_cert_pem, tls_key_pem) are
// scanned into []byte so the unseal path can dispatch on the v1
// sentinel byte before turning bytes into strings. Non-sensitive
// columns (name, description, saved_username, owner_user_id, scope,
// timestamps, integers) scan straight to their typed destinations.
//
// scanProfile is a method on sqliteStore (rather than a free function
// as it was pre-S5) because it needs the cipher pointer to dispatch
// the unseal path. The error value is returned bare so callers can
// distinguish sql.ErrNoRows from genuine scan failures.
func (s *sqliteStore) scanProfile(scan scanFn) (conn.Profile, error) {
	var (
		p                              conn.Profile
		def                            int
		lifetimeNs, idleNs             int64
		dsnRaw, caRaw, certRaw, keyRaw []byte
	)
	if err := scan(
		&p.ID, &p.Scope, &p.OwnerUserID, &p.Name, &dsnRaw, &p.Description,
		&p.SavedUsername, &def, &caRaw, &certRaw,
		&keyRaw, &p.PoolOverrides.MaxOpenConns,
		&p.PoolOverrides.MaxIdleConns, &lifetimeNs, &idleNs,
	); err != nil {
		return conn.Profile{}, err
	}
	p.Default = def != 0
	p.PoolOverrides.ConnMaxLifetime = nsAsDuration(lifetimeNs)
	p.PoolOverrides.ConnMaxIdleTime = nsAsDuration(idleNs)
	var err error
	if p.DSN, err = s.unsealBytes(dsnRaw); err != nil {
		return conn.Profile{}, err
	}
	if p.TLS.CAPEM, err = s.unsealBytes(caRaw); err != nil {
		return conn.Profile{}, err
	}
	if p.TLS.ClientCertPEM, err = s.unsealBytes(certRaw); err != nil {
		return conn.Profile{}, err
	}
	if p.TLS.ClientKeyPEM, err = s.unsealBytes(keyRaw); err != nil {
		return conn.Profile{}, err
	}
	return p, nil
}

// mergeProfile applies a ProfilePatch over cur using "set vs absent"
// semantics: a nil pointer field on patch leaves the corresponding
// field on cur untouched, while a non-nil pointer field overwrites it
// with the dereferenced value. This is the partial-update contract
// that PATCH requires (PSR-G02): without the pointer-presence check,
// PATCH could not clear a previously-set Description, TLS PEM
// material, or pool override.
//
// For TLS and PoolOverrides, the entire bundle is replaced as a unit:
// passing &TLSMaterial{} (an all-empty struct) clears every PEM
// fragment in one go; passing nil leaves the bundle alone. This
// matches the wire shape (`tls: {}` clears, `tls` key absent
// preserves).
func mergeProfile(cur conn.Profile, patch ProfilePatch) conn.Profile {
	out := cur
	if patch.Name != nil {
		out.Name = *patch.Name
	}
	if patch.DSN != nil {
		out.DSN = *patch.DSN
	}
	if patch.Description != nil {
		out.Description = *patch.Description
	}
	if patch.SavedUsername != nil {
		out.SavedUsername = *patch.SavedUsername
	}
	if patch.Default != nil {
		out.Default = *patch.Default
	}
	if patch.TLS != nil {
		out.TLS = *patch.TLS
	}
	if patch.PoolOverrides != nil {
		out.PoolOverrides = *patch.PoolOverrides
	}
	return out
}
