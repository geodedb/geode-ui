package profilestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"

	_ "modernc.org/sqlite"

	"geodedb.com/geode-ui/internal/conn"
)

type sqliteStore struct {
	db *sql.DB
	mu sync.Mutex
}

// OpenSQLite opens (or creates) a SQLite database at dsn and applies
// the schema. dsn is a modernc.org/sqlite DSN — a file path or
// ":memory:". The DB is opened with WAL + foreign_keys ON and is
// constrained to a single open connection: modernc serialises writes,
// and one connection avoids "database is locked" races on the embedded
// use case.
func OpenSQLite(dsn string) (Store, error) {
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
	return &sqliteStore{db: db}, nil
}

func (s *sqliteStore) Close() error { return s.db.Close() }

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
	q += " ORDER BY scope ASC, name ASC"

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("profilestore: list: %w", err)
	}
	defer func() { _ = rows.Close() }()

	out := []conn.Profile{}
	for rows.Next() {
		p, err := scanProfile(rows.Scan)
		if err != nil {
			return nil, fmt.Errorf("profilestore: scan: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// scanFn matches *sql.Row.Scan and *sql.Rows.Scan so scanProfile is
// reusable from both Get and List. scanProfile does not wrap the scan
// error so callers can distinguish sql.ErrNoRows.
type scanFn = func(dest ...any) error

func scanProfile(scan scanFn) (conn.Profile, error) {
	var (
		p                  conn.Profile
		def                int
		lifetimeNs, idleNs int64
	)
	if err := scan(
		&p.ID, &p.Scope, &p.OwnerUserID, &p.Name, &p.DSN, &p.Description,
		&p.SavedUsername, &def, &p.TLS.CAPEM, &p.TLS.ClientCertPEM,
		&p.TLS.ClientKeyPEM, &p.PoolOverrides.MaxOpenConns,
		&p.PoolOverrides.MaxIdleConns, &lifetimeNs, &idleNs,
	); err != nil {
		return conn.Profile{}, err
	}
	p.Default = def != 0
	p.PoolOverrides.ConnMaxLifetime = nsAsDuration(lifetimeNs)
	p.PoolOverrides.ConnMaxIdleTime = nsAsDuration(idleNs)
	return p, nil
}

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

	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO profiles
		  (id, scope, owner_user_id, name, dsn, description, saved_username,
		   is_default, tls_ca_pem, tls_cert_pem, tls_key_pem,
		   max_open_conns, max_idle_conns, conn_max_lifetime_ns,
		   conn_max_idle_ns, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		p.ID, string(p.Scope), p.OwnerUserID, p.Name, p.DSN, p.Description,
		p.SavedUsername, boolAsInt(p.Default),
		p.TLS.CAPEM, p.TLS.ClientCertPEM, p.TLS.ClientKeyPEM,
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
	p, err := scanProfile(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return conn.Profile{}, ErrNotFound
	}
	if err != nil {
		return conn.Profile{}, fmt.Errorf("profilestore: get: %w", err)
	}
	return p, nil
}

// Stubs for Patch/Delete; implemented in subsequent tasks.
func (s *sqliteStore) Patch(ctx context.Context, id string, p conn.Profile) (conn.Profile, error) {
	return conn.Profile{}, fmt.Errorf("profilestore: Patch not implemented")
}
func (s *sqliteStore) Delete(ctx context.Context, id string) error {
	return fmt.Errorf("profilestore: Delete not implemented")
}
