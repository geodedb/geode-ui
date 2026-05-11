package server

import (
	"context"
	"database/sql"
	"net/http"
	"sync"
	"sync/atomic"

	"golang.org/x/sync/singleflight"

	genapi "geodedb.com/geode-ui/gen/api"
	gentypes "geodedb.com/geode-ui/gen/types"
	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/jwt"
	"geodedb.com/geode-ui/internal/profilestore"
)

// Pool is the subset of *conn.Pool the server uses; an interface for testing.
type Pool interface {
	DB(name string) (*sql.DB, error)
}

// ProfileLookup resolves a profile name to a conn.Profile and enumerates
// the registered profile names. *conn.Pool satisfies this interface —
// Login uses Lookup to locate the upstream DSN for an authenticate-then-
// issue-token round trip; Profiles uses Names to enumerate the registered
// profiles for the connection-picker UI without leaking DSNs.
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

// Config carries dependencies for GraphServer.
// Fields are added incrementally as tasks need them.
type Config struct {
	Version string
	Pool    Pool
	// TxStore holds *sql.Tx handles keyed by opaque txid for the explicit
	// transaction endpoints (POST /api/v1/tx[/{txid}/{run,commit,rollback}]).
	// Inject NewTxStore() from main; tests can pass nil and the handlers
	// will return a 500 if invoked, matching the Pool=nil contract.
	TxStore *TxStore
	// JWT issues and verifies bearer tokens. AuthJWT panics-free returns
	// a 401 if this is nil, so unit tests that don't exercise the auth
	// path can leave it unset.
	JWT *jwt.Issuer
	// Profiles resolves a profile name to a conn.Profile.DSN — used by
	// Login to authenticate against the upstream Geode by opening a
	// short-lived *sql.DB with the user's submitted credentials.
	Profiles ProfileLookup
	// AdminUsernames is the set of upstream usernames to grant the
	// "admin" role on a successful login. Geode v0.5.11's wire dialect
	// does not yet expose a queryable role-enumeration form, so without
	// this list the bootstrap admin's JWT carries no roles and every
	// genapi-emitted role gate (required_roles=["admin"] on user/role/
	// policy/grant/backup/migration/audit endpoints) returns 403.
	// Populate from the -admin-users CLI flag in main.go.
	AdminUsernames map[string]bool
	// UploadDir is the directory where multipart uploads (backup files
	// for restore, migration content) are persisted. The hand-rolled
	// upload handlers (handlers_uploads.go) write into <UploadDir>/backups
	// and <UploadDir>/migrations. Empty disables the upload endpoints
	// (they return 503).
	UploadDir string
	// SecureCookies controls whether the auth + CSRF cookies set by
	// Login (SEC-F7 / #62) include the `Secure` attribute. Production
	// deployments MUST set this to true; only local-dev setups serving
	// the SPA over plain HTTP should leave it false. main.go exposes
	// this via the `-secure-cookies` CLI flag, defaulting true. With
	// SecureCookies=true, browsers refuse to attach the cookie to a
	// non-TLS request, so accidentally launching against `http://` in
	// production fails closed rather than silently leaking the JWT.
	SecureCookies bool
	// Store persists profile records and is the source of truth for
	// scope=system + scope=personal profiles. Nil disables the CRUD
	// endpoints (they 503). Tests that don't exercise CRUD may leave it
	// nil; the legacy boot-time profile set still flows through Pool.
	Store profilestore.Store

	// PoolReloader is invoked after a successful Store mutation so the
	// in-memory connection pool tracks the persisted set. Typically the
	// same *conn.Pool that backs Pool. Nil disables hot-reload.
	PoolReloader PoolReloader
	// PasswordPolicy controls server-side password validation applied
	// to PostUsers / PatchUsername / Password handlers (GAP-N4 / #72).
	// The zero value enforces the length (>=12), weak-pattern, and
	// username-collision rules; HIBPCheck remains off to keep
	// password-set handlers hermetic. main.go wires HIBPCheck via the
	// `-password-hibp-check` CLI flag.
	PasswordPolicy PasswordPolicy
	// testAuthenticate is an optional override for authenticateUpstream
	// used by handler tests that don't want to spin up the database/sql
	// driver. When non-nil, Login calls this in place of
	// authenticateUpstream. nil in production. Lower-case so the field
	// stays package-private; tests in the same package can set it
	// directly on a Config literal.
	testAuthenticate func(ctx context.Context, profile, username, password string) (bool, []string, error)
}

// GraphServer implements gen/api.ServerInterface.
//
// Concurrency state used by maybeReload (PSR-F1 / #94):
//
//   - reloadGroup coalesces concurrent reload triggers behind a single
//     in-flight Reload. A burst of CRUD writes that all need the
//     in-memory pool refreshed collapses to one underlying List+Reload
//     instead of N back-to-back ones.
//
//   - reloadVersion is bumped on every maybeReload trigger. The async
//     worker captures the version at the moment it acquires the
//     singleflight slot; if a newer trigger lands while it is mid-flight,
//     the post-success follow-up re-runs to absorb that newer write set.
//
//   - reloadInflight is incremented whenever a goroutine is spawned to
//     drive an async reload and decremented when it finishes. Tests use
//     awaitReloadIdle to drain background work before sampling the audit
//     ring.
type GraphServer struct {
	genapi.UnimplementedServer
	cfg            Config
	reloadGroup    singleflight.Group
	reloadVersion  atomic.Int64
	reloadInflight sync.WaitGroup

	// schemaCacheInst caches schema-discovery results (labels / edge
	// types) with a TTL + singleflight (PERF-2026-05-11-01 / F1 / #128).
	// Lazily initialised via schemaCacheRef so a struct-literal
	// GraphServer (tests) still works without an explicit constructor.
	schemaCacheOnce sync.Once
	schemaCacheInst *schemaCache
}

// New constructs a GraphServer with the given Config.
func New(cfg Config) *GraphServer {
	if cfg.Version == "" {
		cfg.Version = "dev"
	}
	return &GraphServer{cfg: cfg}
}

// awaitReloadIdle blocks until every async maybeReload spawned by this
// server has completed. Test-only — production code never needs to
// observe reload completion (the whole point of F1 is decoupling the
// HTTP response from reload latency). Exposed lower-camel-case at
// package scope so same-package tests can call it without leaking it
// into the public API.
func (s *GraphServer) awaitReloadIdle() {
	s.reloadInflight.Wait()
}

// Healthz returns liveness info. Open route, no auth.
func (s *GraphServer) Healthz(_ http.ResponseWriter, _ *http.Request, _ *gentypes.Empty) (*gentypes.HealthResp, error) {
	return &gentypes.HealthResp{Status: "ok", Version: s.cfg.Version}, nil
}
