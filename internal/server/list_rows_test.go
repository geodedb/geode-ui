package server

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"

	"encoding/json/jsontext"
)

// listRowsDriver is a registered-once test driver that returns a
// scripted column set and rows for SHOW-style queries, and can be
// configured to return an error matching wire_feature_missing /
// generic faults.
type listRowsDriver struct {
	mu     sync.Mutex
	wantQ  string
	cols   []string
	values [][]driver.Value
	// failWith, when non-nil, is returned from QueryContext.
	failWith error
	seen     []string
}

func (d *listRowsDriver) Open(_ string) (driver.Conn, error) {
	return &listRowsConn{d: d}, nil
}

type listRowsConn struct{ d *listRowsDriver }

func (c *listRowsConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unused")
}
func (c *listRowsConn) Close() error              { return nil }
func (c *listRowsConn) Begin() (driver.Tx, error) { return nil, errors.New("no tx") }

func (c *listRowsConn) QueryContext(_ context.Context, q string, _ []driver.NamedValue) (driver.Rows, error) {
	c.d.mu.Lock()
	c.d.seen = append(c.d.seen, q)
	c.d.mu.Unlock()
	if c.d.failWith != nil {
		return nil, c.d.failWith
	}
	return &listRowsRows{cols: c.d.cols, values: c.d.values}, nil
}

type listRowsRows struct {
	cols   []string
	values [][]driver.Value
	idx    int
}

func (r *listRowsRows) Columns() []string { return r.cols }
func (r *listRowsRows) Close() error      { return nil }
func (r *listRowsRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.values) {
		return io.EOF
	}
	for i, v := range r.values[r.idx] {
		dest[i] = v
	}
	r.idx++
	return nil
}

var listRowsRegOnce sync.Once

func registerListRowsDriver(name string, d *listRowsDriver) {
	listRowsRegOnce.Do(func() {
		sql.Register("listrows-shared", &listRowsDriver{})
	})
	// Register a unique-per-test driver name so subtests don't share state.
	defer func() {
		_ = recover() // sql.Register panics on duplicate; tolerated.
	}()
	sql.Register(name, d)
}

func openListRowsDB(t *testing.T, name string, d *listRowsDriver) *sql.DB {
	t.Helper()
	registerListRowsDriver(name, d)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestListRowsAsJSONValues_HappyPath(t *testing.T) {
	d := &listRowsDriver{
		cols:   []string{"name", "kind"},
		values: [][]driver.Value{{"alpha", "x"}, {"beta", "y"}},
	}
	db := openListRowsDB(t, "listrows_happy", d)
	got, err := listRowsAsJSONValues(context.Background(), db, "SHOW THINGS", "thing", nil)
	if err != nil {
		t.Fatalf("listRowsAsJSONValues err = %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d rows, want 2", len(got))
	}
	s0 := string(got[0])
	if !strings.Contains(s0, `"name":"alpha"`) || !strings.Contains(s0, `"kind":"x"`) {
		t.Fatalf("row[0]=%s want name=alpha + kind=x", s0)
	}
}

func TestListRowsAsJSONValues_WireFeatureMissingReturnsEmpty(t *testing.T) {
	// "42000" + "parse error" together is the pinned wire-feature-
	// missing fingerprint (see internal/server/errors.go).
	d := &listRowsDriver{failWith: errors.New("status_class=42000 message=parse error near SHOW")}
	db := openListRowsDB(t, "listrows_wfm", d)
	got, err := listRowsAsJSONValues(context.Background(), db, "SHOW THINGS", "thing", nil)
	if err != nil {
		t.Fatalf("wire_feature_missing must NOT propagate; err = %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Fatalf("got=%v want empty (non-nil) slice", got)
	}
}

func TestListRowsAsJSONValues_GenericDriverErrorPropagates(t *testing.T) {
	d := &listRowsDriver{failWith: errors.New("driver: unexpected boom")}
	db := openListRowsDB(t, "listrows_err", d)
	got, err := listRowsAsJSONValues(context.Background(), db, "SHOW THINGS", "thing", nil)
	if err == nil {
		t.Fatalf("err = nil, want a wireErr-wrapped propagation; got rows=%v", got)
	}
	if got != nil {
		t.Fatalf("got=%v, want nil on error", got)
	}
	// The helper's wireErr wrapping makes the error visible as an
	// endpoint-style error; the noun "thing" is the caller's concern.
}

func TestListRowsAsJSONValues_NormaliseRowApplied(t *testing.T) {
	d := &listRowsDriver{
		cols:   []string{"role_name"},
		values: [][]driver.Value{{"reader"}, {"writer"}},
	}
	db := openListRowsDB(t, "listrows_norm", d)
	// Apply the v0.5.15 -> legacy name normalisation that GetRoles needs.
	got, err := listRowsAsJSONValues(context.Background(), db, "SHOW ROLES", "role", func(obj map[string]any) {
		if _, has := obj["name"]; !has {
			if rn, ok := obj["role_name"]; ok {
				obj["name"] = rn
			}
		}
	})
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d rows, want 2", len(got))
	}
	for i, raw := range got {
		s := string(raw)
		if !strings.Contains(s, `"name":`) {
			t.Fatalf("row[%d]=%s missing normalised name key", i, s)
		}
		if !strings.Contains(s, `"role_name":`) {
			t.Fatalf("row[%d]=%s lost original role_name", i, s)
		}
	}
}

func TestListRowsAsJSONValues_EmptyRowsReturnsEmptySlice(t *testing.T) {
	d := &listRowsDriver{cols: []string{"x"}, values: nil}
	db := openListRowsDB(t, "listrows_empty", d)
	got, err := listRowsAsJSONValues(context.Background(), db, "SHOW NONE", "thing", nil)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if got == nil {
		t.Fatalf("got nil; want non-nil empty slice (so JSON marshalling emits [] not null)")
	}
	if len(got) != 0 {
		t.Fatalf("got %d rows, want 0", len(got))
	}
}

func TestListRowsAsJSONValues_SignatureReturnsValueSlice(t *testing.T) {
	// Compile-time pin: the helper's first return is []jsontext.Value
	// so it can be inlined into BackupList.Backups / PolicyList.Policies /
	// RoleList.Roles without an additional cast. Runtime-asserted via
	// the variable type below; this test would fail at build time if the
	// helper signature drifts.
	d := &listRowsDriver{cols: []string{"k"}, values: [][]driver.Value{{"v"}}}
	db := openListRowsDB(t, "listrows_sig", d)
	var got []jsontext.Value
	got, err := listRowsAsJSONValues(context.Background(), db, "SHOW STUFF", "stuff", nil)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d rows want 1", len(got))
	}
}
