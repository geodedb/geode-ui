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
	"testing"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// TestTxStore_PutTakeGetOwner exercises the put/get/take cycle and
// owner enforcement. The store never invokes any *sql.Tx method, so a
// nil-valued pointer is sufficient for identity checks.
func TestTxStore_PutTakeGetOwner(t *testing.T) {
	store := NewTxStore()
	tx := (*sql.Tx)(nil)

	id := store.put(tx, "alice")
	if got := len(id); got != 32 {
		t.Fatalf("txid len=%d want 32 (16 hex bytes)", got)
	}
	for _, r := range id {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			t.Fatalf("txid %q has non-hex char %q", id, r)
		}
	}

	got, err := store.get(id, "alice")
	if err != nil {
		t.Fatalf("get(owner=alice): %v", err)
	}
	if got != tx {
		t.Fatalf("get returned %p want %p", got, tx)
	}

	// Owner mismatch on get must error and not remove the entry.
	if _, err := store.get(id, "mallory"); err == nil {
		t.Fatalf("get(owner=mallory) returned nil; want error")
	} else if !strings.Contains(err.Error(), "owner mismatch") {
		t.Fatalf("get(mallory) err=%q want contains owner mismatch", err)
	}

	// Owner mismatch on take must error and not remove the entry.
	if _, err := store.take(id, "mallory"); err == nil {
		t.Fatalf("take(owner=mallory) returned nil; want error")
	}

	// take by the real owner removes the entry and returns the tx.
	got, err = store.take(id, "alice")
	if err != nil {
		t.Fatalf("take(owner=alice): %v", err)
	}
	if got != tx {
		t.Fatalf("take returned %p want %p", got, tx)
	}
}

// TestTxStore_TakeAfterTake confirms one-shot semantics — a second take
// on the same id must error.
func TestTxStore_TakeAfterTake(t *testing.T) {
	store := NewTxStore()
	id := store.put((*sql.Tx)(nil), "")

	if _, err := store.take(id, ""); err != nil {
		t.Fatalf("first take: %v", err)
	}
	if _, err := store.take(id, ""); err == nil {
		t.Fatalf("second take returned nil; want error")
	}
}

// TestTxStore_GetMissing confirms an unknown id surfaces an error.
func TestTxStore_GetMissing(t *testing.T) {
	store := NewTxStore()
	if _, err := store.get("00000000000000000000000000000000", ""); err == nil {
		t.Fatalf("get on unknown id returned nil; want error")
	}
}

// TestNewTxID_Uniqueness is a smoke test that random ids do not collide
// in a small batch; if they do, crypto/rand is broken or the encoding is
// truncated.
func TestNewTxID_Uniqueness(t *testing.T) {
	seen := make(map[string]struct{}, 256)
	for i := range 256 {
		id := newTxID()
		if len(id) != 32 {
			t.Fatalf("len=%d want 32", len(id))
		}
		if _, dup := seen[id]; dup {
			t.Fatalf("duplicate txid %q after %d draws", id, i)
		}
		seen[id] = struct{}{}
	}
}

// TestUserFromContext covers both the no-claim case (an empty subject
// is returned, preserving the TxStore owner check semantics for tests
// that don't go through AuthJWT) and the populated case (AuthJWT
// attaches the subject under userCtxKey and userFromContext echoes it).
func TestUserFromContext(t *testing.T) {
	if got := userFromContext(context.Background()); got != "" {
		t.Fatalf("userFromContext(empty ctx)=%q want \"\"", got)
	}
	ctx := context.WithValue(context.Background(), userCtxKey, "alice")
	if got := userFromContext(ctx); got != "alice" {
		t.Fatalf("userFromContext(ctx with sub=alice)=%q want alice", got)
	}
}

// txCapableDriver is a minimal database/sql/driver implementation that
// supports BeginTx, ExecContext, and QueryContext — the surface the
// transaction handlers need. It records commit/rollback events so tests
// can assert the handler took the expected terminal path.
type txCapableDriver struct {
	mu     sync.Mutex
	events []string // "begin", "exec:<stmt>", "query:<stmt>", "commit", "rollback"

	// queryRows is returned from the conn's QueryContext for any
	// statement; tests pass cols+rows here.
	cols []string
	rows [][]driver.Value
}

func (d *txCapableDriver) Open(_ string) (driver.Conn, error) {
	return &txCapableConn{d: d}, nil
}

func (d *txCapableDriver) record(s string) {
	d.mu.Lock()
	d.events = append(d.events, s)
	d.mu.Unlock()
}

// registerTxDriver registers d under name once per process so multiple
// tests can share the same name without sql.Register panicking on
// duplicate names.
func registerTxDriver(name string, d driver.Driver) {
	if _, loaded := registerOnce.LoadOrStore(name, struct{}{}); loaded {
		return
	}
	sql.Register(name, d)
}

type txCapableConn struct{ d *txCapableDriver }

func (c *txCapableConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unused")
}
func (c *txCapableConn) Close() error { return nil }
func (c *txCapableConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}

func (c *txCapableConn) BeginTx(_ context.Context, _ driver.TxOptions) (driver.Tx, error) {
	c.d.record("begin")
	return &txCapableTx{d: c.d}, nil
}

func (c *txCapableConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	c.d.record("exec:" + query)
	return driver.RowsAffected(0), nil
}

func (c *txCapableConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.d.record("query:" + query)
	return &txCapableRows{cols: c.d.cols, data: c.d.rows}, nil
}

type txCapableTx struct{ d *txCapableDriver }

func (t *txCapableTx) Commit() error   { t.d.record("commit"); return nil }
func (t *txCapableTx) Rollback() error { t.d.record("rollback"); return nil }

type txCapableRows struct {
	cols []string
	data [][]driver.Value
	idx  int
}

func (r *txCapableRows) Columns() []string { return r.cols }
func (r *txCapableRows) Close() error      { return nil }
func (r *txCapableRows) Next(dest []driver.Value) error {
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

// TestTxHandlers_HappyPath wires Tx -> Run -> Commit through the real
// generator-emitted method names and confirms the underlying driver saw
// begin, query, and commit in order.
func TestTxHandlers_HappyPath(t *testing.T) {
	d := &txCapableDriver{
		cols: []string{"col"},
		rows: [][]driver.Value{{"v1"}, {"v2"}},
	}
	registerTxDriver("tx_happy", d)
	db, err := sql.Open("tx_happy", "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	srv := New(Config{
		Version: "test",
		Pool:    &stubPool{db: db},
		TxStore: NewTxStore(),
	})

	rec := httptest.NewRecorder()
	beginReq := httptest.NewRequest(http.MethodPost, "/api/v1/tx", nil)
	beginResp, err := srv.Tx(rec, beginReq, &gentypes.TxBeginReq{})
	if err != nil {
		t.Fatalf("Tx: %v", err)
	}
	if beginResp == nil {
		t.Fatalf("Tx returned nil resp; body=%s", rec.Body.String())
	}
	if len(beginResp.Txid) != 32 {
		t.Fatalf("txid len=%d want 32", len(beginResp.Txid))
	}

	rec = httptest.NewRecorder()
	runReq := httptest.NewRequest(http.MethodPost, "/api/v1/tx/"+beginResp.Txid+"/run", nil)
	runResp, err := srv.PostTxidRun(rec, runReq, &gentypes.TxRunReq{
		Txid:      beginResp.Txid,
		Statement: "MATCH (n) RETURN n",
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if runResp == nil {
		t.Fatalf("Run returned nil resp; body=%s", rec.Body.String())
	}
	if got, want := runResp.RowCount, int64(2); got != want {
		t.Fatalf("RowCount=%d want %d", got, want)
	}
	// Sanity: rows are JSON-encoded arrays per the QueryResp contract.
	for _, raw := range runResp.Rows {
		var row []any
		if err := json.Unmarshal(raw, &row); err != nil {
			t.Fatalf("row unmarshal: %v", err)
		}
	}

	rec = httptest.NewRecorder()
	commitReq := httptest.NewRequest(http.MethodPost, "/api/v1/tx/"+beginResp.Txid+"/commit", nil)
	if _, err := srv.Commit(rec, commitReq, &gentypes.TxIDParam{Txid: beginResp.Txid}); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	d.mu.Lock()
	events := append([]string(nil), d.events...)
	d.mu.Unlock()
	wantSeen := []string{"begin", "query:MATCH (n) RETURN n", "commit"}
	if len(events) != len(wantSeen) {
		t.Fatalf("driver events=%v want %v", events, wantSeen)
	}
	for i, want := range wantSeen {
		if events[i] != want {
			t.Fatalf("event[%d]=%q want %q (full=%v)", i, events[i], want, events)
		}
	}
}

// TestTxHandlers_RollbackPath exercises Tx -> Rollback so the rollback
// terminal path is covered.
func TestTxHandlers_RollbackPath(t *testing.T) {
	d := &txCapableDriver{cols: []string{"col"}}
	registerTxDriver("tx_rollback", d)
	db, err := sql.Open("tx_rollback", "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	srv := New(Config{Version: "test", Pool: &stubPool{db: db}, TxStore: NewTxStore()})

	rec := httptest.NewRecorder()
	beginResp, err := srv.Tx(rec, httptest.NewRequest(http.MethodPost, "/api/v1/tx", nil), &gentypes.TxBeginReq{})
	if err != nil || beginResp == nil {
		t.Fatalf("Tx err=%v resp=%v body=%s", err, beginResp, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	if _, err := srv.Rollback(rec, httptest.NewRequest(http.MethodPost, "/api/v1/tx/x/rollback", nil), &gentypes.TxIDParam{Txid: beginResp.Txid}); err != nil {
		t.Fatalf("Rollback: %v", err)
	}

	// A second rollback must surface tx_not_found because take removed
	// the entry on the first call.
	rec = httptest.NewRecorder()
	if _, err := srv.Rollback(rec, httptest.NewRequest(http.MethodPost, "/api/v1/tx/x/rollback", nil), &gentypes.TxIDParam{Txid: beginResp.Txid}); err != nil {
		t.Fatalf("second Rollback returned err=%v want nil-with-body", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("second Rollback status=%d want 404", rec.Code)
	}

	// The first rollback should have hit the driver.
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.events) < 2 || d.events[0] != "begin" || d.events[1] != "rollback" {
		t.Fatalf("events=%v want [begin rollback ...]", d.events)
	}
}

// TestTxHandlers_BeginSanitizesGraphName confirms the Tx handler routes
// req.Graph through sanitizeGraphName before inlining it into the
// "USE GRAPH ..." statement issued on the new transaction. A regression
// that drops the sanitizer would let the raw graph name reach the
// driver and open a query-injection vector — this test pins the wiring
// by feeding a name with spaces, semicolons, and SQL-comment syntax and
// asserting the exact stripped form lands on the driver.
func TestTxHandlers_BeginSanitizesGraphName(t *testing.T) {
	d := &txCapableDriver{}
	registerTxDriver("tx_sanitize_graph", d)
	db, err := sql.Open("tx_sanitize_graph", "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	srv := New(Config{Version: "test", Pool: &stubPool{db: db}, TxStore: NewTxStore()})

	rec := httptest.NewRecorder()
	beginReq := httptest.NewRequest(http.MethodPost, "/api/v1/tx", nil)
	beginResp, err := srv.Tx(rec, beginReq, &gentypes.TxBeginReq{Graph: "bad name; DROP TABLE users--"})
	if err != nil {
		t.Fatalf("Tx: %v", err)
	}
	if beginResp == nil {
		t.Fatalf("Tx returned nil resp; status=%d body=%s", rec.Code, rec.Body.String())
	}
	if len(beginResp.Txid) != 32 {
		t.Fatalf("txid len=%d want 32", len(beginResp.Txid))
	}
	if rec.Code != http.StatusOK && rec.Code != 0 {
		// httptest.ResponseRecorder defaults Code to 200 until WriteHeader
		// is called; either 200 or the unwritten zero value is fine.
		t.Fatalf("status=%d want 200", rec.Code)
	}

	d.mu.Lock()
	events := append([]string(nil), d.events...)
	d.mu.Unlock()

	// sanitizeGraphName keeps [a-zA-Z0-9_-], so the input
	// "bad name; DROP TABLE users--" collapses to "badnameDROPTABLEusers--".
	wantQuery := "exec:USE GRAPH badnameDROPTABLEusers--"
	wantSeen := []string{"begin", wantQuery}
	if len(events) != len(wantSeen) {
		t.Fatalf("driver events=%v want %v", events, wantSeen)
	}
	for i, want := range wantSeen {
		if events[i] != want {
			t.Fatalf("event[%d]=%q want %q (full=%v)", i, events[i], want, events)
		}
	}
}
