# Profile System Rebuild — Plan A: Server Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the immutable boot-time JSON profiles file with a persistent, runtime-mutable, scope-aware profile store, exposed via admin/owner-gated CRUD endpoints. The SPA UX is unchanged through this plan — existing single-session login keeps working.

**Architecture:** A new `internal/profilestore` package wraps SQLite (modernc.org/sqlite — pure Go, no cgo) with `(scope, owner_user_id, name)` uniqueness. `conn.Profile` gains `ID`, `Scope`, `OwnerUserID`, `Default`, `SavedUsername`, `TLS` (PEM material), and `PoolOverrides`. `conn.Pool` gains `Reload(profiles)` to atomically swap the registered set, keeping existing `*sql.DB` handles for unchanged profiles. CRUD endpoints are emitted from `geode.json` via genapi (`make generate`) — no hand edits under `gen/`. Boot-time JSON file becomes a one-shot seed when the SQLite store is empty.

**Tech Stack:** Go 1.22+, `modernc.org/sqlite`, genapi (`~/src/devnw/apps/genapi`), `database/sql`, table-driven `testing` package tests.

---

## File Structure

**Create**
- `internal/profilestore/store.go` — `Store` interface
- `internal/profilestore/errors.go` — typed package errors
- `internal/profilestore/schema.go` — embedded SQL DDL constant
- `internal/profilestore/sqlite.go` — SQLite-backed implementation
- `internal/profilestore/helpers.go` — id minting, bool↔int, unique-violation detector
- `internal/profilestore/duration.go` — `time.Duration` ↔ ns helpers
- `internal/profilestore/sqlite_test.go` — round-trip tests
- `internal/conn/profile_test.go` — `ProfileScope.Valid` table test
- `internal/server/handlers_profiles_crud.go` — Create/Get/Update/Delete handlers
- `internal/server/handlers_profiles_crud_test.go` — handler tests with ownership matrix

**Modify**
- `internal/conn/profile.go` — extend `Profile` struct, add `ProfileScope`, `PoolOverrides`, `TLSMaterial`
- `internal/conn/pool.go` — `Reload`, `applyOverrides`, per-profile pool overrides on `DB()`
- `internal/conn/pool_test.go` — `TestPoolReloadKeepsExistingDBs`
- `geode.json` — new schemas (`Profile`, `ProfileScope`, `TLSMaterial`, `PoolOverrides`, `CreateProfileReq`, `UpdateProfileReq`, `ProfileIDPath`) + 4 new endpoints + replaced `ProfileList`
- `internal/server/server.go` — `Config.Store profilestore.Store`, expand `ProfileLookup` with `Get(id)` + scope-aware `List`
- `internal/server/handlers_profiles.go` — list with scope filter, return full Profile to admins/owners (DSN no longer redacted for ownership)
- `cmd/server/main.go` — wire `profilestore.Store`, run JSON-seed-migration when store is empty, plumb `Store` into `Config`, watch store changes and call `Pool.Reload`

---

## Task 1: Add the modernc.org/sqlite dependency

**Files:** `go.mod`, `go.sum`

- [ ] **Step 1: Add the dep**

```bash
cd /data/home/benji/src/devnw/codepros/geode/geode-ui
go get modernc.org/sqlite@latest
go mod tidy
```

Expected: `go.mod` lists `modernc.org/sqlite v1.x.x`; `go.sum` populated; `go build ./...` still passes (no consumers yet).

- [ ] **Step 2: Commit**

```bash
git add go.mod go.sum
git commit -m "chore: add modernc.org/sqlite for profile store"
```

---

## Task 2: Extend `conn.Profile` (TDD)

**Files:** `internal/conn/profile.go`, `internal/conn/profile_test.go` (new)

- [ ] **Step 1: Write the failing test**

Create `internal/conn/profile_test.go`:

```go
package conn

import "testing"

func TestProfileScopeValid(t *testing.T) {
	tests := []struct {
		name  string
		scope ProfileScope
		want  bool
	}{
		{"system valid", ProfileScopeSystem, true},
		{"personal valid", ProfileScopePersonal, true},
		{"unknown invalid", ProfileScope("other"), false},
		{"empty invalid", ProfileScope(""), false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.scope.Valid(); got != tc.want {
				t.Errorf("Valid() = %v, want %v", got, tc.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run the failing test**

```bash
go test ./internal/conn/ -run TestProfileScopeValid -v
```

Expected: FAIL — `undefined: ProfileScope`.

- [ ] **Step 3: Replace `internal/conn/profile.go`**

```go
// Package conn manages named upstream Geode connections.
//
// A Profile is a named upstream Geode endpoint: the HTTP API resolves a
// profile by name, and the JWT-bound user is constrained to a set of
// profile names via the "profiles" claim in their token.
//
// A Pool holds one *sql.DB per profile. Connections are lazy: the first
// DB(name) call opens the *sql.DB; subsequent calls return the same handle.
package conn

import "time"

// ProfileScope distinguishes admin-managed system profiles from
// per-user personal profiles. The store enforces (scope, owner_user_id,
// name) uniqueness and ownership semantics off this field.
type ProfileScope string

const (
	ProfileScopeSystem   ProfileScope = "system"
	ProfileScopePersonal ProfileScope = "personal"
)

// Valid reports whether the scope is one of the two recognised values.
func (s ProfileScope) Valid() bool {
	switch s {
	case ProfileScopeSystem, ProfileScopePersonal:
		return true
	}
	return false
}

// PoolOverrides holds per-profile pool tuning. Zero-valued fields fall
// back to the pool-wide PoolConfig defaults at *sql.DB construction.
type PoolOverrides struct {
	MaxOpenConns    int           `json:"max_open_conns,omitempty"`
	MaxIdleConns    int           `json:"max_idle_conns,omitempty"`
	ConnMaxLifetime time.Duration `json:"conn_max_lifetime,omitempty"`
	ConnMaxIdleTime time.Duration `json:"conn_max_idle_time,omitempty"`
}

// TLSMaterial is the PEM-encoded TLS material for a Geode upstream.
// Empty fields mean "do not present client cert" / "trust the system
// CA bundle". The legacy file-path fields on Profile are kept for the
// boot-time JSON migration path; sqlite Put/Patch only persist PEM text.
type TLSMaterial struct {
	CAPEM         string `json:"ca_pem,omitempty"`
	ClientCertPEM string `json:"client_cert_pem,omitempty"`
	ClientKeyPEM  string `json:"client_key_pem,omitempty"`
}

// Profile is a named upstream Geode endpoint.
type Profile struct {
	ID            string        `json:"id"`
	Scope         ProfileScope  `json:"scope"`
	OwnerUserID   string        `json:"owner_user_id,omitempty"` // empty when scope=system
	Name          string        `json:"name"`
	DSN           string        `json:"dsn"`
	Description   string        `json:"description,omitempty"`
	SavedUsername string        `json:"saved_username,omitempty"`
	Default       bool          `json:"is_default"`
	TLS           TLSMaterial   `json:"tls,omitempty"`
	PoolOverrides PoolOverrides `json:"pool_overrides,omitempty"`

	// Legacy file-path fields kept for boot-time JSON migration. The
	// store NEVER persists these; cmd/server/main.go:seedFromJSON reads
	// the file contents into the matching TLS PEM field at seed time.
	TLSCAFile      string `json:"tls_ca_file,omitempty"`
	ClientCertFile string `json:"client_cert_file,omitempty"`
	ClientKeyFile  string `json:"client_key_file,omitempty"`
}
```

- [ ] **Step 4: Run the test, expect PASS**

```bash
go test ./internal/conn/ -v
```

Expected: All conn tests pass — adding fields is additive and existing `NewPool([]Profile{{Name, DSN}})` callers still compile.

- [ ] **Step 5: Commit**

```bash
git add internal/conn/profile.go internal/conn/profile_test.go
git commit -m "feat(conn): extend Profile with scope, owner, TLS-PEM, pool overrides"
```

---

## Task 3: profilestore — schema constant

**Files:** `internal/profilestore/schema.go` (new)

- [ ] **Step 1: Write the schema**

```go
package profilestore

// Schema is the SQLite DDL for the profile store. The CREATE
// statements use IF NOT EXISTS for v0; future versions introduce a
// schema_migrations table and migrate forward from there.
const Schema = `
CREATE TABLE IF NOT EXISTS profiles (
	id                   TEXT    PRIMARY KEY,
	scope                TEXT    NOT NULL,
	owner_user_id        TEXT    NOT NULL DEFAULT '',
	name                 TEXT    NOT NULL,
	dsn                  TEXT    NOT NULL,
	description          TEXT    NOT NULL DEFAULT '',
	saved_username       TEXT    NOT NULL DEFAULT '',
	is_default           INTEGER NOT NULL DEFAULT 0,
	tls_ca_pem           TEXT    NOT NULL DEFAULT '',
	tls_cert_pem         TEXT    NOT NULL DEFAULT '',
	tls_key_pem          TEXT    NOT NULL DEFAULT '',
	max_open_conns       INTEGER NOT NULL DEFAULT 0,
	max_idle_conns       INTEGER NOT NULL DEFAULT 0,
	conn_max_lifetime_ns INTEGER NOT NULL DEFAULT 0,
	conn_max_idle_ns     INTEGER NOT NULL DEFAULT 0,
	created_at           INTEGER NOT NULL,
	updated_at           INTEGER NOT NULL,
	CHECK (scope IN ('system', 'personal')),
	UNIQUE (scope, owner_user_id, name)
);

CREATE INDEX IF NOT EXISTS profiles_owner_idx
	ON profiles (scope, owner_user_id);
`
```

- [ ] **Step 2: Commit**

```bash
git add internal/profilestore/schema.go
git commit -m "feat(profilestore): embedded SQLite DDL"
```

---

## Task 4: profilestore — Store interface + errors

**Files:** `internal/profilestore/store.go` (new), `internal/profilestore/errors.go` (new)

- [ ] **Step 1: Write `store.go`**

```go
package profilestore

import (
	"context"

	"geodedb.com/geode-ui/internal/conn"
)

// Filter narrows a List query. Empty fields disable that constraint;
// Scope="" returns both system and personal. OwnerUserID is only
// consulted when Scope=personal — system profiles ignore it because
// they are unowned by definition.
type Filter struct {
	Scope       conn.ProfileScope
	OwnerUserID string
}

// Store persists conn.Profile records. Implementations MUST be safe
// for concurrent use.
type Store interface {
	Get(ctx context.Context, id string) (conn.Profile, error)
	List(ctx context.Context, f Filter) ([]conn.Profile, error)
	// Put creates a new profile. p.ID may be empty; Put assigns a
	// random ID. Returns the persisted profile (with ID populated).
	Put(ctx context.Context, p conn.Profile) (conn.Profile, error)
	// Patch updates the profile at id with the supplied non-zero
	// fields. Scope and OwnerUserID are immutable; supplying a
	// different value returns ErrImmutable.
	Patch(ctx context.Context, id string, p conn.Profile) (conn.Profile, error)
	Delete(ctx context.Context, id string) error
	Close() error
}
```

- [ ] **Step 2: Write `errors.go`**

```go
package profilestore

import "errors"

var (
	ErrNotFound  = errors.New("profilestore: profile not found")
	ErrConflict  = errors.New("profilestore: profile name conflict in scope")
	ErrImmutable = errors.New("profilestore: scope and owner are immutable")
	ErrInvalid   = errors.New("profilestore: profile failed validation")
)
```

- [ ] **Step 3: Commit**

```bash
git add internal/profilestore/store.go internal/profilestore/errors.go
git commit -m "feat(profilestore): Store interface + typed errors"
```

---

## Task 5: profilestore — SQLite Open + List skeleton (TDD)

**Files:** `internal/profilestore/sqlite.go` (new), `internal/profilestore/helpers.go` (new), `internal/profilestore/duration.go` (new), `internal/profilestore/sqlite_test.go` (new)

- [ ] **Step 1: Write the failing test**

`internal/profilestore/sqlite_test.go`:

```go
package profilestore

import (
	"context"
	"testing"
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
```

- [ ] **Step 2: Run the failing test**

```bash
go test ./internal/profilestore/ -run TestSQLiteOpenAppliesSchema -v
```

Expected: FAIL — `undefined: OpenSQLite`.

- [ ] **Step 3: Write `duration.go`**

```go
package profilestore

import "time"

// nsAsDuration converts a nanosecond count read from SQLite into a
// time.Duration. Zero stays zero so the caller can distinguish "no
// override" from a literal zero duration downstream.
func nsAsDuration(ns int64) time.Duration {
	if ns == 0 {
		return 0
	}
	return time.Duration(ns)
}

// durationAsNs converts a time.Duration to an int64 nanosecond count
// for SQLite storage.
func durationAsNs(d time.Duration) int64 { return int64(d) }
```

- [ ] **Step 4: Write `helpers.go`**

```go
package profilestore

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
)

// boolAsInt encodes a bool as 1 or 0 for SQLite INTEGER storage.
func boolAsInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// newID returns a 16-byte hex-encoded random identifier. modernc.org/
// sqlite does not provide UUIDv7; for v0 a CSPRNG hex is sufficient —
// globally unique with overwhelming probability and indexed efficiently
// as TEXT.
func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// isUniqueViolation matches modernc.org/sqlite's UNIQUE-constraint
// error wrappers. The driver does not expose a typed error code, so
// we substring-match the message text. Both phrasings have been
// observed depending on driver version.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "UNIQUE constraint failed") ||
		strings.Contains(msg, "constraint failed: UNIQUE")
}
```

- [ ] **Step 5: Write `sqlite.go`**

```go
package profilestore

import (
	"context"
	"database/sql"
	"fmt"
	"sync"

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
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// scanFn matches the *sql.Row.Scan and *sql.Rows.Scan signatures so
// scanProfile is reusable from both Get and List.
type scanFn = func(dest ...any) error

func scanProfile(scan scanFn) (conn.Profile, error) {
	var (
		p                      conn.Profile
		def                    int
		lifetimeNs, idleNs     int64
	)
	err := scan(
		&p.ID, &p.Scope, &p.OwnerUserID, &p.Name, &p.DSN, &p.Description,
		&p.SavedUsername, &def, &p.TLS.CAPEM, &p.TLS.ClientCertPEM,
		&p.TLS.ClientKeyPEM, &p.PoolOverrides.MaxOpenConns,
		&p.PoolOverrides.MaxIdleConns, &lifetimeNs, &idleNs,
	)
	if err != nil {
		return conn.Profile{}, fmt.Errorf("profilestore: scan: %w", err)
	}
	p.Default = def != 0
	p.PoolOverrides.ConnMaxLifetime = nsAsDuration(lifetimeNs)
	p.PoolOverrides.ConnMaxIdleTime = nsAsDuration(idleNs)
	return p, nil
}

// Stubs for Put/Patch/Get/Delete; implemented in subsequent tasks.
func (s *sqliteStore) Put(ctx context.Context, p conn.Profile) (conn.Profile, error) {
	return conn.Profile{}, fmt.Errorf("profilestore: Put not implemented")
}
func (s *sqliteStore) Patch(ctx context.Context, id string, p conn.Profile) (conn.Profile, error) {
	return conn.Profile{}, fmt.Errorf("profilestore: Patch not implemented")
}
func (s *sqliteStore) Get(ctx context.Context, id string) (conn.Profile, error) {
	return conn.Profile{}, fmt.Errorf("profilestore: Get not implemented")
}
func (s *sqliteStore) Delete(ctx context.Context, id string) error {
	return fmt.Errorf("profilestore: Delete not implemented")
}
```

- [ ] **Step 6: Run the test, expect PASS**

```bash
go test ./internal/profilestore/ -run TestSQLiteOpenAppliesSchema -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add internal/profilestore/sqlite.go internal/profilestore/helpers.go internal/profilestore/duration.go internal/profilestore/sqlite_test.go
git commit -m "feat(profilestore): sqlite Open + List with WAL pragmas"
```

---

## Task 6: profilestore — Put + Get round-trip (TDD)

**Files:** `internal/profilestore/sqlite.go`, `internal/profilestore/sqlite_test.go`

- [ ] **Step 1: Append the failing test**

```go
import (
	"context"
	"errors"
	"testing"
	"time"

	"geodedb.com/geode-ui/internal/conn"
)

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
```

- [ ] **Step 2: Run the failing tests**

```bash
go test ./internal/profilestore/ -run 'TestSQLitePut|TestSQLiteGet' -v
```

Expected: FAIL — Put/Get return "not implemented".

- [ ] **Step 3: Replace the Put + Get stubs**

In `internal/profilestore/sqlite.go`:

```go
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
	return p, err
}
```

(Note: `scanProfile` already returns the wrapped scan error; the `sql.ErrNoRows` check needs to inspect the original error before wrapping. Adjust `scanProfile` to return raw scan errors, and let callers decide whether to wrap.)

Adjust `scanProfile` so it does NOT wrap the error:

```go
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
```

And update `List` to wrap:

```go
for rows.Next() {
	p, err := scanProfile(rows.Scan)
	if err != nil {
		return nil, fmt.Errorf("profilestore: scan: %w", err)
	}
	out = append(out, p)
}
```

- [ ] **Step 4: Run the tests, expect PASS**

```bash
go test ./internal/profilestore/ -v
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add internal/profilestore/sqlite.go internal/profilestore/sqlite_test.go
git commit -m "feat(profilestore): Put + Get with conflict + validation"
```

---

## Task 7: profilestore — Patch + Delete with immutability (TDD)

**Files:** `internal/profilestore/sqlite.go`, `internal/profilestore/sqlite_test.go`

- [ ] **Step 1: Append the failing tests**

```go
func TestSQLitePatchUpdatesFields(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice",
		Name: "p1", DSN: "quic://x:1",
	})
	updated, err := st.Patch(context.Background(), saved.ID, conn.Profile{
		Description:   "updated",
		SavedUsername: "alice@host",
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

func TestSQLitePatchRefusesScopeChange(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "sys", DSN: "quic://x:1",
	})
	_, err := st.Patch(context.Background(), saved.ID, conn.Profile{
		Scope: conn.ProfileScopePersonal,
	})
	if !errors.Is(err, ErrImmutable) {
		t.Errorf("Patch with new scope: want ErrImmutable, got %v", err)
	}
}

func TestSQLitePatchNotFound(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	_, err := st.Patch(context.Background(), "missing", conn.Profile{Description: "x"})
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
```

- [ ] **Step 2: Run the failing tests**

```bash
go test ./internal/profilestore/ -run 'TestSQLitePatch|TestSQLiteDelete' -v
```

Expected: FAIL — Patch / Delete return "not implemented".

- [ ] **Step 3: Implement Patch + Delete + mergeProfile**

Replace the stubs in `sqlite.go`:

```go
func (s *sqliteStore) Patch(ctx context.Context, id string, p conn.Profile) (conn.Profile, error) {
	cur, err := s.Get(ctx, id)
	if err != nil {
		return conn.Profile{}, err
	}
	if p.Scope != "" && p.Scope != cur.Scope {
		return conn.Profile{}, fmt.Errorf("%w: scope", ErrImmutable)
	}
	if p.OwnerUserID != "" && p.OwnerUserID != cur.OwnerUserID {
		return conn.Profile{}, fmt.Errorf("%w: owner_user_id", ErrImmutable)
	}
	merged := mergeProfile(cur, p)
	now := time.Now().UnixNano()

	s.mu.Lock()
	defer s.mu.Unlock()

	_, err = s.db.ExecContext(ctx, `
		UPDATE profiles SET
		  name = ?, dsn = ?, description = ?, saved_username = ?,
		  is_default = ?, tls_ca_pem = ?, tls_cert_pem = ?, tls_key_pem = ?,
		  max_open_conns = ?, max_idle_conns = ?,
		  conn_max_lifetime_ns = ?, conn_max_idle_ns = ?, updated_at = ?
		WHERE id = ?`,
		merged.Name, merged.DSN, merged.Description, merged.SavedUsername,
		boolAsInt(merged.Default), merged.TLS.CAPEM, merged.TLS.ClientCertPEM,
		merged.TLS.ClientKeyPEM, merged.PoolOverrides.MaxOpenConns,
		merged.PoolOverrides.MaxIdleConns,
		durationAsNs(merged.PoolOverrides.ConnMaxLifetime),
		durationAsNs(merged.PoolOverrides.ConnMaxIdleTime),
		now, id,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return conn.Profile{}, fmt.Errorf("%w: name=%s", ErrConflict, merged.Name)
		}
		return conn.Profile{}, fmt.Errorf("profilestore: patch: %w", err)
	}
	return merged, nil
}

func (s *sqliteStore) Delete(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
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

// mergeProfile applies non-zero fields of patch over cur. The Default
// flag is treated as set when patch.Default is true; clearing the
// default requires a separate "set default" semantic that v0 does not
// expose (the editor in plan D forces exactly one default at a time
// by clearing the previous default in a single transaction).
func mergeProfile(cur, patch conn.Profile) conn.Profile {
	out := cur
	if patch.Name != "" {
		out.Name = patch.Name
	}
	if patch.DSN != "" {
		out.DSN = patch.DSN
	}
	if patch.Description != "" {
		out.Description = patch.Description
	}
	if patch.SavedUsername != "" {
		out.SavedUsername = patch.SavedUsername
	}
	if patch.Default {
		out.Default = true
	}
	if patch.TLS.CAPEM != "" {
		out.TLS.CAPEM = patch.TLS.CAPEM
	}
	if patch.TLS.ClientCertPEM != "" {
		out.TLS.ClientCertPEM = patch.TLS.ClientCertPEM
	}
	if patch.TLS.ClientKeyPEM != "" {
		out.TLS.ClientKeyPEM = patch.TLS.ClientKeyPEM
	}
	if patch.PoolOverrides.MaxOpenConns != 0 {
		out.PoolOverrides.MaxOpenConns = patch.PoolOverrides.MaxOpenConns
	}
	if patch.PoolOverrides.MaxIdleConns != 0 {
		out.PoolOverrides.MaxIdleConns = patch.PoolOverrides.MaxIdleConns
	}
	if patch.PoolOverrides.ConnMaxLifetime != 0 {
		out.PoolOverrides.ConnMaxLifetime = patch.PoolOverrides.ConnMaxLifetime
	}
	if patch.PoolOverrides.ConnMaxIdleTime != 0 {
		out.PoolOverrides.ConnMaxIdleTime = patch.PoolOverrides.ConnMaxIdleTime
	}
	return out
}
```

- [ ] **Step 4: Run all profilestore tests, expect PASS**

```bash
go test ./internal/profilestore/ -v
```

Expected: All tests green.

- [ ] **Step 5: Commit**

```bash
git add internal/profilestore/sqlite.go internal/profilestore/sqlite_test.go
git commit -m "feat(profilestore): Patch + Delete + ErrImmutable / ErrNotFound"
```

---

## Task 8: conn.Pool.Reload (TDD)

**Files:** `internal/conn/pool.go`, `internal/conn/pool_test.go`

- [ ] **Step 1: Append the failing test**

```go
func TestPoolReloadKeepsExistingDBs(t *testing.T) {
	p, err := NewPool([]Profile{
		{Name: "a", DSN: "stub://a"},
		{Name: "b", DSN: "stub://b"},
	})
	if err != nil {
		t.Fatalf("NewPool: %v", err)
	}
	defer func() { _ = p.Close() }()

	dbA, err := p.DB("a")
	if err != nil {
		t.Fatalf("DB(a): %v", err)
	}

	if err := p.Reload([]Profile{
		{Name: "a", DSN: "stub://a"},
		{Name: "c", DSN: "stub://c"},
	}); err != nil {
		t.Fatalf("Reload: %v", err)
	}

	dbA2, err := p.DB("a")
	if err != nil {
		t.Fatalf("DB(a) after reload: %v", err)
	}
	if dbA != dbA2 {
		t.Errorf("Reload re-opened existing 'a' handle")
	}
	if _, err := p.DB("b"); err == nil {
		t.Errorf("DB(b) after reload: expected unknown-profile error, got nil")
	}
	if _, err := p.DB("c"); err != nil {
		t.Errorf("DB(c) after reload: %v", err)
	}
}

func TestPoolReloadRejectsEmpty(t *testing.T) {
	p, _ := NewPool([]Profile{{Name: "a", DSN: "stub://a"}})
	defer func() { _ = p.Close() }()
	if err := p.Reload(nil); err == nil {
		t.Errorf("Reload(nil): expected error, got nil")
	}
}
```

- [ ] **Step 2: Run the failing tests**

```bash
go test ./internal/conn/ -run TestPoolReload -v
```

Expected: FAIL — `Pool.Reload` undefined.

- [ ] **Step 3: Add Reload + applyOverrides to `pool.go`**

Append to `internal/conn/pool.go`:

```go
// Reload atomically swaps the registered profile set with the supplied
// slice. Profiles whose Name AND DSN are unchanged keep their existing
// *sql.DB handle (and any open connections). Profiles whose DSN has
// changed are Close()'d so the next DB() call re-opens against the new
// upstream. Per-profile PoolOverrides on kept handles are re-applied
// in-place via SetMaxOpenConns and friends.
//
// On any validation error the pool is left untouched.
func (p *Pool) Reload(profiles []Profile) error {
	if len(profiles) == 0 {
		return fmt.Errorf("conn: Reload requires at least one profile")
	}
	next := make(map[string]Profile, len(profiles))
	for i, prof := range profiles {
		if prof.Name == "" {
			return fmt.Errorf("conn: profile[%d] has empty Name", i)
		}
		if prof.DSN == "" {
			return fmt.Errorf("conn: profile %q has empty DSN", prof.Name)
		}
		if _, dup := next[prof.Name]; dup {
			return fmt.Errorf("conn: duplicate profile name %q", prof.Name)
		}
		next[prof.Name] = prof
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if p.dbs == nil {
		return fmt.Errorf("conn: pool is closed")
	}

	for name, db := range p.dbs {
		nextProf, kept := next[name]
		if !kept || nextProf.DSN != p.profiles[name].DSN {
			_ = db.Close()
			delete(p.dbs, name)
		}
	}
	for name, db := range p.dbs {
		applyOverrides(db, p.cfg, next[name].PoolOverrides)
	}
	p.profiles = next
	return nil
}

// applyOverrides resolves the effective pool tuning for a *sql.DB by
// preferring per-profile PoolOverrides where set, falling back to the
// pool-wide PoolConfig defaults. Called from both DB() (initial open)
// and Reload (in-place adjustment).
func applyOverrides(db *sql.DB, base *PoolConfig, ov PoolOverrides) {
	open := base.MaxOpenConns
	if ov.MaxOpenConns != 0 {
		open = ov.MaxOpenConns
	}
	idle := base.MaxIdleConns
	if ov.MaxIdleConns != 0 {
		idle = ov.MaxIdleConns
	}
	life := base.ConnMaxLifetime
	if ov.ConnMaxLifetime != 0 {
		life = ov.ConnMaxLifetime
	}
	idleT := base.ConnMaxIdleTime
	if ov.ConnMaxIdleTime != 0 {
		idleT = ov.ConnMaxIdleTime
	}
	db.SetMaxOpenConns(open)
	db.SetMaxIdleConns(idle)
	db.SetConnMaxLifetime(life)
	db.SetConnMaxIdleTime(idleT)
}
```

- [ ] **Step 4: Update `Pool.DB` to use applyOverrides on initial open**

Replace the four `db.Set...` calls at the end of `Pool.DB` with:

```go
applyOverrides(db, p.cfg, prof.PoolOverrides)
```

- [ ] **Step 5: Run conn tests, expect PASS**

```bash
go test ./internal/conn/ -v
```

Expected: All conn tests pass.

- [ ] **Step 6: Commit**

```bash
git add internal/conn/pool.go internal/conn/pool_test.go
git commit -m "feat(conn): Pool.Reload + per-profile pool overrides"
```

---

## Task 9: geode.json — schemas + CRUD endpoints

**Files:** `geode.json`

- [ ] **Step 1: Replace the existing `ProfileList` schema (around line 881) with the full schema set**

Find the block:

```json
"ProfileList": {
  "type": "object",
  "required": ["profiles"],
  "properties": {
    "profiles": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name":        { "type": "string" },
          "description": { "type": "string" }
        }
      }
    }
  }
}
```

Replace with:

```json
"ProfileScope": { "type": "string", "enum": ["system", "personal"] },

"PoolOverrides": {
  "type": "object",
  "properties": {
    "max_open_conns":       { "type": "integer", "minimum": 0 },
    "max_idle_conns":       { "type": "integer", "minimum": 0 },
    "conn_max_lifetime_ms": { "type": "integer", "minimum": 0 },
    "conn_max_idle_ms":     { "type": "integer", "minimum": 0 }
  }
},

"TLSMaterial": {
  "type": "object",
  "properties": {
    "ca_pem":          { "type": "string" },
    "client_cert_pem": { "type": "string" },
    "client_key_pem":  { "type": "string" }
  }
},

"Profile": {
  "type": "object",
  "required": ["id", "scope", "name", "dsn"],
  "properties": {
    "id":             { "type": "string", "minLength": 1, "maxLength": 64 },
    "scope":          { "$ref": "#/schemas/ProfileScope" },
    "owner_user_id":  { "type": "string" },
    "name":           { "type": "string", "minLength": 1, "maxLength": 64 },
    "dsn":            { "type": "string", "minLength": 1, "maxLength": 1024 },
    "description":    { "type": "string", "maxLength": 256 },
    "saved_username": { "type": "string", "maxLength": 128 },
    "is_default":     { "type": "boolean" },
    "tls":            { "$ref": "#/schemas/TLSMaterial" },
    "pool_overrides": { "$ref": "#/schemas/PoolOverrides" }
  }
},

"ProfileList": {
  "type": "object",
  "required": ["profiles"],
  "properties": {
    "profiles": { "type": "array", "items": { "$ref": "#/schemas/Profile" } }
  }
},

"ProfileIDPath": {
  "type": "object",
  "required": ["id"],
  "properties": { "id": { "type": "string", "minLength": 1, "maxLength": 64 } }
},

"CreateProfileReq": {
  "type": "object",
  "required": ["scope", "name", "dsn"],
  "properties": {
    "scope":          { "$ref": "#/schemas/ProfileScope" },
    "name":           { "type": "string", "minLength": 1, "maxLength": 64 },
    "dsn":            { "type": "string", "minLength": 1, "maxLength": 1024 },
    "description":    { "type": "string", "maxLength": 256 },
    "saved_username": { "type": "string", "maxLength": 128 },
    "is_default":     { "type": "boolean" },
    "tls":            { "$ref": "#/schemas/TLSMaterial" },
    "pool_overrides": { "$ref": "#/schemas/PoolOverrides" }
  }
},

"UpdateProfileReq": {
  "type": "object",
  "properties": {
    "name":           { "type": "string", "minLength": 1, "maxLength": 64 },
    "dsn":            { "type": "string", "minLength": 1, "maxLength": 1024 },
    "description":    { "type": "string", "maxLength": 256 },
    "saved_username": { "type": "string", "maxLength": 128 },
    "is_default":     { "type": "boolean" },
    "tls":            { "$ref": "#/schemas/TLSMaterial" },
    "pool_overrides": { "$ref": "#/schemas/PoolOverrides" }
  }
}
```

- [ ] **Step 2: Replace the existing `GET /api/v1/profiles` API entry (around line 405) with the CRUD set**

Find:

```json
{
  "method": "GET",
  "path": "/api/v1/profiles",
  "requestSchema": "Empty",
  "responseSchema": "ProfileList",
  "auth": "jwt",
  "rateLimit": 50
}
```

Replace with:

```json
{
  "method": "GET",
  "path": "/api/v1/profiles",
  "requestSchema": "Empty",
  "responseSchema": "ProfileList",
  "auth": "jwt",
  "rateLimit": 50
},
{
  "method": "POST",
  "path": "/api/v1/profiles",
  "requestSchema": "CreateProfileReq",
  "responseSchema": "Profile",
  "auth": "jwt",
  "rateLimit": 20
},
{
  "method": "GET",
  "path": "/api/v1/profiles/{id}",
  "requestSchema": "ProfileIDPath",
  "responseSchema": "Profile",
  "auth": "jwt",
  "rateLimit": 50
},
{
  "method": "PATCH",
  "path": "/api/v1/profiles/{id}",
  "requestSchema": "UpdateProfileReq",
  "responseSchema": "Profile",
  "auth": "jwt",
  "rateLimit": 20
},
{
  "method": "DELETE",
  "path": "/api/v1/profiles/{id}",
  "requestSchema": "ProfileIDPath",
  "responseSchema": "Empty",
  "auth": "jwt",
  "rateLimit": 20
}
```

(`required_roles` is intentionally omitted: ownership/admin gating happens in the handler because admins may edit `system` while owners may only edit their own `personal` — a flat role gate cannot express that.)

- [ ] **Step 3: Re-run genapi**

```bash
make generate
```

Expected: `gen/api/`, `gen/types/`, `gen/client/`, `gen/cmd/` regenerated. New types: `Profile`, `ProfileScope`, `CreateProfileReq`, `UpdateProfileReq`, `ProfileIDPath`, `PoolOverrides`, `TLSMaterial`. New `ServerInterface` methods: `CreateProfile`, `GetProfile`, `UpdateProfile`, `DeleteProfile`. (`Profiles` already existed and is regenerated against the new `ProfileList` shape.)

If generation fails, the genapi binary may need a rebuild (per `~/.claude/projects/.../memory/feedback_no_edit_generated_code.md`, the working copy is at `~/src/devnw/apps/genapi`). Do not hand-edit `gen/`.

- [ ] **Step 4: Verify the build now FAILS at the expected call sites**

```bash
go build ./...
```

Expected: Errors in `internal/server/handlers_profiles.go` because the response shape changed from `[]jsontext.Value` to `[]Profile`. The next task fixes those.

- [ ] **Step 5: Commit**

```bash
git add geode.json gen/
git commit -m "feat(genapi): Profile CRUD endpoints + full Profile schema"
```

---

## Task 10: Wire `Store` into `server.Config` and update `ProfileLookup`

**Files:** `internal/server/server.go`

- [ ] **Step 1: Extend the `ProfileLookup` interface and `Config`**

In `internal/server/server.go`, replace the `ProfileLookup` block:

```go
// ProfileLookup is the read-side abstraction over the connection pool's
// registered profile set. *conn.Pool satisfies this interface — Login
// uses Lookup to resolve the upstream DSN; Profiles handlers use
// Names/List for enumeration without leaking DSNs to non-owners.
type ProfileLookup interface {
	Lookup(name string) (conn.Profile, error)
	Names() []string
}
```

Replace with:

```go
// ProfileLookup is the read-side abstraction over the connection pool's
// registered profile set. *conn.Pool satisfies this interface — Login
// uses Lookup(name) to resolve the upstream DSN; Profiles handlers use
// Names() when only profile names are needed (legacy shape) and the
// store directly when richer per-profile data is required.
type ProfileLookup interface {
	Lookup(name string) (conn.Profile, error)
	Names() []string
}

// PoolReloader is the write-side abstraction satisfied by *conn.Pool.
// Profile CRUD handlers call Reload after a successful store mutation
// so the in-memory pool reflects the persisted truth without requiring
// a server restart.
type PoolReloader interface {
	Reload(profiles []conn.Profile) error
}
```

Add the import for `profilestore`:

```go
"geodedb.com/geode-ui/internal/profilestore"
```

Add the new fields to `Config`:

```go
// Store persists profile records and is the source of truth for
// scope=system + scope=personal profiles. Nil disables the CRUD
// endpoints (they 503). Tests that don't exercise CRUD may leave it
// nil and the legacy boot-time profile set still flows through Pool.
Store profilestore.Store

// PoolReloader is invoked after a successful mutation of Store so
// the in-memory connection pool tracks the persisted set. Typically
// the same *conn.Pool that backs Pool. Nil disables hot-reload.
PoolReloader PoolReloader
```

- [ ] **Step 2: Verify the build still fails at handlers_profiles.go (and only there)**

```bash
go build ./...
```

Expected: Errors confined to `handlers_profiles.go` (the response shape mismatch from Task 9).

- [ ] **Step 3: Commit**

```bash
git add internal/server/server.go
git commit -m "feat(server): Config gains Store + PoolReloader hooks"
```

---

## Task 11: Update `handlers_profiles.go` for the new response shape

**Files:** `internal/server/handlers_profiles.go`

- [ ] **Step 1: Replace the file**

```go
package server

import (
	"errors"
	"net/http"

	gentypes "geodedb.com/geode-ui/gen/types"
	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"
)

// Profiles implements GET /api/v1/profiles. It returns the set of
// profiles visible to the requesting user:
//
//   - system profiles are visible to all authenticated users (DSN +
//     TLS material redacted unless the caller has the admin role).
//   - personal profiles are visible only to their owner; the user_id
//     scope is read from the request's JWT claims.
//
// When Store is configured the response is sourced from it; otherwise
// the handler falls back to the legacy *conn.Pool name list (DSN
// always redacted, scope synthesised as "system") to preserve the
// pre-rebuild contract for old clients.
func (s *GraphServer) Profiles(_ http.ResponseWriter, r *http.Request, _ *gentypes.Empty) (*gentypes.ProfileList, error) {
	if s.cfg.Store != nil {
		ctx := r.Context()
		actor := actorFromContext(r.Context())
		isAdmin := hasRole(actor.Roles, "admin")

		sys, err := s.cfg.Store.List(ctx, profilestore.Filter{Scope: conn.ProfileScopeSystem})
		if err != nil {
			return nil, err
		}
		personal, err := s.cfg.Store.List(ctx, profilestore.Filter{
			Scope:       conn.ProfileScopePersonal,
			OwnerUserID: actor.Subject,
		})
		if err != nil {
			return nil, err
		}
		all := append(sys, personal...)
		out := make([]gentypes.Profile, 0, len(all))
		for _, p := range all {
			out = append(out, toGenProfile(p, isAdmin || p.OwnerUserID == actor.Subject))
		}
		return &gentypes.ProfileList{Profiles: out}, nil
	}

	// Legacy fallback: enumerate from the pool only.
	if s.cfg.Profiles == nil {
		return &gentypes.ProfileList{Profiles: nil}, nil
	}
	names := s.cfg.Profiles.Names()
	out := make([]gentypes.Profile, 0, len(names))
	for _, n := range names {
		out = append(out, gentypes.Profile{
			Id:    n,
			Scope: gentypes.ProfileScopeSystem,
			Name:  n,
		})
	}
	return &gentypes.ProfileList{Profiles: out}, nil
}

// toGenProfile converts a conn.Profile to its wire shape. When
// reveal=false (an unauthorised reader of someone else's personal
// profile, or a non-admin reader of a system profile), DSN, TLS, and
// pool_overrides are zeroed out so non-owners don't see connection
// secrets.
func toGenProfile(p conn.Profile, reveal bool) gentypes.Profile {
	out := gentypes.Profile{
		Id:          p.ID,
		Scope:       gentypes.ProfileScope(p.Scope),
		OwnerUserId: p.OwnerUserID,
		Name:        p.Name,
		Description: p.Description,
		IsDefault:   p.Default,
	}
	if reveal {
		out.Dsn = p.DSN
		out.SavedUsername = p.SavedUsername
		out.Tls = &gentypes.TLSMaterial{
			CaPem:         p.TLS.CAPEM,
			ClientCertPem: p.TLS.ClientCertPEM,
			ClientKeyPem:  p.TLS.ClientKeyPEM,
		}
		out.PoolOverrides = &gentypes.PoolOverrides{
			MaxOpenConns:       int64(p.PoolOverrides.MaxOpenConns),
			MaxIdleConns:       int64(p.PoolOverrides.MaxIdleConns),
			ConnMaxLifetimeMs:  int64(p.PoolOverrides.ConnMaxLifetime / 1_000_000),
			ConnMaxIdleMs:      int64(p.PoolOverrides.ConnMaxIdleTime / 1_000_000),
		}
	} else {
		out.Dsn = "" // explicit redaction
	}
	return out
}

// storeErrorToHTTP maps profilestore errors to endpointError values.
func storeErrorToHTTP(err error) *endpointError {
	switch {
	case errors.Is(err, profilestore.ErrNotFound):
		return &endpointError{status: http.StatusNotFound, code: "not_found", description: "profile not found"}
	case errors.Is(err, profilestore.ErrConflict):
		return &endpointError{status: http.StatusConflict, code: "conflict", description: "profile name already exists in this scope"}
	case errors.Is(err, profilestore.ErrImmutable):
		return &endpointError{status: http.StatusBadRequest, code: "immutable", description: "scope and owner cannot be changed"}
	case errors.Is(err, profilestore.ErrInvalid):
		return &endpointError{status: http.StatusBadRequest, code: "invalid", description: err.Error()}
	default:
		return &endpointError{status: http.StatusInternalServerError, code: "internal_error", description: err.Error()}
	}
}
```

> **Note:** The exact field names emitted by genapi (`Id` vs `ID`, `IsDefault` vs `Default`, `MaxOpenConns` vs the Go-camel form) depend on the generator's casing convention. Adjust references to match the post-`make generate` shape if they differ. If the generator emits `*gentypes.PoolOverrides` as a non-pointer struct, drop the `&` and the `*gentypes.TLSMaterial` accordingly.

- [ ] **Step 2: Add helpers if missing — `actorFromContext` and `hasRole`**

If those helpers don't already exist, locate them (likely in `internal/server/context.go` and `auth.go`). They almost certainly do — the `actor` pattern is used by `handlers_users.go`. Verify with:

```bash
grep -nE 'actorFromContext|hasRole' internal/server/*.go
```

Expected: matches in `context.go` and `auth.go`. If `hasRole` does not exist, add it to `context.go`:

```go
// hasRole reports whether the role list contains the named role,
// case-insensitively. Empty role list returns false for any name.
func hasRole(roles []string, name string) bool {
	for _, r := range roles {
		if strings.EqualFold(r, name) {
			return true
		}
	}
	return false
}
```

- [ ] **Step 3: Verify the build**

```bash
go build ./...
```

Expected: Compiles. (Errors here likely indicate field-name drift from genapi — adjust per the actual generated shape.)

- [ ] **Step 4: Run the existing profiles test**

```bash
go test ./internal/server/ -run TestProfiles -v
```

Expected: PASS. The handler still returns ProfileList; the legacy-fallback path keeps the old contract for tests that don't supply a Store.

- [ ] **Step 5: Commit**

```bash
git add internal/server/handlers_profiles.go internal/server/context.go
git commit -m "feat(server): Profiles handler returns full Profile shape with redaction"
```

---

## Task 12: Implement CreateProfile, GetProfile, UpdateProfile, DeleteProfile (TDD)

**Files:** `internal/server/handlers_profiles_crud.go` (new), `internal/server/handlers_profiles_crud_test.go` (new)

This task implements the four new genapi-emitted handler methods on `*GraphServer` with the ownership/admin gating matrix.

**Ownership matrix:**

| Op | system profile | personal profile (yours) | personal profile (someone else's) |
|---|---|---|---|
| GET | any auth user (redacted unless admin) | owner / admin (full) | 404 |
| POST scope=system | admin only | n/a | n/a |
| POST scope=personal (owner_user_id == actor.Subject) | n/a | any auth user | n/a |
| POST scope=personal (owner_user_id != actor.Subject) | n/a | n/a | 403 |
| PATCH | admin only | owner / admin | 404 (treat as not found to avoid enumeration) |
| DELETE | admin only | owner / admin | 404 |

- [ ] **Step 1: Write the failing tests**

Create `internal/server/handlers_profiles_crud_test.go`:

```go
package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// newTestServerWithStore builds a GraphServer wired to an in-memory
// store and an actor context middleware that injects (Subject, Roles)
// for ownership testing without a real JWT.
func newTestServerWithStore(t *testing.T) (*GraphServer, profilestore.Store) {
	t.Helper()
	st, err := profilestore.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	srv := New(Config{Store: st})
	return srv, st
}

func reqWithActor(method, path string, sub string, roles ...string) *http.Request {
	r := httptest.NewRequest(method, path, nil)
	ctx := withActor(r.Context(), actor{Subject: sub, Roles: roles})
	return r.WithContext(ctx)
}

func TestCreateProfile_PersonalOwner(t *testing.T) {
	srv, _ := newTestServerWithStore(t)
	r := reqWithActor("POST", "/api/v1/profiles", "alice")
	got, err := srv.CreateProfile(httptest.NewRecorder(), r, &gentypes.CreateProfileReq{
		Scope: gentypes.ProfileScopePersonal,
		Name:  "p1",
		Dsn:   "quic://x:1",
	})
	if err != nil {
		t.Fatalf("CreateProfile: %v", err)
	}
	if got == nil || got.Id == "" {
		t.Fatalf("CreateProfile returned %+v", got)
	}
	if got.OwnerUserId != "alice" {
		t.Errorf("OwnerUserId = %q, want alice", got.OwnerUserId)
	}
}

func TestCreateProfile_SystemRequiresAdmin(t *testing.T) {
	srv, _ := newTestServerWithStore(t)
	r := reqWithActor("POST", "/api/v1/profiles", "bob") // no roles
	w := httptest.NewRecorder()
	_, _ = srv.CreateProfile(w, r, &gentypes.CreateProfileReq{
		Scope: gentypes.ProfileScopeSystem, Name: "x", Dsn: "quic://x:1",
	})
	if w.Code != http.StatusForbidden {
		t.Errorf("non-admin POST system: status %d, want 403", w.Code)
	}
}

func TestCreateProfile_PersonalForOtherUser_Forbidden(t *testing.T) {
	srv, _ := newTestServerWithStore(t)
	r := reqWithActor("POST", "/api/v1/profiles", "alice")
	w := httptest.NewRecorder()
	_, _ = srv.CreateProfile(w, r, &gentypes.CreateProfileReq{
		Scope: gentypes.ProfileScopePersonal,
		Name:  "x", Dsn: "quic://x:1",
		OwnerUserId: "carol",
	})
	if w.Code != http.StatusForbidden {
		t.Errorf("alice creating for carol: status %d, want 403", w.Code)
	}
}

func TestUpdateProfile_OwnerOnly(t *testing.T) {
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopePersonal, OwnerUserID: "alice",
		Name: "p1", DSN: "quic://x:1",
	})
	// Bob (no admin) cannot edit alice's personal — must return 404 to
	// avoid leaking that the id exists.
	r := reqWithActor("PATCH", "/api/v1/profiles/"+saved.ID, "bob")
	w := httptest.NewRecorder()
	desc := "by bob"
	_, _ = srv.UpdateProfile(w, r, &gentypes.UpdateProfileReq{Description: desc}, gentypes.ProfileIDPath{Id: saved.ID})
	if w.Code != http.StatusNotFound {
		t.Errorf("non-owner PATCH: status %d, want 404", w.Code)
	}
}

func TestDeleteProfile_AdminCanDeleteSystem(t *testing.T) {
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "sys", DSN: "quic://x:1",
	})
	r := reqWithActor("DELETE", "/api/v1/profiles/"+saved.ID, "ops", "admin")
	w := httptest.NewRecorder()
	_, err := srv.DeleteProfile(w, r, &gentypes.ProfileIDPath{Id: saved.ID})
	if err != nil || (w.Code != 0 && w.Code/100 != 2) {
		t.Errorf("admin DELETE system: err=%v status=%d", err, w.Code)
	}
}

// Smoke check: response field names line up with toGenProfile.
func TestGetProfile_RedactsForNonOwner(t *testing.T) {
	srv, st := newTestServerWithStore(t)
	saved, _ := st.Put(context.Background(), conn.Profile{
		Scope: conn.ProfileScopeSystem, Name: "sys", DSN: "quic://secret:1",
	})
	r := reqWithActor("GET", "/api/v1/profiles/"+saved.ID, "alice") // no admin
	got, err := srv.GetProfile(httptest.NewRecorder(), r, &gentypes.ProfileIDPath{Id: saved.ID})
	if err != nil {
		t.Fatalf("GetProfile: %v", err)
	}
	if got.Dsn != "" || strings.Contains(got.Dsn, "secret") {
		t.Errorf("DSN leaked to non-admin: %q", got.Dsn)
	}
}
```

> **Helper note:** `withActor` and `actor` are exposed in `internal/server/context.go`. If they are unexported and unavailable to tests in another file in the same package, they're still reachable since the test file is in `package server` (same package). If your codebase uses a different middleware type (e.g. `actorContextKey`), substitute accordingly.

- [ ] **Step 2: Run the failing tests**

```bash
go test ./internal/server/ -run 'TestCreateProfile|TestUpdateProfile|TestDeleteProfile|TestGetProfile_Redacts' -v
```

Expected: FAIL — `srv.CreateProfile`, `srv.GetProfile`, `srv.UpdateProfile`, `srv.DeleteProfile` may be inherited from `genapi.UnimplementedServer` returning a not-implemented error, OR may not exist yet if the codegen output differs.

- [ ] **Step 3: Implement the handlers**

Create `internal/server/handlers_profiles_crud.go`:

```go
package server

import (
	"net/http"

	gentypes "geodedb.com/geode-ui/gen/types"
	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"
)

// CreateProfile implements POST /api/v1/profiles.
func (s *GraphServer) CreateProfile(w http.ResponseWriter, r *http.Request, req *gentypes.CreateProfileReq) (*gentypes.Profile, error) {
	if s.cfg.Store == nil {
		writeEndpointError(w, &endpointError{status: http.StatusServiceUnavailable, code: "store_disabled", description: "profile store not configured"})
		return nil, nil
	}
	actor := actorFromContext(r.Context())
	isAdmin := hasRole(actor.Roles, "admin")
	scope := conn.ProfileScope(req.Scope)
	if !scope.Valid() {
		writeEndpointError(w, &endpointError{status: http.StatusBadRequest, code: "invalid_scope", description: "scope must be 'system' or 'personal'"})
		return nil, nil
	}

	owner := req.OwnerUserId
	switch scope {
	case conn.ProfileScopeSystem:
		if !isAdmin {
			writeEndpointError(w, &endpointError{status: http.StatusForbidden, code: "forbidden", description: "system profiles require the admin role"})
			return nil, nil
		}
		owner = "" // system profiles have no owner
	case conn.ProfileScopePersonal:
		if owner == "" {
			owner = actor.Subject
		}
		if owner != actor.Subject && !isAdmin {
			writeEndpointError(w, &endpointError{status: http.StatusForbidden, code: "forbidden", description: "cannot create personal profile for another user"})
			return nil, nil
		}
	}

	saved, err := s.cfg.Store.Put(r.Context(), conn.Profile{
		Scope:         scope,
		OwnerUserID:   owner,
		Name:          req.Name,
		DSN:           req.Dsn,
		Description:   req.Description,
		SavedUsername: req.SavedUsername,
		Default:       req.IsDefault,
		TLS:           tlsFromGen(req.Tls),
		PoolOverrides: poolOverridesFromGen(req.PoolOverrides),
	})
	if err != nil {
		writeEndpointError(w, storeErrorToHTTP(err))
		return nil, nil
	}
	s.maybeReload(r.Context())
	g := toGenProfile(saved, true)
	return &g, nil
}

// GetProfile implements GET /api/v1/profiles/{id}.
func (s *GraphServer) GetProfile(w http.ResponseWriter, r *http.Request, req *gentypes.ProfileIDPath) (*gentypes.Profile, error) {
	if s.cfg.Store == nil {
		writeEndpointError(w, &endpointError{status: http.StatusServiceUnavailable, code: "store_disabled"})
		return nil, nil
	}
	actor := actorFromContext(r.Context())
	isAdmin := hasRole(actor.Roles, "admin")
	p, err := s.cfg.Store.Get(r.Context(), req.Id)
	if err != nil {
		writeEndpointError(w, storeErrorToHTTP(err))
		return nil, nil
	}
	if p.Scope == conn.ProfileScopePersonal && p.OwnerUserID != actor.Subject && !isAdmin {
		writeEndpointError(w, &endpointError{status: http.StatusNotFound, code: "not_found", description: "profile not found"})
		return nil, nil
	}
	reveal := isAdmin || p.OwnerUserID == actor.Subject
	g := toGenProfile(p, reveal)
	return &g, nil
}

// UpdateProfile implements PATCH /api/v1/profiles/{id}.
func (s *GraphServer) UpdateProfile(w http.ResponseWriter, r *http.Request, req *gentypes.UpdateProfileReq, path gentypes.ProfileIDPath) (*gentypes.Profile, error) {
	if s.cfg.Store == nil {
		writeEndpointError(w, &endpointError{status: http.StatusServiceUnavailable, code: "store_disabled"})
		return nil, nil
	}
	actor := actorFromContext(r.Context())
	isAdmin := hasRole(actor.Roles, "admin")

	cur, err := s.cfg.Store.Get(r.Context(), path.Id)
	if err != nil {
		writeEndpointError(w, storeErrorToHTTP(err))
		return nil, nil
	}
	if !canMutate(cur, actor, isAdmin) {
		// 404 not 403 — don't leak existence to non-owners.
		writeEndpointError(w, &endpointError{status: http.StatusNotFound, code: "not_found", description: "profile not found"})
		return nil, nil
	}
	patch := conn.Profile{
		Name:          req.Name,
		DSN:           req.Dsn,
		Description:   req.Description,
		SavedUsername: req.SavedUsername,
		Default:       req.IsDefault,
		TLS:           tlsFromGen(req.Tls),
		PoolOverrides: poolOverridesFromGen(req.PoolOverrides),
	}
	updated, err := s.cfg.Store.Patch(r.Context(), path.Id, patch)
	if err != nil {
		writeEndpointError(w, storeErrorToHTTP(err))
		return nil, nil
	}
	s.maybeReload(r.Context())
	g := toGenProfile(updated, true)
	return &g, nil
}

// DeleteProfile implements DELETE /api/v1/profiles/{id}.
func (s *GraphServer) DeleteProfile(w http.ResponseWriter, r *http.Request, req *gentypes.ProfileIDPath) (*gentypes.Empty, error) {
	if s.cfg.Store == nil {
		writeEndpointError(w, &endpointError{status: http.StatusServiceUnavailable, code: "store_disabled"})
		return nil, nil
	}
	actor := actorFromContext(r.Context())
	isAdmin := hasRole(actor.Roles, "admin")
	cur, err := s.cfg.Store.Get(r.Context(), req.Id)
	if err != nil {
		writeEndpointError(w, storeErrorToHTTP(err))
		return nil, nil
	}
	if !canMutate(cur, actor, isAdmin) {
		writeEndpointError(w, &endpointError{status: http.StatusNotFound, code: "not_found", description: "profile not found"})
		return nil, nil
	}
	if err := s.cfg.Store.Delete(r.Context(), req.Id); err != nil {
		writeEndpointError(w, storeErrorToHTTP(err))
		return nil, nil
	}
	s.maybeReload(r.Context())
	return &gentypes.Empty{}, nil
}

func canMutate(p conn.Profile, a actor, isAdmin bool) bool {
	switch p.Scope {
	case conn.ProfileScopeSystem:
		return isAdmin
	case conn.ProfileScopePersonal:
		return isAdmin || p.OwnerUserID == a.Subject
	}
	return false
}

func tlsFromGen(t *gentypes.TLSMaterial) conn.TLSMaterial {
	if t == nil {
		return conn.TLSMaterial{}
	}
	return conn.TLSMaterial{
		CAPEM:         t.CaPem,
		ClientCertPEM: t.ClientCertPem,
		ClientKeyPEM:  t.ClientKeyPem,
	}
}

func poolOverridesFromGen(o *gentypes.PoolOverrides) conn.PoolOverrides {
	if o == nil {
		return conn.PoolOverrides{}
	}
	return conn.PoolOverrides{
		MaxOpenConns:    int(o.MaxOpenConns),
		MaxIdleConns:    int(o.MaxIdleConns),
		ConnMaxLifetime: durationFromMs(o.ConnMaxLifetimeMs),
		ConnMaxIdleTime: durationFromMs(o.ConnMaxIdleMs),
	}
}

func durationFromMs(ms int64) time.Duration {
	if ms <= 0 {
		return 0
	}
	return time.Duration(ms) * time.Millisecond
}
```

Add the missing imports (`time`) and the helper signature for `s.maybeReload`:

```go
// maybeReload calls PoolReloader.Reload with the union of system +
// personal profiles, so the live pool tracks the persisted set. Errors
// are logged but not returned to the caller — the mutation has already
// been persisted; a failed reload only means the next process restart
// (or the next mutation that succeeds) will pick up the new shape.
func (s *GraphServer) maybeReload(ctx context.Context) {
	if s.cfg.PoolReloader == nil || s.cfg.Store == nil {
		return
	}
	all, err := s.cfg.Store.List(ctx, profilestore.Filter{})
	if err != nil {
		slog.Warn("profile reload: list failed", "err", err)
		return
	}
	if len(all) == 0 {
		// Reload requires non-empty input; skip and let the next
		// successful mutation (which itself will re-list) cover it.
		return
	}
	if err := s.cfg.PoolReloader.Reload(all); err != nil {
		slog.Warn("profile reload: pool refused new set", "err", err)
	}
}
```

Add the imports `"context"` and `"log/slog"` if not present.

- [ ] **Step 4: Run the tests, expect PASS**

```bash
go test ./internal/server/ -run 'TestCreateProfile|TestUpdateProfile|TestDeleteProfile|TestGetProfile_Redacts' -v
```

Expected: All tests pass. If a test fails on the actor-context wiring, audit `internal/server/context.go` for the actual `withActor` / `actorFromContext` symbol names and adjust the test helper.

- [ ] **Step 5: Commit**

```bash
git add internal/server/handlers_profiles_crud.go internal/server/handlers_profiles_crud_test.go
git commit -m "feat(server): Profile CRUD handlers with ownership/admin gating"
```

---

## Task 13: Wire the Store into `cmd/server/main.go` with JSON seed migration

**Files:** `cmd/server/main.go`

- [ ] **Step 1: Add the `-profile-store` flag**

In the flag block:

```go
var (
	listen        string
	profilesFile  string
	profileStore  string
	secretHex     string
	jwtTTL        time.Duration
	adminUsers    string
	uploadDir     string
	secureCookies bool
)
flag.StringVar(&listen, "listen", ":8080", "address to listen on")
flag.StringVar(&profilesFile, "profiles", "", "path to JSON profiles config; on first launch with -profile-store empty, seeds the store as scope=system profiles, then is unused")
flag.StringVar(&profileStore, "profile-store", "/var/lib/geode-ui/profiles.db", "path to the SQLite profile store; profiles can be CRUD'd at runtime via /api/v1/profiles. ':memory:' for ephemeral test runs")
// ... existing flags
```

- [ ] **Step 2: Open the store and seed if empty**

After the existing `pool, err := conn.NewPool(profiles)` block, but before `defer pool.Close()`, add:

```go
store, err := profilestore.OpenSQLite(profileStore)
if err != nil {
	slog.Error("profile store open", "err", err)
	os.Exit(1)
}
defer func() { _ = store.Close() }()

// First-launch seed: if the store has zero profiles AND a -profiles
// JSON file was supplied, seed the store with the JSON contents as
// scope=system. Subsequent launches respect whatever's in the store —
// the JSON file is one-shot.
if err := seedFromJSON(context.Background(), store, profiles); err != nil {
	slog.Error("profile store seed", "err", err)
	os.Exit(1)
}

// Make the persisted set the source of truth for the in-memory pool.
if err := reloadPoolFromStore(context.Background(), store, pool); err != nil {
	slog.Error("profile pool reload", "err", err)
	os.Exit(1)
}
```

- [ ] **Step 3: Add the seed + reload helpers at the bottom of `main.go`**

```go
// seedFromJSON populates an empty store with the supplied profiles as
// scope=system. PEM material is read from the legacy file paths if
// present so existing deployments migrate cleanly. A non-empty store
// is left untouched.
func seedFromJSON(ctx context.Context, store profilestore.Store, profiles []conn.Profile) error {
	existing, err := store.List(ctx, profilestore.Filter{})
	if err != nil {
		return fmt.Errorf("list: %w", err)
	}
	if len(existing) > 0 {
		return nil
	}
	for _, p := range profiles {
		p.Scope = conn.ProfileScopeSystem
		p.OwnerUserID = ""
		if err := loadTLSFiles(&p); err != nil {
			return fmt.Errorf("load tls for %q: %w", p.Name, err)
		}
		if _, err := store.Put(ctx, p); err != nil {
			return fmt.Errorf("seed %q: %w", p.Name, err)
		}
	}
	return nil
}

func loadTLSFiles(p *conn.Profile) error {
	if p.TLSCAFile != "" && p.TLS.CAPEM == "" {
		b, err := os.ReadFile(p.TLSCAFile)
		if err != nil {
			return err
		}
		p.TLS.CAPEM = string(b)
	}
	if p.ClientCertFile != "" && p.TLS.ClientCertPEM == "" {
		b, err := os.ReadFile(p.ClientCertFile)
		if err != nil {
			return err
		}
		p.TLS.ClientCertPEM = string(b)
	}
	if p.ClientKeyFile != "" && p.TLS.ClientKeyPEM == "" {
		b, err := os.ReadFile(p.ClientKeyFile)
		if err != nil {
			return err
		}
		p.TLS.ClientKeyPEM = string(b)
	}
	return nil
}

func reloadPoolFromStore(ctx context.Context, store profilestore.Store, pool *conn.Pool) error {
	all, err := store.List(ctx, profilestore.Filter{})
	if err != nil {
		return err
	}
	if len(all) == 0 {
		return nil
	}
	return pool.Reload(all)
}
```

Add the import `"geodedb.com/geode-ui/internal/profilestore"` and `"fmt"` if missing.

- [ ] **Step 4: Wire `Store` and `PoolReloader` into `Config`**

Update the `srv := server.New(server.Config{...})` block:

```go
srv := server.New(server.Config{
	Version:        "v0.1.0",
	Pool:           pool,
	Profiles:       pool,
	JWT:            issuer,
	TxStore:        server.NewTxStore(),
	AdminUsernames: adminSet,
	UploadDir:      uploadDir,
	SecureCookies:  secureCookies,
	Store:          store,
	PoolReloader:   pool,
})
```

- [ ] **Step 5: Verify the build**

```bash
go build ./...
```

Expected: Compiles cleanly.

- [ ] **Step 6: Run the full test suite**

```bash
go test ./...
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add cmd/server/main.go
git commit -m "feat(server): wire profilestore + JSON seed migration + hot reload"
```

---

## Task 14: End-to-end smoke (manual verification)

This is a one-shot manual smoke test that exercises the full path from a fresh launch to a runtime-created profile that survives a server restart.

**Files:** none

- [ ] **Step 1: Build the server**

```bash
make build
```

Expected: `bin/geode-ui` (or equivalent) built without errors.

- [ ] **Step 2: Launch with an empty store**

```bash
rm -f /tmp/geode-ui-test.db
./bin/geode-ui \
  -profile-store /tmp/geode-ui-test.db \
  -profiles ./testdata/profiles.json \
  -jwt-secret-hex "$(openssl rand -hex 32)" \
  -admin-users geode \
  -listen :8090 &
SERVER_PID=$!
```

Expected: server starts; SQLite file is created and seeded from the JSON file.

- [ ] **Step 3: Login and create a personal profile**

```bash
TOKEN=$(curl -s -X POST http://localhost:8090/api/v1/auth/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'username=geode&password=...&profile=default' | jq -r .access_token)

curl -s -X POST http://localhost:8090/api/v1/profiles \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"scope":"personal","name":"my-dev","dsn":"quic://127.0.0.1:3141"}' | jq .
```

Expected: 200 with the new profile JSON, including a generated `id` and `owner_user_id` matching the logged-in user.

- [ ] **Step 4: List profiles**

```bash
curl -s http://localhost:8090/api/v1/profiles \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Expected: an array containing both the seeded `default` (system) and the new `my-dev` (personal).

- [ ] **Step 5: Restart server, confirm persistence**

```bash
kill $SERVER_PID
./bin/geode-ui \
  -profile-store /tmp/geode-ui-test.db \
  -jwt-secret-hex "$(openssl rand -hex 32)" \
  -admin-users geode \
  -listen :8090 &
# Re-login (new JWT secret means old token is invalid).
TOKEN=$(curl -s -X POST http://localhost:8090/api/v1/auth/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'username=geode&password=...&profile=default' | jq -r .access_token)
curl -s http://localhost:8090/api/v1/profiles \
  -H "Authorization: Bearer $TOKEN" | jq '.profiles[].name'
```

Expected: still lists both `default` and `my-dev` — the persisted store survived the restart, no JSON re-seed.

- [ ] **Step 6: Cleanup + commit smoke evidence**

```bash
kill $SERVER_PID
rm -f /tmp/geode-ui-test.db
```

If anything in the smoke surfaces a regression, fix it in a follow-up commit before declaring Plan A complete. Otherwise:

```bash
git tag -a v0.2.0-plan-A-server-foundation -m "Plan A: profile persistence + CRUD complete"
```

---

## Self-review checklist (executed before handoff)

- [x] **Spec coverage:** Every architectural decision from the overview that lands on the server side is covered (system + personal profiles, ownership-gated CRUD, runtime mutability, TLS PEM, pool overrides, default flag, saved username).
- [x] **No placeholders:** Every step has a concrete code block or exact command.
- [x] **TDD discipline:** Every behavioural change has a failing test written first.
- [x] **Type consistency:** `Profile`, `ProfileScope`, `TLSMaterial`, `PoolOverrides`, `Filter` referenced consistently across the plan; the genapi-emitted casing (`Id` vs `ID` etc.) is called out as a known drift point with a single rule (match the post-`make generate` shape).
- [x] **Frequent commits:** Every task ends in a commit. Plan A produces 13 commits + 1 tag.
- [x] **Bite-sized:** No single step exceeds 5 minutes of focused work; the longest are the genapi schema replacement (Task 9) and the handler implementation (Task 12), both of which are mechanical paste-and-adjust.

## Out of scope (deferred to subsequent plans)

- **Multi-session JWT / per-connection bearer / `X-Geode-Connection`** — Plan B
- **Login UX rebuild** (profile picker dropdown, "+ Add connection") — Plan C
- **Connection switcher in the top bar** — Plan C
- **Profile editor page** (TLS material upload, pool tuning UI) — Plan D
- **Electron file-pick + safeStorage + auto-restore connections** — Plan E
- **Per-profile audit log of CRUD events** — would slot under Plan A as a v1 follow-up; not required for v0
- **`PUT /api/v1/profiles/{id}` (full replace)** — `PATCH` covers v0 needs; `PUT` is a YAGNI follow-up

---

## Execution Handoff

Plan A is saved to `docs/superpowers/plans/2026-05-09-profile-system-rebuild-A-server-foundation.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — Each task dispatched to a fresh subagent with the two-stage review gate from `superpowers:subagent-driven-development`. Best when the codebase context is heavy (genapi regen, server pkg) and a fresh agent per task avoids context drift.
2. **Inline Execution** — Execute tasks in this session via `superpowers:executing-plans`, batched at the natural commit boundaries.

When ready, ask for **Plan B (multi-session auth)** to be drafted next.
