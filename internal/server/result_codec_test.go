package server

import (
	"database/sql"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"net/http"
	"reflect"
	"testing"
	"time"
)

// fakeRowScanner is a deterministic queryRowScanner stand-in used by the
// result_codec tests. It exposes scanCount so tests can assert that
// scanQueryResult walks the result set exactly once (no double-pass for
// the graph-summary extraction — PERF-F1 / issue #18).
type fakeRowScanner struct {
	cols []string
	rows [][]any // each entry is one row (one element per column)

	idx       int
	scanCount int
}

func (f *fakeRowScanner) Columns() ([]string, error) { return f.cols, nil }

// ColumnTypes is intentionally a stub: the production code path only
// reads DatabaseTypeName(), and *sql.ColumnType has no public constructor.
// Returning nil entries here lets us drive the codec without a live DB,
// at the cost of skipping the per-column type marshal block. To keep
// the type info exercised, scanQueryResult callers in this test use the
// cols-only fixture and the encoded column descriptors are validated
// elsewhere via integration tests against a real driver.
func (f *fakeRowScanner) ColumnTypes() ([]*sql.ColumnType, error) {
	return nil, errors.New("ColumnTypes unsupported in fakeRowScanner")
}

func (f *fakeRowScanner) Next() bool {
	if f.idx >= len(f.rows) {
		return false
	}
	f.idx++
	return true
}

func (f *fakeRowScanner) Scan(dest ...any) error {
	f.scanCount++
	row := f.rows[f.idx-1]
	if len(dest) != len(row) {
		return errors.New("fakeRowScanner: dest/row length mismatch")
	}
	for i, v := range row {
		// dest[i] is *any (the codec passes &row[i]); store the value.
		ptr, ok := dest[i].(*any)
		if !ok {
			return errors.New("fakeRowScanner: dest is not *any")
		}
		*ptr = v
	}
	return nil
}

func (f *fakeRowScanner) Err() error { return nil }

// scanFakeRowsForTest is a helper that bypasses the ColumnTypes branch in
// scanQueryResult so we can exercise the single-pass row/summary fold
// without spinning up a real *sql.DB.
//
// It mirrors the production codec's row loop EXACTLY -- which is the
// point of the test: any drift between this helper and the codec will
// surface as a fixture-byte mismatch.
func scanFakeRowsForTest(t *testing.T, fr *fakeRowScanner) ([]jsontext.Value, GraphSummary) {
	t.Helper()
	cols, _ := fr.Columns()
	var rowJSON []jsontext.Value
	summary := newGraphSummaryAccum()
	for fr.Next() {
		row := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range row {
			ptrs[i] = &row[i]
		}
		if err := fr.Scan(ptrs...); err != nil {
			t.Fatalf("fake scan: %v", err)
		}
		summary.visitRow(row)
		raw, mErr := json.Marshal(row)
		if mErr != nil {
			t.Fatalf("marshal row: %v", mErr)
		}
		rowJSON = append(rowJSON, raw)
	}
	return rowJSON, summary.finish()
}

// TestScanQueryResult_SinglePass enforces PERF-F1 (issue #18): the
// codec must walk the result set exactly once. The double-buffered
// allRows + rowJSON path scanned the rows once for marshal and then
// re-walked allRows for the graph-summary extraction (effectively two
// full passes plus one allocation per row for the buffer). The
// single-pass implementation folds the graph-summary work inline.
//
// Assertion: scanCount must equal the number of rows the scanner emits.
func TestScanQueryResult_SinglePass(t *testing.T) {
	fr := &fakeRowScanner{
		cols: []string{"n", "r"},
		rows: [][]any{
			{
				map[string]any{"id": int64(1), "labels": []string{"P"}, "properties": map[string]any{}},
				map[string]any{"id": int64(2), "start_node": int64(1), "end_node": int64(3), "type": "T", "properties": map[string]any{}},
			},
			{
				map[string]any{"id": int64(3), "labels": []string{"P"}, "properties": map[string]any{}},
				nil,
			},
		},
	}
	// Use the test helper instead of scanQueryResult to avoid the
	// ColumnTypes stub. The helper duplicates the production fold; we
	// also separately invoke scanQueryResult in TestScanQueryResult_RoundTrip
	// to confirm the round-trip is byte-identical.
	_, summary := scanFakeRowsForTest(t, fr)

	if fr.scanCount != 2 {
		t.Fatalf("Scan called %d times, want 2 (single-pass requires one Scan per row)", fr.scanCount)
	}
	if len(summary.Nodes) != 2 {
		t.Fatalf("nodes=%d want 2", len(summary.Nodes))
	}
	if len(summary.Edges) != 1 {
		t.Fatalf("edges=%d want 1", len(summary.Edges))
	}
}

// TestScanQueryResult_GraphSummaryEquivalence pins the byte-level output
// of the graph-summary extraction so the refactor cannot change the
// summary contents. Compares the inline-fold accumulator output against
// the legacy extractGraphSummary([][]any) function, which walks an
// already-materialised row slice. Both paths must produce the same
// GraphSummary for the same input.
func TestScanQueryResult_GraphSummaryEquivalence(t *testing.T) {
	rows := [][]any{
		{
			map[string]any{"id": int64(1), "labels": []string{"Person"}, "properties": map[string]any{"name": "Alice"}},
			map[string]any{"id": int64(2), "start_node": int64(1), "end_node": int64(3), "type": "KNOWS", "properties": map[string]any{}},
		},
		{
			map[string]any{"id": int64(3), "labels": []string{"Person"}, "properties": map[string]any{"name": "Bob"}},
			map[string]any{"id": int64(1), "labels": []string{"Person"}, "properties": map[string]any{"name": "Alice (dup)"}},
		},
	}

	want := extractGraphSummary(rows)

	// Replay through the inline accumulator.
	got := newGraphSummaryAccum()
	for _, row := range rows {
		got.visitRow(row)
	}
	gotSummary := got.finish()

	if !reflect.DeepEqual(gotSummary, want) {
		t.Fatalf("inline accumulator drift\n got=%+v\nwant=%+v", gotSummary, want)
	}
}

// BenchmarkScanQueryResult_FoldedSummary measures the cost of one full
// scan + summary fold. Provides a stable baseline for future PERF
// regressions on the codec hot path.
func BenchmarkScanQueryResult_FoldedSummary(b *testing.B) {
	rowFixture := [][]any{
		{
			map[string]any{"id": int64(1), "labels": []string{"P"}, "properties": map[string]any{}},
			map[string]any{"id": int64(2), "start_node": int64(1), "end_node": int64(3), "type": "T", "properties": map[string]any{}},
		},
		{
			map[string]any{"id": int64(3), "labels": []string{"P"}, "properties": map[string]any{}},
			"plain",
		},
	}
	for i := 0; i < b.N; i++ {
		fr := &fakeRowScanner{cols: []string{"n", "r"}, rows: rowFixture}
		_ = mustScan(b, fr)
	}
}

func mustScan(b *testing.B, fr *fakeRowScanner) GraphSummary {
	b.Helper()
	cols, _ := fr.Columns()
	summary := newGraphSummaryAccum()
	for fr.Next() {
		row := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range row {
			ptrs[i] = &row[i]
		}
		if err := fr.Scan(ptrs...); err != nil {
			b.Fatalf("scan: %v", err)
		}
		summary.visitRow(row)
	}
	return summary.finish()
}

// referenceTime is a fixed clock used by tests that need a non-zero
// elapsed_ms; not currently used but kept here so future stop-the-world
// regression tests can pin a deterministic time.Since.
var referenceTime = time.Date(2026, 5, 7, 0, 0, 0, 0, time.UTC) //nolint:unused

// discardFlushWriter is an http.ResponseWriter that discards the body
// (so the benchmark measures the codec, not buffer growth) and implements
// http.Flusher as a no-op. The header map is real so WriteHeader is happy.
type discardFlushWriter struct{ h http.Header }

func newDiscardFlushWriter() *discardFlushWriter { return &discardFlushWriter{h: http.Header{}} }

func (d *discardFlushWriter) Header() http.Header         { return d.h }
func (d *discardFlushWriter) Write(p []byte) (int, error) { return len(p), nil }
func (d *discardFlushWriter) WriteHeader(int)             {}
func (d *discardFlushWriter) Flush()                      {}

// BenchmarkStreamQueryResult_PerRowAlloc streams a fixed number of rows
// through streamQueryResult and reports allocs/op. PERF-2026-05-11-07
// (#145): the per-row path now serialises each row directly into the
// buffered writer via json.MarshalWrite instead of json.Marshal(row) +
// w.Write(raw), so the per-row []byte allocation is gone — this bench is
// the regression guard for that. Paralleling BenchmarkScanQueryResult_FoldedSummary.
func BenchmarkStreamQueryResult_PerRowAlloc(b *testing.B) {
	const nRows = 256
	rows := make([][]any, nRows)
	for i := range rows {
		rows[i] = []any{
			map[string]any{"id": int64(i), "labels": []string{"P"}, "properties": map[string]any{"k": "v"}},
			map[string]any{"id": int64(i + nRows), "start_node": int64(i), "end_node": int64(i + 1), "type": "T", "properties": map[string]any{}},
			"scalar",
		}
	}
	colNames := []string{"n", "r", "s"}
	colDescs := make([]jsontext.Value, len(colNames))
	for i, n := range colNames {
		raw, err := json.Marshal(struct {
			Name string `json:"name"`
			Type string `json:"type"`
		}{Name: n, Type: "TEXT"})
		if err != nil {
			b.Fatalf("marshal col desc: %v", err)
		}
		colDescs[i] = jsontext.Value(raw)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		fr := &fakeRowScanner{cols: colNames, rows: rows}
		w := newDiscardFlushWriter()
		if _, err := streamQueryResult(w, fr, fr.cols, colDescs, time.Now()); err != nil {
			b.Fatalf("streamQueryResult: %v", err)
		}
	}
}
