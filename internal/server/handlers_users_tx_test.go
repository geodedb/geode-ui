package server

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// userTxDriver is the BeginTx-capable variant of userDriver used to
// exercise the transactional PatchUsername handler. It records every
// statement executed (including the begin/commit/rollback) so tests can
// assert exact ordering and the partial-failure rollback path.
//
// failOnSubstring lets a test inject failure for an inner ExecContext
// that contains the substring -- the production handler must roll the
// outer transaction back rather than leaving the previous statement
// committed.
type userTxDriver struct {
	mu              sync.Mutex
	events          []string
	failOnSubstring string
}

func (d *userTxDriver) record(s string) {
	d.mu.Lock()
	d.events = append(d.events, s)
	d.mu.Unlock()
}

func (d *userTxDriver) seen() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]string(nil), d.events...)
}

func (d *userTxDriver) Open(_ string) (driver.Conn, error) {
	return &userTxConn{d: d}, nil
}

type userTxConn struct{ d *userTxDriver }

func (c *userTxConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unused")
}
func (c *userTxConn) Close() error { return nil }
func (c *userTxConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}

func (c *userTxConn) BeginTx(_ context.Context, _ driver.TxOptions) (driver.Tx, error) {
	c.d.record("begin")
	return &userTxTx{d: c.d}, nil
}

func (c *userTxConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	c.d.record("exec:" + query)
	if c.d.failOnSubstring != "" && strings.Contains(query, c.d.failOnSubstring) {
		return nil, errors.New("driver injected failure")
	}
	return driver.RowsAffected(0), nil
}

func (c *userTxConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.d.record("query:" + query)
	return &emptyRows{}, nil
}

type emptyRows struct{}

func (r *emptyRows) Columns() []string           { return nil }
func (r *emptyRows) Close() error                { return nil }
func (r *emptyRows) Next(_ []driver.Value) error { return io.EOF }

type userTxTx struct{ d *userTxDriver }

func (t *userTxTx) Commit() error   { t.d.record("commit"); return nil }
func (t *userTxTx) Rollback() error { t.d.record("rollback"); return nil }

func newUserTxStubServer(t *testing.T, name string, d *userTxDriver) *GraphServer {
	t.Helper()
	if _, loaded := registerOnce.LoadOrStore(name, struct{}{}); !loaded {
		sql.Register(name, d)
	}
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return New(Config{Version: "test", Pool: &stubPool{db: db}})
}

// TestPatchUsername_HappyPath_AllUpdatesInOneTx is the success-side
// regression: when every sub-update succeeds, the handler must wrap
// them all in one BeginTx/Commit envelope and emit the expected
// statements in order.
func TestPatchUsername_HappyPath_AllUpdatesInOneTx(t *testing.T) {
	d := &userTxDriver{}
	s := newUserTxStubServer(t, "users_patch_happy", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/users/alice", nil)
	resp, err := s.PatchUsername(rec, req, &gentypes.UserUpdateReq{
		Username: "alice",
		Email:    "alice@example.com",
		// GAP-N4: password must satisfy the >=12-char + non-weak policy.
		Password: "newsecret-pw1",
		Roles:    []string{"admin"},
	})
	if err != nil {
		t.Fatalf("PatchUsername: %v", err)
	}
	if resp.Username != "alice" {
		t.Fatalf("resp=%+v missing username", resp)
	}

	events := d.seen()
	wantOrdered := []string{
		"begin",
		"exec:ALTER USER `alice` SET EMAIL 'alice@example.com'",
		"exec:ALTER USER `alice` SET PASSWORD 'newsecret-pw1'",
		"exec:GRANT ROLE `admin` TO USER `alice`",
		"commit",
	}
	if len(events) != len(wantOrdered) {
		t.Fatalf("events=%v want %v", events, wantOrdered)
	}
	for i, w := range wantOrdered {
		if events[i] != w {
			t.Errorf("event[%d]=%q want %q", i, events[i], w)
		}
	}
}

// TestPatchUsername_PartialFailure_RollsBack verifies the canonical
// Q3 / issue #32 acceptance: when a mid-stream sub-statement fails
// (here, the password update), the handler must roll the outer
// transaction back. Critically, the email update -- which was
// already issued against the connection -- must NOT be visible after
// the rollback (the recorded events end with "rollback", not
// "commit").
func TestPatchUsername_PartialFailure_RollsBack(t *testing.T) {
	d := &userTxDriver{failOnSubstring: "PASSWORD"}
	s := newUserTxStubServer(t, "users_patch_partial_fail", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/users/alice", nil)
	resp, err := s.PatchUsername(rec, req, &gentypes.UserUpdateReq{
		Username: "alice",
		Email:    "alice@example.com",
		// GAP-N4: still needs to pass the policy gate so we reach the
		// driver-level failure under test (PASSWORD substring trap).
		Password: "doomed-pw-12c",
	})
	// Endpoint errors are inlined into rec; the handler returns nil err.
	if err != nil {
		t.Fatalf("PatchUsername returned err %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil on failure", resp)
	}
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d want 422 body=%s", rec.Code, rec.Body.String())
	}

	events := d.seen()
	if len(events) == 0 {
		t.Fatalf("events empty -- handler never reached the driver")
	}
	if events[0] != "begin" {
		t.Fatalf("events[0]=%q want begin (handler must wrap updates in a tx)", events[0])
	}
	last := events[len(events)-1]
	if last != "rollback" {
		t.Fatalf("events end with %q want rollback (partial failure must not commit)", last)
	}
	for _, e := range events {
		if e == "commit" {
			t.Fatalf("events contained commit; want rollback only.\nevents=%v", events)
		}
	}
}

// TestPatchUsername_NoFields_NoTx confirms that an empty PATCH (no
// email/password/roles) does not open a transaction at all -- there
// is no work to commit. This guards against an empty-tx regression
// after the transactional refactor.
func TestPatchUsername_NoFields_NoTx(t *testing.T) {
	d := &userTxDriver{}
	s := newUserTxStubServer(t, "users_patch_empty", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/users/alice", nil)
	if _, err := s.PatchUsername(rec, req, &gentypes.UserUpdateReq{
		Username: "alice",
	}); err != nil {
		t.Fatalf("PatchUsername: %v", err)
	}
	events := d.seen()
	if len(events) != 0 {
		t.Fatalf("events=%v want empty (no fields -> no tx)", events)
	}
}
