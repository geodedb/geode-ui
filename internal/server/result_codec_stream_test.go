package server

import (
	"bytes"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

// flushRecorder is an httptest.ResponseRecorder that also counts Flush
// calls so streaming tests can assert the handler flushes the response
// head before fetching rows (the TTFB property PERF-F3 buys).
type flushRecorder struct {
	*httptest.ResponseRecorder

	flushes int
}

func newFlushRecorder() *flushRecorder {
	return &flushRecorder{ResponseRecorder: httptest.NewRecorder()}
}

func (f *flushRecorder) Flush() { f.flushes++ }

// errRowScanner wraps fakeRowScanner to inject a Scan error on the Nth
// row so we can exercise the mid-stream-failure branch of
// streamQueryResult (head already on the wire, body truncated).
type errRowScanner struct {
	*fakeRowScanner

	failOn int // 1-based row index whose Scan returns an error; 0 = never
}

func (e *errRowScanner) Scan(dest ...any) error {
	if e.failOn > 0 && e.idx == e.failOn {
		return errors.New("driver boom")
	}
	return e.fakeRowScanner.Scan(dest...)
}

func colDescsForTest(t *testing.T, names ...string) []jsontext.Value {
	t.Helper()
	out := make([]jsontext.Value, len(names))
	for i, n := range names {
		raw, err := json.Marshal(struct {
			Name string `json:"name"`
			Type string `json:"type"`
		}{Name: n, Type: "TEXT"})
		if err != nil {
			t.Fatalf("marshal col desc: %v", err)
		}
		out[i] = jsontext.Value(raw)
	}
	return out
}

// TestStreamQueryResult_WireShape verifies that streamQueryResult emits the
// same JSON object the buffered scanQueryResult produces — columns, rows,
// row_count, elapsed_ms, graph_summary — so the wire contract is unchanged
// by the streaming refactor (PERF-F3 / #25). It also confirms the response
// is flushed (so the head reaches the client before all rows are fetched)
// and that the status is 200 with Content-Type application/json.
func TestStreamQueryResult_WireShape(t *testing.T) {
	fr := &fakeRowScanner{
		cols: []string{"n", "r"},
		rows: [][]any{
			{
				map[string]any{"id": int64(1), "labels": []string{"Person"}, "properties": map[string]any{"name": "Alice"}},
				map[string]any{"id": int64(2), "start_node": int64(1), "end_node": int64(3), "type": "KNOWS", "properties": map[string]any{}},
			},
			{
				map[string]any{"id": int64(3), "labels": []string{"Person"}, "properties": map[string]any{"name": "Bob"}},
				"plain",
			},
		},
	}
	rec := newFlushRecorder()
	colDescs := colDescsForTest(t, "n", "r")

	rowCount, err := streamQueryResult(rec, fr, fr.cols, colDescs, time.Now())
	if err != nil {
		t.Fatalf("streamQueryResult: %v", err)
	}
	if rowCount != 2 {
		t.Fatalf("rowCount=%d want 2", rowCount)
	}
	if rec.flushes == 0 {
		t.Error("expected at least one Flush (head should be flushed before fetching rows)")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status=%d want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type=%q want application/json", ct)
	}

	// The body must parse as a single JSON object with the QueryResp keys.
	var resp struct {
		Columns      []jsontext.Value `json:"columns"`
		Rows         []jsontext.Value `json:"rows"`
		RowCount     int64            `json:"row_count"`
		ElapsedMs    int64            `json:"elapsed_ms"`
		GraphSummary GraphSummary     `json:"graph_summary"`
	}
	body := rec.Body.Bytes()
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("response body is not valid JSON: %v\nbody=%s", err, body)
	}
	if len(resp.Columns) != 2 {
		t.Errorf("columns len=%d want 2", len(resp.Columns))
	}
	if len(resp.Rows) != 2 {
		t.Errorf("rows len=%d want 2", len(resp.Rows))
	}
	if resp.RowCount != 2 {
		t.Errorf("row_count=%d want 2", resp.RowCount)
	}
	if resp.ElapsedMs < 0 {
		t.Errorf("elapsed_ms=%d should be non-negative", resp.ElapsedMs)
	}
	// Graph summary: 2 distinct nodes (Alice, Bob) + 1 edge (KNOWS).
	if len(resp.GraphSummary.Nodes) != 2 {
		t.Errorf("graph_summary.nodes=%d want 2", len(resp.GraphSummary.Nodes))
	}
	if len(resp.GraphSummary.Edges) != 1 {
		t.Errorf("graph_summary.edges=%d want 1", len(resp.GraphSummary.Edges))
	}

	// Equivalence with the buffered path: each streamed row decodes to the
	// same value the buffered codec produced (key order inside row-cell
	// objects is not a stability contract — both paths go through
	// json.Marshal(row) — so compare decoded values, not raw bytes).
	wantRows, wantSummary := scanFakeRowsForTest(t, &fakeRowScanner{cols: fr.cols, rows: [][]any{
		{
			map[string]any{"id": int64(1), "labels": []string{"Person"}, "properties": map[string]any{"name": "Alice"}},
			map[string]any{"id": int64(2), "start_node": int64(1), "end_node": int64(3), "type": "KNOWS", "properties": map[string]any{}},
		},
		{
			map[string]any{"id": int64(3), "labels": []string{"Person"}, "properties": map[string]any{"name": "Bob"}},
			"plain",
		},
	}})
	if len(wantRows) != len(resp.Rows) {
		t.Fatalf("buffered rows=%d streamed rows=%d", len(wantRows), len(resp.Rows))
	}
	for i := range wantRows {
		var bufVal, strVal any
		if err := json.Unmarshal(wantRows[i], &bufVal); err != nil {
			t.Fatalf("decode buffered row %d: %v", i, err)
		}
		if err := json.Unmarshal(resp.Rows[i], &strVal); err != nil {
			t.Fatalf("decode streamed row %d: %v", i, err)
		}
		if !reflect.DeepEqual(bufVal, strVal) {
			t.Errorf("row %d decodes differently: buffered=%v streamed=%v", i, bufVal, strVal)
		}
	}
	if len(wantSummary.Nodes) != len(resp.GraphSummary.Nodes) || len(wantSummary.Edges) != len(resp.GraphSummary.Edges) {
		t.Errorf("graph summary differs: buffered nodes=%d edges=%d streamed nodes=%d edges=%d",
			len(wantSummary.Nodes), len(wantSummary.Edges), len(resp.GraphSummary.Nodes), len(resp.GraphSummary.Edges))
	}
}

// TestStreamQueryResult_EmptyResult covers the zero-row case: the head and
// trailer must still produce a valid {columns:[...],rows:[],row_count:0,...}
// document with a 200 status.
func TestStreamQueryResult_EmptyResult(t *testing.T) {
	fr := &fakeRowScanner{cols: []string{"x"}, rows: nil}
	rec := newFlushRecorder()
	rowCount, err := streamQueryResult(rec, fr, fr.cols, colDescsForTest(t, "x"), time.Now())
	if err != nil {
		t.Fatalf("streamQueryResult: %v", err)
	}
	if rowCount != 0 {
		t.Fatalf("rowCount=%d want 0", rowCount)
	}
	var resp struct {
		Rows     []jsontext.Value `json:"rows"`
		RowCount int64            `json:"row_count"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("empty result body invalid: %v\nbody=%s", err, rec.Body.Bytes())
	}
	if len(resp.Rows) != 0 || resp.RowCount != 0 {
		t.Errorf("rows=%d row_count=%d want 0/0", len(resp.Rows), resp.RowCount)
	}
}

// TestStreamQueryResult_MidStreamError exercises the failure-after-head
// branch: once the {"columns":[...],"rows":[ head is written, a driver Scan
// error cannot be turned into a 4xx — streamQueryResult returns the error,
// the status is already 200, and the body is left truncated (unparseable).
func TestStreamQueryResult_MidStreamError(t *testing.T) {
	inner := &fakeRowScanner{
		cols: []string{"v"},
		rows: [][]any{{"ok1"}, {"ok2"}, {"boom"}},
	}
	er := &errRowScanner{fakeRowScanner: inner, failOn: 3}
	rec := newFlushRecorder()

	// Capture slog so we can assert the mid-stream-abort warning fires
	// (Q39 / #134): the truncated body is the only client-visible signal,
	// so the server must log the failure.
	var logBuf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	rowCount, err := streamQueryResult(rec, er, inner.cols, colDescsForTest(t, "v"), time.Now())
	if err == nil {
		t.Fatal("expected an error from the mid-stream Scan failure")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status=%d want 200 (head was already committed before the error)", rec.Code)
	}
	// Two rows ("ok1", "ok2") made it onto the wire before the third Scan blew up.
	if rowCount != 2 {
		t.Errorf("rowCount=%d want 2 (rows streamed before the abort)", rowCount)
	}
	// The body should be a truncated/unclosed JSON document.
	var anyVal any
	if json.Unmarshal(rec.Body.Bytes(), &anyVal) == nil {
		t.Errorf("expected truncated/invalid JSON body, got parseable: %s", rec.Body.Bytes())
	}

	// The abort must be logged with rows_sent (and the originating error).
	logged := logBuf.String()
	if !strings.Contains(logged, "streamQueryResult: mid-stream abort") {
		t.Errorf("missing mid-stream-abort warning in slog output:\n%s", logged)
	}
	if !strings.Contains(logged, "rows_sent=2") {
		t.Errorf("mid-stream-abort warning missing rows_sent=2:\n%s", logged)
	}
	if !strings.Contains(logged, "stage=scan") {
		t.Errorf("mid-stream-abort warning missing stage=scan:\n%s", logged)
	}
	if !strings.Contains(logged, "driver boom") {
		t.Errorf("mid-stream-abort warning missing the underlying error:\n%s", logged)
	}
	if !strings.Contains(logged, "level=WARN") {
		t.Errorf("mid-stream-abort should be logged at WARN level:\n%s", logged)
	}
}
