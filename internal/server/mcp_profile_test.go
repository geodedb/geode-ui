package server

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"geodedb.com/geode-ui/internal/jwt"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// F-AUTH-1 (#132): the MCP `query` tool must run against the connection
// profile named in the caller's JWT `profile` claim, not the hard-coded
// "default" profile. These tests drive MCPServer.Query through the same
// MCPAuthVerifier hook that cmd/server/main.go wires onto /mcp.

// profileTagDriver counts QueryContext calls. Distinct instances are
// registered under distinct names so a test can tell which profile a
// query landed on.
type profileTagDriver struct {
	queries atomic.Int64
}

func (d *profileTagDriver) Open(_ string) (driver.Conn, error) { return &profileTagConn{d: d}, nil }

type profileTagConn struct{ d *profileTagDriver }

func (c *profileTagConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("unused") }
func (c *profileTagConn) Close() error                        { return nil }
func (c *profileTagConn) Begin() (driver.Tx, error)           { return nil, errors.New("unused") }
func (c *profileTagConn) QueryContext(_ context.Context, _ string, _ []driver.NamedValue) (driver.Rows, error) {
	c.d.queries.Add(1)
	return &profileTagRows{}, nil
}

type profileTagRows struct{}

func (r *profileTagRows) Columns() []string           { return []string{"x"} }
func (r *profileTagRows) Close() error                { return nil }
func (r *profileTagRows) Next(_ []driver.Value) error { return io.EOF }

// profileRoutingPool routes Pool.DB(profile) to a per-profile *sql.DB so
// a test can observe which profile a query executed against.
type profileRoutingPool struct {
	dbs     map[string]*sql.DB
	drivers map[string]*profileTagDriver
}

var profileRoutingRegister sync.Once
var profileRoutingDrivers = map[string]*profileTagDriver{} // driver name -> driver

func newProfileRoutingPool(t *testing.T, profiles ...string) *profileRoutingPool {
	t.Helper()
	nameFor := map[string]string{
		"alpha":   "prof_route_alpha",
		"bravo":   "prof_route_bravo",
		"default": "prof_route_default",
	}
	// database/sql.Register panics on duplicate names, so register the
	// fixed set of named drivers once per process and reset their
	// counters per test.
	profileRoutingRegister.Do(func() {
		for _, name := range nameFor {
			d := &profileTagDriver{}
			profileRoutingDrivers[name] = d
			sql.Register(name, d)
		}
	})
	for _, d := range profileRoutingDrivers {
		d.queries.Store(0)
	}
	p := &profileRoutingPool{dbs: map[string]*sql.DB{}, drivers: map[string]*profileTagDriver{}}
	for _, prof := range profiles {
		driverName, ok := nameFor[prof]
		if !ok {
			t.Fatalf("newProfileRoutingPool: unsupported profile %q", prof)
		}
		db, err := sql.Open(driverName, "")
		if err != nil {
			t.Fatalf("sql.Open(%s): %v", driverName, err)
		}
		t.Cleanup(func() { _ = db.Close() })
		p.dbs[prof] = db
		p.drivers[prof] = profileRoutingDrivers[driverName]
	}
	return p
}

func (p *profileRoutingPool) DB(profile string) (*sql.DB, error) {
	if db, ok := p.dbs[profile]; ok {
		return db, nil
	}
	return nil, errors.New("profileRoutingPool: no DB for profile " + profile)
}

func mintProfileJWT(t *testing.T, iss *jwt.Issuer, sub, profile string, roles []string) string {
	t.Helper()
	tok, _, err := iss.Issue(sub, profile, roles, "")
	if err != nil {
		t.Fatalf("Issue(%s,%s): %v", sub, profile, err)
	}
	return tok
}

// runMCPQueryWithToken simulates the /mcp HTTP path: it runs
// MCPAuthVerifier (which validates the token and returns the
// JWT-enriched request context), then invokes the MCP query tool with
// that context — exactly what mcpx.HandleHTTP does, minus the JSON-RPC
// framing.
func runMCPQueryWithToken(t *testing.T, mcp *MCPServer, srv *GraphServer, token string, req *gentypes.QueryReq) (*gentypes.QueryResp, error) {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	ctx, err := srv.MCPAuthVerifier(r)
	if err != nil {
		return nil, err
	}
	return mcp.Query(ctx, req)
}

func TestMCPQuery_AppliesProfileClaim(t *testing.T) {
	iss := newTestIssuer(t)
	pool := newProfileRoutingPool(t, "alpha", "default")
	srv := New(Config{Version: "test", JWT: iss, Pool: pool})
	mcp := NewMCPServer(srv)

	tok := mintProfileJWT(t, iss, "alice", "alpha", []string{"reader"})
	if _, err := runMCPQueryWithToken(t, mcp, srv, tok, &gentypes.QueryReq{Statement: "RETURN 1"}); err != nil {
		t.Fatalf("MCP Query: %v", err)
	}
	if got := pool.drivers["alpha"].queries.Load(); got != 1 {
		t.Fatalf("profile alpha queries=%d, want 1 (MCP query did not honour JWT profile claim)", got)
	}
	if got := pool.drivers["default"].queries.Load(); got != 0 {
		t.Fatalf("profile default queries=%d, want 0 (MCP query leaked to the default profile)", got)
	}
}

func TestMCPQuery_CrossProfileIsolation(t *testing.T) {
	iss := newTestIssuer(t)
	pool := newProfileRoutingPool(t, "alpha", "bravo")
	srv := New(Config{Version: "test", JWT: iss, Pool: pool})
	mcp := NewMCPServer(srv)

	// A profile-bravo JWT must only ever reach the bravo connection —
	// it cannot read profile-alpha data via MCP.
	tokBravo := mintProfileJWT(t, iss, "bob", "bravo", []string{"reader"})
	if _, err := runMCPQueryWithToken(t, mcp, srv, tokBravo, &gentypes.QueryReq{Statement: "MATCH (n) RETURN n"}); err != nil {
		t.Fatalf("MCP Query (bravo): %v", err)
	}
	if got := pool.drivers["bravo"].queries.Load(); got != 1 {
		t.Fatalf("profile bravo queries=%d, want 1", got)
	}
	if got := pool.drivers["alpha"].queries.Load(); got != 0 {
		t.Fatalf("profile alpha queries=%d, want 0 — cross-profile read via MCP!", got)
	}

	// And an alpha JWT only reaches alpha.
	tokAlpha := mintProfileJWT(t, iss, "alice", "alpha", []string{"reader"})
	if _, err := runMCPQueryWithToken(t, mcp, srv, tokAlpha, &gentypes.QueryReq{Statement: "MATCH (n) RETURN n"}); err != nil {
		t.Fatalf("MCP Query (alpha): %v", err)
	}
	if got := pool.drivers["alpha"].queries.Load(); got != 1 {
		t.Fatalf("profile alpha queries=%d, want 1", got)
	}
	if got := pool.drivers["bravo"].queries.Load(); got != 1 {
		t.Fatalf("profile bravo queries=%d, want 1 (alpha JWT must not touch bravo)", got)
	}
}

func TestMCPQuery_AuditAttributedToJWTProfile(t *testing.T) {
	iss := newTestIssuer(t)
	pool := newProfileRoutingPool(t, "alpha")
	srv := New(Config{Version: "test", JWT: iss, Pool: pool})
	mcp := NewMCPServer(srv)

	since := time.Now().UTC()
	tok := mintProfileJWT(t, iss, "alice", "alpha", []string{"reader"})
	if _, err := runMCPQueryWithToken(t, mcp, srv, tok, &gentypes.QueryReq{Statement: "RETURN 1"}); err != nil {
		t.Fatalf("MCP Query: %v", err)
	}
	var found bool
	for _, e := range defaultAuditRing.snapshot(since) {
		if e.Event != auditEventQueryExecuted {
			continue
		}
		found = true
		if got := e.Fields["profile"]; got != "alpha" {
			t.Fatalf("query_executed audit profile=%v, want alpha", got)
		}
		if got := e.Fields["user"]; got != "alice" {
			t.Fatalf("query_executed audit user=%v, want alice", got)
		}
	}
	if !found {
		t.Fatal("no query_executed audit event recorded for the MCP query")
	}
}

// TestMCPQuery_NoTokenFallsBackToDefault documents the unauthenticated /
// stdio path: with a bare context (no JWT-enriched profile claim) Query
// runs against "default", matching the pre-mitigation behaviour. (The
// /mcp HTTP route still rejects unauthenticated requests at the verifier;
// this only covers a direct Query call with a context.Background().)
func TestMCPQuery_NoTokenFallsBackToDefault(t *testing.T) {
	pool := newProfileRoutingPool(t, "default")
	srv := New(Config{Version: "test", Pool: pool})
	mcp := NewMCPServer(srv)
	if _, err := mcp.Query(context.Background(), &gentypes.QueryReq{Statement: "RETURN 1"}); err != nil {
		t.Fatalf("MCP Query: %v", err)
	}
	if got := pool.drivers["default"].queries.Load(); got != 1 {
		t.Fatalf("profile default queries=%d, want 1", got)
	}
}
