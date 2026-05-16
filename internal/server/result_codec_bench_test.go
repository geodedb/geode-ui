// PERF #217: result codec per-row JSON allocation microbenchmark.
//
// Acceptance: streaming a 1k-row, 5-column result through
// streamQueryResult must allocate at least 30% fewer objects per query
// than the unpooled baseline. The companion bench
// BenchmarkStreamQueryResult_PerRowAlloc (5 cols, mixed graph+scalar)
// pins the broader regression.
package server

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"testing"
	"time"
)

// build1kRowFixture constructs the 1,000-row, 5-column fixture the
// PERF #217 acceptance test uses. Columns are a mix of scalars and
// graph-shaped maps so the per-row marshal pressure matches a real
// MATCH-returning-multi-cell result.
func build1kRowFixture() ([]string, []jsontext.Value, [][]any) {
	const nRows = 1000
	colNames := []string{"n", "r", "label", "count", "ts"}
	colDescs := make([]jsontext.Value, len(colNames))
	for i, n := range colNames {
		raw, err := json.Marshal(struct {
			Name string `json:"name"`
			Type string `json:"type"`
		}{Name: n, Type: "TEXT"})
		if err != nil {
			panic(err)
		}
		colDescs[i] = jsontext.Value(raw)
	}
	rows := make([][]any, nRows)
	for i := range rows {
		rows[i] = []any{
			map[string]any{
				"id":         int64(i),
				"labels":     []string{"Person"},
				"properties": map[string]any{"name": "Alice", "age": int64(30)},
			},
			map[string]any{
				"id":         int64(i + nRows),
				"start_node": int64(i),
				"end_node":   int64(i + 1),
				"type":       "KNOWS",
				"properties": map[string]any{"since": int64(2020)},
			},
			"label-string",
			int64(i),
			"2026-05-16T00:00:00Z",
		}
	}
	return colNames, colDescs, rows
}

// BenchmarkStreamQueryResult_1k5Col is the PERF #217 acceptance
// benchmark. The result codec must reduce allocs/op by >= 30% from
// the pre-pool baseline (recorded as a comment below for reference;
// future regressions trip the comparison gate when run alongside
// BenchmarkStreamQueryResult_PerRowAlloc).
//
// Pre-pool baseline (256-row, 3-col fixture): 149,090 B/op, 3,388 allocs/op.
// Pre-pool 1k-row, 5-col baseline: ~666 KB/op, ~24,083 allocs/op.
// Post-pool 1k-row, 5-col actuals: ~209 KB/op, ~9,062 allocs/op (62% reduction).
// Future regression gate: TestStreamQueryResult_1k5ColAllocBudget below.
func BenchmarkStreamQueryResult_1k5Col(b *testing.B) {
	colNames, colDescs, rows := build1kRowFixture()
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

// TestStreamQueryResult_1k5ColAllocBudget is the regression gate for
// PERF #217. The pre-pool baseline at 1k rows / 5 cols was 24,083
// allocs/op. The acceptance criterion is >= 30% reduction; we pin
// the gate at 70% of the baseline (~16,858 allocs) so accidental
// reintroduction of the reflect-based any path trips the test before
// it lands. The current implementation comfortably clears this with
// ~9,062 allocs/op (62% reduction).
//
// We measure allocations via testing.AllocsPerRun rather than parsing
// the benchmark output so the assertion runs under `go test` (not
// `go test -bench`).
func TestStreamQueryResult_1k5ColAllocBudget(t *testing.T) {
	colNames, colDescs, rows := build1kRowFixture()
	// Warm the pools so the first call's lazy-init doesn't taint the
	// measurement. AllocsPerRun does its own warm-up but the pool
	// behaviour is more deterministic with an explicit primer.
	for i := 0; i < 2; i++ {
		fr := &fakeRowScanner{cols: colNames, rows: rows}
		w := newDiscardFlushWriter()
		if _, err := streamQueryResult(w, fr, fr.cols, colDescs, time.Now()); err != nil {
			t.Fatalf("primer: %v", err)
		}
	}
	avg := testing.AllocsPerRun(5, func() {
		fr := &fakeRowScanner{cols: colNames, rows: rows}
		w := newDiscardFlushWriter()
		if _, err := streamQueryResult(w, fr, fr.cols, colDescs, time.Now()); err != nil {
			t.Fatalf("streamQueryResult: %v", err)
		}
	})
	// Pre-pool baseline: 24,083 allocs/op. 70% ceiling: 16,858.
	const ceiling = 16_858
	if avg > ceiling {
		t.Fatalf("PERF #217 regression: streamQueryResult 1k5Col allocs/op=%.0f, want <= %d (pre-pool baseline 24,083)",
			avg, ceiling)
	}
	// Lower-bound sanity: if allocs/op dropped to ZERO we are probably
	// counting on a fast path that skips the marshaller entirely (bug).
	if avg < 100 {
		t.Fatalf("PERF #217 sanity: allocs/op=%.0f below 100; codec is likely no-op", avg)
	}
}
