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

// LspConfig controls the /ws/lsp WebSocket bridge to the upstream LSP
// TCP listener (see RegisterLspWS). UpstreamAddr is the host:port the
// bridge dials per connection — typically the colocated listener that
// `geode serve` exposes (Task 28). Enabled gates whether the route is
// registered at all: deployments that don't want to expose LSP over the
// browser-facing surface can set Enabled=false and skip RegisterLspWS.
//
// Defaults: UpstreamAddr="127.0.0.1:3142", Enabled=true. Both are
// applied by NewLspConfigWithDefaults, which is the canonical way to
// construct an LspConfig — `bool`'s zero value can't distinguish "unset"
// from "deliberately disabled", so use the constructor (or set Enabled
// explicitly) instead of relying on the struct literal. main.go uses
// the constructor; tests do likewise.
type LspConfig struct {
	UpstreamAddr string `json:"upstream_addr"`
	Enabled      bool   `json:"enabled"`
}

// NewLspConfigWithDefaults returns an LspConfig with the documented
// defaults applied: UpstreamAddr="127.0.0.1:3142", Enabled=true.
// Use this as the starting point for any LspConfig construction site
// instead of a bare struct literal — it gives callers a single
// definition of "default LSP wiring" and sidesteps the bool-zero-value
// problem (a `LspConfig{}` literal has Enabled=false, which would
// silently disable the bridge).
func NewLspConfigWithDefaults() LspConfig {
	return LspConfig{
		UpstreamAddr: "127.0.0.1:3142",
		Enabled:      true,
	}
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
	// LSP controls the /ws/lsp WebSocket-to-TCP bridge. See LspConfig
	// for the per-field semantics and defaults. main.go reads cfg.LSP
	// to decide whether to call RegisterLspWS.
	LSP LspConfig
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

// New constructs a GraphServer with the given Config. The UpstreamAddr
// field of LspConfig is back-filled with the documented default
// (127.0.0.1:3142) when blank — that knob is safe to "default on",
// since a wrong host:port surfaces only on the first /ws/lsp dial.
// Enabled is *not* back-filled (bool's zero value is indistinguishable
// from a deliberate disable); construction sites that want the full
// defaults should start from NewLspConfigWithDefaults.
func New(cfg Config) *GraphServer {
	if cfg.Version == "" {
		cfg.Version = "dev"
	}
	if cfg.LSP.UpstreamAddr == "" {
		cfg.LSP.UpstreamAddr = "127.0.0.1:3142"
	}
	return &GraphServer{cfg: cfg}
}

// LSPConfig returns the effective LspConfig — defaults applied — so
// main.go can decide whether to register /ws/lsp and which upstream
// to dial without poking at the unexported GraphServer.cfg.
func (s *GraphServer) LSPConfig() LspConfig { return s.cfg.LSP }

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

// RegisterLspWS registers the /ws/lsp WebSocket-to-TCP bridge route on
// mux. The bridge proxies browser WebSocket frames to the upstream
// LSP TCP listener (geode serve --lsp-port=N — see geode worktree
// Task 28); see ws_lsp.go for the wire-format details.
//
// auth is invoked before the WebSocket upgrade. A nil callback or a
// non-nil error from the callback short-circuits to 401, so the
// upstream TCP listener is never dialed for an anonymous request. The
// same callback shape (*GraphServer).AuthJWT satisfies — wire it in
// cmd/server/main.go alongside the generated /ws/query registration:
//
//	cfg := graphSrv.LSPConfig()
//	if cfg.Enabled {
//	    server.RegisterLspWS(mux, graphSrv.AuthJWT, cfg.UpstreamAddr)
//	}
//
// upstreamAddr is the host:port the bridge dials per connection. It
// flows from Config.LSP.UpstreamAddr (Task 31) so deployments can
// colocate or fan out the LSP listener independently.
func RegisterLspWS(mux *http.ServeMux, auth func(*http.Request) error, upstreamAddr string) {
	mux.Handle("/ws/lsp", newWsLspHandler(upstreamAddr, auth))
}
