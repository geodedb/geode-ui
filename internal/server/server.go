package server

import (
	"database/sql"
	"net/http"

	genapi "geodedb.com/geode-ui/gen/api"
	gentypes "geodedb.com/geode-ui/gen/types"
)

// Pool is the subset of *conn.Pool the server uses; an interface for testing.
type Pool interface {
	DB(name string) (*sql.DB, error)
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
