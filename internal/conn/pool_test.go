package conn

import (
	"database/sql"
	"database/sql/driver"
	"io"
	"reflect"
	"testing"
	"time"
)

// stubDriver is a no-op database/sql driver used by pool tests that need to
// call Pool.DB() without a live Geode server. It accepts any DSN.
type stubDriver struct{}
type stubConn struct{}

func (d *stubDriver) Open(_ string) (driver.Conn, error) { return &stubConn{}, nil }
func (c *stubConn) Prepare(string) (driver.Stmt, error)  { return nil, io.ErrUnexpectedEOF }
func (c *stubConn) Close() error                         { return nil }
func (c *stubConn) Begin() (driver.Tx, error)            { return nil, io.ErrUnexpectedEOF }

func init() {
	sql.Register("stub", &stubDriver{})
}

// stubOpener is an sql.Open-compatible function that always uses the "stub"
// driver, regardless of the driver name passed. Assign to p.dbOpener in tests
// that need to call Pool.DB() without a live Geode server.
func stubOpener(_, dsn string) (*sql.DB, error) {
	return sql.Open("stub", dsn)
}

func TestPool_Lookup(t *testing.T) {
	p, err := NewPool([]Profile{
		{Name: "local", DSN: "quic://127.0.0.1:3141"},
		{Name: "ci", DSN: "grpc://127.0.0.1:50051"},
	})
	if err != nil {
		t.Fatalf("NewPool: %v", err)
	}
	t.Cleanup(func() { _ = p.Close() })

	if _, err := p.Lookup("local"); err != nil {
		t.Fatalf("Lookup(local): %v", err)
	}
	if _, err := p.Lookup("missing"); err == nil {
		t.Fatalf("Lookup(missing): want error, got nil")
	}
}

func TestPool_DuplicateNames(t *testing.T) {
	_, err := NewPool([]Profile{
		{Name: "x", DSN: "quic://h:1"},
		{Name: "x", DSN: "quic://h:2"},
	})
	if err == nil {
		t.Fatalf("want error on duplicate name")
	}
}

func TestPool_EmptyProfiles(t *testing.T) {
	if _, err := NewPool(nil); err == nil {
		t.Fatalf("want error for empty profile slice")
	}
}

func TestPool_EmptyName(t *testing.T) {
	_, err := NewPool([]Profile{{Name: "", DSN: "quic://h:1"}})
	if err == nil {
		t.Fatalf("want error for empty Name")
	}
}

func TestPool_EmptyDSN(t *testing.T) {
	_, err := NewPool([]Profile{{Name: "x", DSN: ""}})
	if err == nil {
		t.Fatalf("want error for empty DSN")
	}
}

func TestPool_Names(t *testing.T) {
	p, err := NewPool([]Profile{
		{Name: "zeta", DSN: "quic://h:1"},
		{Name: "alpha", DSN: "quic://h:2"},
		{Name: "mu", DSN: "quic://h:3"},
	})
	if err != nil {
		t.Fatalf("NewPool: %v", err)
	}
	t.Cleanup(func() { _ = p.Close() })

	got := p.Names()
	want := []string{"alpha", "mu", "zeta"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Names() = %v, want %v", got, want)
	}
}

func TestPool_DefaultConfigSensibleValues(t *testing.T) {
	// Pool sizing must match the documented operational target of
	// 2000 rps sustained / 400 rps burst (PERF-F11 / issue #55).
	cfg := DefaultPoolConfig()
	if cfg.MaxOpenConns != 64 {
		t.Errorf("MaxOpenConns: got %d, want 64", cfg.MaxOpenConns)
	}
	if cfg.MaxIdleConns != 16 {
		t.Errorf("MaxIdleConns: got %d, want 16", cfg.MaxIdleConns)
	}
	if cfg.ConnMaxLifetime != 5*time.Minute {
		t.Errorf("ConnMaxLifetime: got %v, want 5m", cfg.ConnMaxLifetime)
	}
	if cfg.ConnMaxIdleTime != 25*time.Second {
		t.Errorf("ConnMaxIdleTime: got %v, want 25s", cfg.ConnMaxIdleTime)
	}
}

// TestPool_DB_AppliesDefaultLimits verifies the bumped defaults flow
// through to the underlying *sql.DB via SetMaxOpenConns. Stats()
// exposes MaxOpenConnections, which we read back to confirm the value
// the database/sql layer is actually enforcing.
func TestPool_DB_AppliesDefaultLimits(t *testing.T) {
	p, err := NewPool([]Profile{
		{Name: "local", DSN: "quic://127.0.0.1:3141"},
	})
	if err != nil {
		t.Fatalf("NewPool: %v", err)
	}
	t.Cleanup(func() { _ = p.Close() })
	p.dbOpener = stubOpener

	db, err := p.DB("local")
	if err != nil {
		t.Fatalf("DB(local): %v", err)
	}
	if got := db.Stats().MaxOpenConnections; got != 64 {
		t.Errorf("Stats().MaxOpenConnections: got %d, want 64", got)
	}
}

func TestPool_WithOptions_Override(t *testing.T) {
	p, err := NewPool(
		[]Profile{{Name: "local", DSN: "quic://127.0.0.1:3141"}},
		WithMaxOpenConns(64),
		WithMaxIdleConns(8),
		WithConnMaxLifetime(10*time.Minute),
		WithConnMaxIdleTime(15*time.Second),
	)
	if err != nil {
		t.Fatalf("NewPool: %v", err)
	}
	t.Cleanup(func() { _ = p.Close() })

	if p.cfg.MaxOpenConns != 64 {
		t.Errorf("MaxOpenConns: got %d, want 64", p.cfg.MaxOpenConns)
	}
	if p.cfg.MaxIdleConns != 8 {
		t.Errorf("MaxIdleConns: got %d, want 8", p.cfg.MaxIdleConns)
	}
	if p.cfg.ConnMaxLifetime != 10*time.Minute {
		t.Errorf("ConnMaxLifetime: got %v, want 10m", p.cfg.ConnMaxLifetime)
	}
	if p.cfg.ConnMaxIdleTime != 15*time.Second {
		t.Errorf("ConnMaxIdleTime: got %v, want 15s", p.cfg.ConnMaxIdleTime)
	}
}

func TestPool_DB_LazyAndCached(t *testing.T) {
	p, err := NewPool([]Profile{
		{Name: "local", DSN: "quic://127.0.0.1:3141"},
	})
	if err != nil {
		t.Fatalf("NewPool: %v", err)
	}
	t.Cleanup(func() { _ = p.Close() })
	p.dbOpener = stubOpener

	db1, err := p.DB("local")
	if err != nil {
		t.Fatalf("DB(local): %v", err)
	}
	if db1 == nil {
		t.Fatalf("DB(local) returned nil")
	}

	db2, err := p.DB("local")
	if err != nil {
		t.Fatalf("DB(local) second call: %v", err)
	}
	if db1 != db2 {
		t.Fatalf("DB(local) returned different *sql.DB on second call; want cached")
	}

	if _, err := p.DB("missing"); err == nil {
		t.Fatalf("DB(missing): want error, got nil")
	}
}

func TestPool_Close_Idempotent(t *testing.T) {
	p, err := NewPool([]Profile{
		{Name: "local", DSN: "quic://127.0.0.1:3141"},
	})
	if err != nil {
		t.Fatalf("NewPool: %v", err)
	}
	p.dbOpener = stubOpener

	// Force a *sql.DB to exist so Close has something to do.
	if _, err := p.DB("local"); err != nil {
		t.Fatalf("DB(local): %v", err)
	}

	if err := p.Close(); err != nil {
		t.Fatalf("first Close: %v", err)
	}
	if err := p.Close(); err != nil {
		t.Fatalf("second Close (must be idempotent): %v", err)
	}

	if _, err := p.DB("local"); err == nil {
		t.Fatalf("DB after Close: want error, got nil")
	}
}

func TestPoolReloadKeepsExistingDBs(t *testing.T) {
	p, err := NewPool([]Profile{
		{Name: "a", DSN: "stub://a"},
		{Name: "b", DSN: "stub://b"},
	})
	if err != nil {
		t.Fatalf("NewPool: %v", err)
	}
	defer func() { _ = p.Close() }()
	p.dbOpener = stubOpener

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
