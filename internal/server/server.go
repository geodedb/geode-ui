package server

import (
	"database/sql"
	"net/http"

	genapi "geodedb.com/geode-ui/gen/api"
	gentypes "geodedb.com/geode-ui/gen/types"
	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/jwt"
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
}

// GraphServer implements gen/api.ServerInterface.
type GraphServer struct {
	genapi.UnimplementedServer
	cfg Config
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
