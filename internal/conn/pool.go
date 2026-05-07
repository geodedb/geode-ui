package conn

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"sync"
	"time"

	// Registers the "geode" sql driver via init().
	_ "geodedb.com/geode"
)

// driverName is the database/sql driver name registered by the
// geodedb.com/geode package's init() function. See
// geode-client-go/driver.go: sql.Register("geode", &Driver{}).
const driverName = "geode"

// Default pool settings. Sized for the documented operational target of
// 2000 rps sustained with a 400 rps burst (PERF-F11 / issue #55). The
// previous defaults of 16 open / 4 idle saturated under that load and
// caused tail-latency spikes; 64 open / 16 idle keeps QUIC stream
// multiplexing healthy without exhausting the upstream Geode server's
// connection budget. ConnMaxIdleTime stays at 25s, just under the
// server-side QUIC idle timeout (default 30s).
const (
	defaultMaxOpenConns    = 64
	defaultMaxIdleConns    = 16
	defaultConnMaxLifetime = 5 * time.Minute
	defaultConnMaxIdleTime = 25 * time.Second
)

// PoolConfig holds tunable pool-wide settings applied to every *sql.DB
// opened by the Pool. Values are populated by DefaultPoolConfig and may be
// overridden via PoolOption arguments to NewPool.
type PoolConfig struct {
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
	ConnMaxIdleTime time.Duration
}

// DefaultPoolConfig returns the recommended defaults for a Geode connection
// pool: 64 open / 16 idle / 5 minute lifetime / 25 second idle, sized for
// the documented 2000 rps sustained / 400 rps burst operational target
// (PERF-F11 / issue #55).
func DefaultPoolConfig() *PoolConfig {
	return &PoolConfig{
		MaxOpenConns:    defaultMaxOpenConns,
		MaxIdleConns:    defaultMaxIdleConns,
		ConnMaxLifetime: defaultConnMaxLifetime,
		ConnMaxIdleTime: defaultConnMaxIdleTime,
	}
}

// PoolOption mutates a PoolConfig. Modeled on the functional-options
// pattern used by the msft client (msft/client.go: ClientOption).
type PoolOption func(*PoolConfig)

// WithMaxOpenConns sets the maximum number of open connections per *sql.DB.
// Zero means unlimited (per database/sql semantics).
func WithMaxOpenConns(n int) PoolOption {
	return func(c *PoolConfig) { c.MaxOpenConns = n }
}

// WithMaxIdleConns sets the maximum number of idle connections per *sql.DB.
func WithMaxIdleConns(n int) PoolOption {
	return func(c *PoolConfig) { c.MaxIdleConns = n }
}

// WithConnMaxLifetime sets the maximum lifetime of a single connection
// before it is recycled.
func WithConnMaxLifetime(d time.Duration) PoolOption {
	return func(c *PoolConfig) { c.ConnMaxLifetime = d }
}

// WithConnMaxIdleTime sets the maximum amount of time a connection may sit
// idle before being closed. Should be tuned shorter than the server-side
// QUIC idle timeout (default 30s).
func WithConnMaxIdleTime(d time.Duration) PoolOption {
	return func(c *PoolConfig) { c.ConnMaxIdleTime = d }
}

// Pool holds one *sql.DB per registered profile name. Connections are
// lazy: each profile's *sql.DB is created on the first DB(name) call and
// cached for subsequent callers.
//
// Pool is safe for concurrent use.
type Pool struct {
	cfg      *PoolConfig
	profiles map[string]Profile

	mu  sync.Mutex
	dbs map[string]*sql.DB
}

// NewPool constructs a Pool from a slice of profiles plus optional
// functional options. The options apply to every *sql.DB the pool opens.
//
// Validation:
//   - profiles must be non-empty
//   - each Profile.Name must be non-empty
//   - each Profile.DSN must be non-empty
//   - profile names must be unique
func NewPool(profiles []Profile, opts ...PoolOption) (*Pool, error) {
	if len(profiles) == 0 {
		return nil, fmt.Errorf("conn: NewPool requires at least one profile")
	}

	cfg := DefaultPoolConfig()
	for _, opt := range opts {
		opt(cfg)
	}

	m := make(map[string]Profile, len(profiles))
	for i, p := range profiles {
		if p.Name == "" {
			return nil, fmt.Errorf("conn: profile[%d] has empty Name", i)
		}
		if p.DSN == "" {
			return nil, fmt.Errorf("conn: profile %q has empty DSN", p.Name)
		}
		if _, dup := m[p.Name]; dup {
			return nil, fmt.Errorf("conn: duplicate profile name %q", p.Name)
		}
		m[p.Name] = p
	}

	return &Pool{
		cfg:      cfg,
		profiles: m,
		dbs:      make(map[string]*sql.DB, len(m)),
	}, nil
}

// Lookup returns the Profile registered under name, or an error if no such
// profile exists.
func (p *Pool) Lookup(name string) (Profile, error) {
	prof, ok := p.profiles[name]
	if !ok {
		return Profile{}, fmt.Errorf("conn: unknown profile %q", name)
	}
	return prof, nil
}

// Names returns the registered profile names in lexicographic order.
func (p *Pool) Names() []string {
	out := make([]string, 0, len(p.profiles))
	for name := range p.profiles {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// DB returns the *sql.DB for the named profile, opening it lazily on the
// first call. Pool-wide PoolConfig values are applied via SetMaxOpenConns,
// SetMaxIdleConns, SetConnMaxLifetime, and SetConnMaxIdleTime.
//
// Note: sql.Open is non-blocking and does not verify connectivity.
// Use Ping to actually contact the upstream.
func (p *Pool) DB(name string) (*sql.DB, error) {
	prof, err := p.Lookup(name)
	if err != nil {
		return nil, err
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	if p.dbs == nil {
		return nil, fmt.Errorf("conn: pool is closed")
	}
	if db, ok := p.dbs[name]; ok {
		return db, nil
	}

	db, err := sql.Open(driverName, prof.DSN)
	if err != nil {
		return nil, fmt.Errorf("conn: sql.Open profile %q: %w", name, err)
	}

	db.SetMaxOpenConns(p.cfg.MaxOpenConns)
	db.SetMaxIdleConns(p.cfg.MaxIdleConns)
	db.SetConnMaxLifetime(p.cfg.ConnMaxLifetime)
	db.SetConnMaxIdleTime(p.cfg.ConnMaxIdleTime)

	p.dbs[name] = db
	return db, nil
}

// Ping verifies a live connection to the named profile, opening the
// underlying *sql.DB if necessary.
func (p *Pool) Ping(ctx context.Context, name string) error {
	db, err := p.DB(name)
	if err != nil {
		return err
	}
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("conn: ping profile %q: %w", name, err)
	}
	return nil
}

// Close closes every *sql.DB the pool has opened. Subsequent DB() calls
// return an error. Safe to call multiple times.
func (p *Pool) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.dbs == nil {
		return nil
	}

	var firstErr error
	for name, db := range p.dbs {
		if err := db.Close(); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("conn: close profile %q: %w", name, err)
		}
	}
	p.dbs = nil
	return firstErr
}
