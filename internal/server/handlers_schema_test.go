package server

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json/v2"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// fakeDriver is a minimal database/sql/driver implementation that
// returns canned rows for catalog statements. It is not goroutine-safe
// across drivers — each test that needs distinct results registers under
// a unique name.
type fakeDriver struct {
	rows map[string]fakeResult // statement substring → result
	// queries counts every QueryContext invocation across all conns
	// opened from this driver — used by the schema-cache tests to assert
	// that cache hits avoid the upstream round-trip.
	queries atomic.Int64
}

type fakeResult struct {
	cols []string
	rows [][]driver.Value
	err  error // returned from QueryContext if non-nil
}

type fakeConn struct{ d *fakeDriver }

func (d *fakeDriver) Open(_ string) (driver.Conn, error) { return &fakeConn{d: d}, nil }

func (c *fakeConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("not used") }
func (c *fakeConn) Close() error                        { return nil }
func (c *fakeConn) Begin() (driver.Tx, error)           { return nil, errors.New("not used") }

// QueryerContext is the optional fast path the database/sql package
// prefers when available. We implement it directly to avoid stmt.
func (c *fakeConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.d.queries.Add(1)
	for stmt, res := range c.d.rows {
		if strings.Contains(query, stmt) {
			if res.err != nil {
				return nil, res.err
			}
			return &fakeRows{cols: res.cols, data: res.rows}, nil
		}
	}
	return nil, errors.New("fakeDriver: no canned response for query: " + query)
}

type fakeRows struct {
	cols []string
	data [][]driver.Value
	idx  int
}

func (r *fakeRows) Columns() []string { return r.cols }
func (r *fakeRows) Close() error      { return nil }
func (r *fakeRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.data) {
		return io.EOF
	}
	row := r.data[r.idx]
	r.idx++
	for i := range dest {
		if i < len(row) {
			dest[i] = row[i]
		}
	}
	return nil
}

var (
	registerOnce sync.Map // driverName -> struct{}
)

// registerFakeDriver registers d under name with database/sql at most once
// per process. database/sql.Register panics on duplicate names.
func registerFakeDriver(name string, d *fakeDriver) {
	if _, loaded := registerOnce.LoadOrStore(name, struct{}{}); loaded {
		return
	}
	sql.Register(name, d)
}

// stubPool implements server.Pool returning a *sql.DB tied to a fakeDriver.
type stubPool struct{ db *sql.DB }

func (p *stubPool) DB(string) (*sql.DB, error) { return p.db, nil }

// errPool returns the configured error from DB.
type errPool struct{ err error }

func (p *errPool) DB(string) (*sql.DB, error) { return nil, p.err }

// newStubServer wires a GraphServer backed by the given canned driver.
func newStubServer(t *testing.T, name string, d *fakeDriver) *GraphServer {
	t.Helper()
	registerFakeDriver(name, d)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return New(Config{Version: "test", Pool: &stubPool{db: db}})
}

func TestGraphs_StringList(t *testing.T) {
	d := &fakeDriver{rows: map[string]fakeResult{
		"SHOW GRAPHS": {
			cols: []string{"name"},
			rows: [][]driver.Value{{"default"}, {"products"}},
		},
	}}
	s := newStubServer(t, "fake_graphs", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/graphs", nil)
	resp, err := s.Graphs(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("Graphs: %v", err)
	}
	if got, want := resp.Graphs, []string{"default", "products"}; !equalStrings(got, want) {
		t.Fatalf("Graphs=%v want %v", got, want)
	}
}

// TestGraphs_HidesSystemGraphs is the regression for the user-reported
// "non-security graph nodes and edges should be in their own graph"
// complaint. SHOW GRAPHS returns the upstream Geode security graph
// `__geode_security` alongside user-defined graphs; the SchemaExplorer
// auto-selects the first entry and the operator ends up staring at
// system Users/Roles instead of their data. The Graphs handler must
// strip any graph whose name starts with `__` from the public API
// response — those are implementation details of the security graph
// layer and have dedicated admin endpoints (/api/v1/users etc.).
func TestGraphs_HidesSystemGraphs(t *testing.T) {
	d := &fakeDriver{rows: map[string]fakeResult{
		"SHOW GRAPHS": {
			cols: []string{"name"},
			rows: [][]driver.Value{
				{"__geode_security"},
				{"movies"},
				{"default"},
				{"__internal_audit"},
			},
		},
	}}
	s := newStubServer(t, "fake_graphs_filtered", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/graphs", nil)
	resp, err := s.Graphs(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("Graphs: %v", err)
	}
	if got, want := resp.Graphs, []string{"movies", "default"}; !equalStrings(got, want) {
		t.Fatalf("Graphs=%v want %v (system graphs must be filtered)", got, want)
	}
}

func TestLabels_StringList(t *testing.T) {
	// Handler runs `MATCH (n) RETURN DISTINCT labels(n) AS l` and feeds
	// each row through asStringList, which accepts JSON-encoded LIST<STRING>
	// cells (the shape the geode driver delivers in v0.5.11).
	d := &fakeDriver{rows: map[string]fakeResult{
		"RETURN DISTINCT labels(n)": {
			cols: []string{"l"},
			rows: [][]driver.Value{{`["User"]`}, {`["Role"]`}},
		},
	}}
	s := newStubServer(t, "fake_labels", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/graphs/default/labels", nil)
	resp, err := s.Labels(rec, req, &gentypes.GraphParam{Graph: "default"})
	if err != nil {
		t.Fatalf("Labels: %v", err)
	}
	// Labels() sorts its output so callers get a stable ordering.
	if got, want := resp.Labels, []string{"Role", "User"}; !equalStrings(got, want) {
		t.Fatalf("Labels=%v want %v", got, want)
	}
}

func TestEdgeTypes_StringList(t *testing.T) {
	// Handler runs `MATCH ()-[r]->() RETURN DISTINCT type(r) AS t ORDER BY t`
	// — the graph-scoped replacement for CALL db.relationshipTypes().
	d := &fakeDriver{rows: map[string]fakeResult{
		"RETURN DISTINCT type(r)": {
			cols: []string{"t"},
			rows: [][]driver.Value{{"HAS_ROLE"}, {"OWNS"}},
		},
	}}
	s := newStubServer(t, "fake_edges", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/graphs/default/edge-types", nil)
	resp, err := s.EdgeTypes(rec, req, &gentypes.GraphParam{Graph: "default"})
	if err != nil {
		t.Fatalf("EdgeTypes: %v", err)
	}
	if got, want := resp.Types, []string{"HAS_ROLE", "OWNS"}; !equalStrings(got, want) {
		t.Fatalf("Types=%v want %v", got, want)
	}
}

func TestIndexes_RowMaps(t *testing.T) {
	d := &fakeDriver{rows: map[string]fakeResult{
		"SHOW INDEXES": {
			cols: []string{"name", "type", "table", "columns"},
			rows: [][]driver.Value{{"idx_user_email", "BTREE", "User", "email"}},
		},
	}}
	s := newStubServer(t, "fake_indexes", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/graphs/default/indexes", nil)
	resp, err := s.Indexes(rec, req, &gentypes.GraphParam{Graph: "default"})
	if err != nil {
		t.Fatalf("Indexes: %v", err)
	}
	if len(resp.Indexes) != 1 {
		t.Fatalf("len=%d want 1", len(resp.Indexes))
	}
	var got map[string]any
	if err := json.Unmarshal(resp.Indexes[0], &got); err != nil {
		t.Fatalf("unmarshal row: %v", err)
	}
	if got["name"] != "idx_user_email" || got["type"] != "BTREE" {
		t.Fatalf("row=%v missing expected fields", got)
	}
}

func TestConstraints_RowMaps(t *testing.T) {
	d := &fakeDriver{rows: map[string]fakeResult{
		"SHOW CONSTRAINTS": {
			cols: []string{"name", "type", "table", "columns"},
			rows: [][]driver.Value{{"uniq_user_email", "UNIQUE", "User", "email"}},
		},
	}}
	s := newStubServer(t, "fake_constraints", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/graphs/default/constraints", nil)
	resp, err := s.Constraints(rec, req, &gentypes.GraphParam{Graph: "default"})
	if err != nil {
		t.Fatalf("Constraints: %v", err)
	}
	if len(resp.Constraints) != 1 {
		t.Fatalf("len=%d want 1", len(resp.Constraints))
	}
}

func TestSchemaResponseErr_PoolFailure(t *testing.T) {
	s := New(Config{Version: "test", Pool: &errPool{err: errors.New("dial timeout")}})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/graphs", nil)
	resp, err := s.Graphs(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("Graphs returned error %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status=%d want 502", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if body["error"] != "profile_unreachable" {
		t.Fatalf("error=%q want profile_unreachable", body["error"])
	}
}

func TestSchemaResponseErr_QueryFailure(t *testing.T) {
	d := &fakeDriver{rows: map[string]fakeResult{
		"SHOW GRAPHS": {err: errors.New("syntax error near GRAPHS")},
	}}
	s := newStubServer(t, "fake_query_err", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/graphs", nil)
	resp, err := s.Graphs(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("Graphs returned error %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d want 422", rec.Code)
	}
}

func TestPrefixUseGraph(t *testing.T) {
	cases := []struct {
		graph, stmt, want string
	}{
		{"", "SHOW GRAPHS", "SHOW GRAPHS"},
		{"products", "CALL db.labels()", "USE GRAPH products; CALL db.labels()"},
		{"bad name; DROP TABLE", "X", "USE GRAPH badnameDROPTABLE; X"},
	}
	for _, tc := range cases {
		got := prefixUseGraph(tc.graph, tc.stmt)
		if got != tc.want {
			t.Errorf("prefixUseGraph(%q,%q)=%q want %q", tc.graph, tc.stmt, got, tc.want)
		}
	}
}

func TestAsString(t *testing.T) {
	cases := []struct{ in, want any }{
		{nil, ""},
		{"hello", "hello"},
		{[]byte("bytes"), "bytes"},
		{int64(42), "42"},
		{true, "true"},
	}
	for _, tc := range cases {
		if got := asString(tc.in); got != tc.want {
			t.Errorf("asString(%v)=%q want %q", tc.in, got, tc.want)
		}
	}
}

// equalStrings is a tiny helper to keep test diffs readable.
func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
