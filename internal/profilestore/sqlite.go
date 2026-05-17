package profilestore

import (
	"context"
	"database/sql"
	"fmt"
	"runtime"
	"strings"

	_ "modernc.org/sqlite"
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
		return nil, fmt.Errorf("profilestore: OpenSQLiteEncrypted: cipher is required")
	}
	return openSQLiteWithCipher(dsn, cipher)
}

func openSQLiteWithCipher(dsn string, cipher *Cipher) (Store, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("profilestore: open: %w", err)
	}
	db.SetMaxOpenConns(1)
	// GAP-032 / #207: busy_timeout=5000 ms gives the writer a 5-second
	// retry window when an adjacent reader holds a brief lock under
	// WAL mode (default is 0, so contention reports SQLITE_BUSY
	// immediately). Inlined here rather than appended to the DSN so it
	// works uniformly across :memory:, bare-path, and file: URI shapes.
	if _, err := db.ExecContext(context.Background(),
		`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`); err != nil {
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
		n := runtime.GOMAXPROCS(0)
		if n < 2 {
			n = 2
		}
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
			return "", fmt.Errorf("profilestore: ciphertext present but no cipher configured")
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
