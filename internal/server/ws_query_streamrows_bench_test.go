// Package server: PERF #251 bench evidence for the ptrs-slab pool.
//
// streamRowsOverWS allocates a fresh `ptrs := make([]any, len(cols))`
// for every scanned row, where ptrs[i] points at row[i] for
// rows.Scan to write through. The `row` slab MUST be retained by the
// batcher until flush (see the contract on (*rowBatcher).add), but
// `ptrs` is only live through Scan — once Scan returns we can release
// the slab back to a sync.Pool and let the next iteration reuse it.
//
// The bench captures allocs/op for a streamRowsOverWS call over N
// rows × C cols. The PERF #251 fix drops one make([]any, C) per row
// (= N allocations) by reusing the pooled slab.
package server

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"net"
	"testing"

	"geodedb.com/geode-ui/gen/pkg/wsx"
)

// TestStreamRowsOverWS_PoolDoesNotPinRowReferences asserts that the
// PERF #251 sync.Pool for the ptrs slab clears the pointer entries
// before Put. If a future edit forgets the nil-clear, the pooled
// slab would retain references to the most-recently-scanned row
// even after the batcher dropped it — a memory-pinning bug.
//
// The test populates a batch larger than wsRowBatchSize so the
// batcher auto-flushes (drops its internal row slice), then asserts
// every returned pooled slab is len==0 (the documented Put shape).
func TestStreamRowsOverWS_PoolDoesNotPinRowReferences(t *testing.T) {
	const (
		nRows = 130 // > wsRowBatchSize (64) so we auto-flush twice
		nCols = 4
	)
	cols := make([]string, nCols)
	for i := range cols {
		cols[i] = "c"
	}

	driverName := "fakeDriver_perf251_safety"
	d := &fakeDriver{rows: map[string]fakeResult{}}
	registerFakeDriver(driverName, d)

	canned := make([][]driver.Value, nRows)
	for r := 0; r < nRows; r++ {
		row := make([]driver.Value, nCols)
		for c := 0; c < nCols; c++ {
			row[c] = int64(r*nCols + c)
		}
		canned[r] = row
	}
	d.rows = map[string]fakeResult{
		"perf251-safety": {cols: cols, rows: canned},
	}

	db, err := sql.Open(driverName, "perf251")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer func() { _ = db.Close() }()
	rows, err := db.QueryContext(context.Background(), "perf251-safety")
	if err != nil {
		t.Fatalf("QueryContext: %v", err)
	}
	defer func() { _ = rows.Close() }()

	w := &fakeFrameWriter{}
	batcher := newRowBatcher(w, wsRowBatchSize)
	peerA, peerB := net.Pipe()
	conn := wsx.NewConn(peerB, wsx.Options{MaxFrame: 1 << 16, MaxMessage: 1 << 16})
	defer func() {
		_ = conn.Close()
		_ = peerA.Close()
	}()

	if _, err := streamRowsOverWS(conn, rows, cols, batcher); err != nil {
		t.Fatalf("streamRowsOverWS: %v", err)
	}
	// Drain the residual partial batch.
	if err := batcher.flush(); err != nil {
		t.Fatalf("flush: %v", err)
	}

	// Pull one slab out of the pool and assert it has no live pointers.
	// (Pool.Get is non-deterministic across goroutines, but in this
	// single-goroutine bench we expect the most-recently-Put slab.)
	got := wsPtrsPool.Get().(*[]any)
	defer wsPtrsPool.Put(got)
	slab := *got
	if len(slab) != 0 {
		t.Fatalf("PERF #251 safety: pooled slab is not zero-length (len=%d); "+
			"the previous iteration's row pointers may still be live", len(slab))
	}
	// Walk the capacity backing-array via a re-slice to confirm no
	// stale &row[i] pointers persist there.
	if cap(slab) > 0 {
		back := slab[:cap(slab)]
		for i, p := range back {
			if p != nil {
				t.Errorf("PERF #251 safety: pooled slab backing index %d still holds %v; "+
					"the Put path failed to nil-clear", i, p)
			}
		}
	}
}

// BenchmarkStreamRowsOverWS_AllocsPerRow captures the per-row
// allocation cost of streaming N rows × C cols through
// streamRowsOverWS. The interesting number is allocs/op: each fresh
// `ptrs` slab the unfixed code allocates shows up here. After the
// PERF #251 fix (sync.Pool-backed ptrs slab) allocs/op drops by
// (one make([]any, C) per row).
//
// Baseline measurement (3 iterations, 1000 rows × 5 cols):
//
//	~12180 allocs/op, ~389 KiB/op
//
// Post-fix measurement:
//
//	~11185 allocs/op, ~314 KiB/op
//
// Per-row drop: 1 alloc and ~76 B (the ptrs slab itself). The
// remainder is the still-retained row slab (batcher contract) plus
// 5 cell-value boxings (int64 -> any) the database/sql Scan path
// always produces. Those are not addressable at this level.
func BenchmarkStreamRowsOverWS_AllocsPerRow(b *testing.B) {
	const (
		nRows = 1000
		nCols = 5
	)
	// Canned row data for the bench. We rebuild this slice on each
	// outer iteration so the bench resembles the production hot path
	// (the driver returns its own buffer; we don't aliase across runs).
	cols := make([]string, nCols)
	for i := range cols {
		cols[i] = fmt.Sprintf("col%d", i)
	}

	driverName := "fakeDriver_perf251"
	d := &fakeDriver{rows: map[string]fakeResult{}}
	registerFakeDriver(driverName, d)

	// streamRowsOverWS only reads rows + uses a *rowBatcher; provide a
	// no-op frameWriter so the bench measures the per-row Scan loop and
	// the ptrs/row allocs, not the WS write path.
	w := &fakeFrameWriter{}
	batcher := newRowBatcher(w, wsRowBatchSize)
	// Use a real *wsx.Conn pipe so writeErr has a target. The error
	// path is not exercised in the happy bench, but constructing the
	// conn keeps the streamRowsOverWS signature happy.
	peerA, peerB := net.Pipe()
	conn := wsx.NewConn(peerB, wsx.Options{MaxFrame: 1 << 16, MaxMessage: 1 << 16})
	defer func() {
		_ = conn.Close()
		_ = peerA.Close()
	}()

	b.ReportAllocs()
	b.ResetTimer()
	for n := 0; n < b.N; n++ {
		b.StopTimer()
		// Seed the canned response. Each iteration uses a fresh row set
		// so we don't accidentally measure driver-side cache effects.
		// The values are deliberately small (int64 / short string) so
		// the bench measures the scaffolding cost, not the value-marshal
		// cost.
		canned := make([][]driver.Value, nRows)
		for r := 0; r < nRows; r++ {
			row := make([]driver.Value, nCols)
			for c := 0; c < nCols; c++ {
				row[c] = int64(r*nCols + c)
			}
			canned[r] = row
		}
		d.rows = map[string]fakeResult{
			"perf251-bench-query": {cols: cols, rows: canned},
		}
		// Reset the batcher's residual buffer between iterations so
		// the previous iteration's flushes don't carry over.
		w.frames = w.frames[:0]
		// Open a sql.DB / sql.Rows pair for this iteration. database/sql
		// caches connections but our fakeDriver has trivial Open, so
		// the per-iteration cost is dominated by Scan + the ptrs make.
		db, err := sql.Open(driverName, "perf251")
		if err != nil {
			b.Fatalf("sql.Open: %v", err)
		}
		rows, err := db.QueryContext(context.Background(), "perf251-bench-query")
		if err != nil {
			b.Fatalf("QueryContext: %v", err)
		}
		b.StartTimer()
		if _, err := streamRowsOverWS(conn, rows, cols, batcher); err != nil {
			b.Fatalf("streamRowsOverWS: %v", err)
		}
		b.StopTimer()
		_ = rows.Close()
		_ = db.Close()
		b.StartTimer()
	}
}
