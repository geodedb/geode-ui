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
	// AdminUsernames is the set of upstream usernames to grant the
	// "admin" role on a successful login. Geode v0.5.11's wire dialect
	// does not yet expose a queryable role-enumeration form, so without
	// this list the bootstrap admin's JWT carries no roles and every
	// genapi-emitted role gate (required_roles=["admin"] on user/role/
	// policy/grant/backup/migration/audit endpoints) returns 403.
	// Populate from the -admin-users CLI flag in main.go.
	AdminUsernames map[string]bool
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
