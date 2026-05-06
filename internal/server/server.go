package server

import (
	"net/http"

	genapi "geodedb.com/geode-ui/gen/api"
	gentypes "geodedb.com/geode-ui/gen/types"
)

// Config carries dependencies for GraphServer.
// Fields are added incrementally as tasks need them.
type Config struct {
	Version string
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
