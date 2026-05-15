package server

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"sync"
	"testing"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// captureDriver records every QueryContext statement so the test can
// assert MCP delegated to the same handleQuery codepath. Returns an
// empty result set so handleQuery's scan loop terminates cleanly.
type captureDriver struct {
	mu    sync.Mutex
	stmts []string
}

func (d *captureDriver) Open(_ string) (driver.Conn, error) { return &captureConn{d: d}, nil }

type captureConn struct{ d *captureDriver }

func (c *captureConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("unused") }
func (c *captureConn) Close() error                        { return nil }
func (c *captureConn) Begin() (driver.Tx, error)           { return nil, errors.New("unused") }
func (c *captureConn) QueryContext(_ context.Context, q string, _ []driver.NamedValue) (driver.Rows, error) {
	c.d.mu.Lock()
	c.d.stmts = append(c.d.stmts, q)
	c.d.mu.Unlock()
	return &captureRows{}, nil
}

type captureRows struct{}

func (r *captureRows) Columns() []string           { return []string{"x"} }
func (r *captureRows) Close() error                { return nil }
func (r *captureRows) Next(_ []driver.Value) error { return io.EOF }

// sharedCapture is the package-singleton capture driver. We register it
// once with database/sql (which only allows a single Register per
// driver name) and reset its captured statements at the start of each
// test that uses it. captureDriver is goroutine-safe so concurrent
// access is fine; the reset+test pattern is sequential by virtue of
// Go's per-package test ordering.
var sharedCapture = &captureDriver{}
var sharedCaptureRegister sync.Once

func resetSharedCapture(t *testing.T) *sql.DB {
	t.Helper()
	sharedCaptureRegister.Do(func() { sql.Register("mcp_capture", sharedCapture) })
	sharedCapture.mu.Lock()
	sharedCapture.stmts = nil
	sharedCapture.mu.Unlock()
	db, err := sql.Open("mcp_capture", "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// TestMCPServer_QueryDelegatesToHandleQuery confirms the MCP boundary is
// a true pass-through: a QueryReq submitted via the MCP entry point
// reaches the same handleQuery codepath used by POST /api/v1/query and
// produces the same statement on the wire.
func TestMCPServer_QueryDelegatesToHandleQuery(t *testing.T) {
	db := resetSharedCapture(t)
	srv := New(Config{Version: "test", Pool: &stubPool{db: db}})
	mcp := NewMCPServer(srv)

	if _, err := mcp.Query(context.Background(), &gentypes.QueryReq{Statement: "RETURN 1"}); err != nil {
		t.Fatalf("MCP Query: %v", err)
	}
	sharedCapture.mu.Lock()
	got := append([]string(nil), sharedCapture.stmts...)
	sharedCapture.mu.Unlock()
	if len(got) != 1 || got[0] != "RETURN 1" {
		t.Fatalf("captured statements = %v, want [RETURN 1]", got)
	}
}

// TestMCPServer_QueryUsesGraphParam verifies USE GRAPH is prepended in
// the same way as the HTTP path.
func TestMCPServer_QueryUsesGraphParam(t *testing.T) {
	db := resetSharedCapture(t)
	srv := New(Config{Version: "test", Pool: &stubPool{db: db}})
	mcp := NewMCPServer(srv)

	if _, err := mcp.Query(context.Background(), &gentypes.QueryReq{Statement: "MATCH (n) RETURN n", Graph: "social"}); err != nil {
		t.Fatalf("MCP Query: %v", err)
	}
	sharedCapture.mu.Lock()
	got := append([]string(nil), sharedCapture.stmts...)
	sharedCapture.mu.Unlock()
	if len(got) != 1 {
		t.Fatalf("got %d statements, want 1: %v", len(got), got)
	}
	want := "USE GRAPH social; MATCH (n) RETURN n"
	if got[0] != want {
		t.Errorf("statement = %q, want %q", got[0], want)
	}
}

// TestMCPServer_QueryReturnsHandleQueryError confirms upstream errors
// surface unmodified through the MCP boundary.
func TestMCPServer_QueryReturnsHandleQueryError(t *testing.T) {
	srv := New(Config{Version: "test", Pool: &errPool{err: errors.New("upstream down")}})
	mcp := NewMCPServer(srv)
	_, err := mcp.Query(context.Background(), &gentypes.QueryReq{Statement: "RETURN 1"})
	if err == nil {
		t.Fatal("expected error from underlying pool")
	}
	ep := asEndpointError(err)
	if ep == nil {
		t.Fatalf("expected endpointError, got %T %v", err, err)
	}
	if ep.code != "profile_unreachable" {
		t.Errorf("code = %q, want profile_unreachable", ep.code)
	}
}
