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
}

// GraphServer implements gen/api.ServerInterface.
type GraphServer struct {
	genapi.UnimplementedServer
	cfg Config
}

// New constructs a GraphServer with the given Config.
func New(cfg Config) *GraphServer {
	if cfg.Version == "" {
		cfg.Version = "dev"
	}
	return &GraphServer{cfg: cfg}
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
//	server.RegisterLspWS(mux, graphSrv.AuthJWT, "127.0.0.1:3142")
//
// upstreamAddr is currently a hardcoded host:port; Task 31 plumbs it
// through Config so deployments can colocate or fan out the LSP
// listener independently.
func RegisterLspWS(mux *http.ServeMux, auth func(*http.Request) error, upstreamAddr string) {
	mux.Handle("/ws/lsp", newWsLspHandler(upstreamAddr, auth))
}
