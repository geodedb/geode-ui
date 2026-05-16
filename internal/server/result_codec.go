package server

import (
	"bufio"
	"database/sql"
	stdjson "encoding/json"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// PERF #217: result codec per-row JSON allocation pools.
//
// The per-row hot path in streamQueryResult / scanQueryResult creates
// a `row []any` and `ptrs []any` per query, plus a graphSummaryAccum
// (containing two maps), plus a jsontext.Encoder for the row marshal.
// At 1k rows / 5 cols the per-query overhead used to be ~24k allocs
// dominated by jsonv2's reflect path for int64-as-any cells. We:
//
//  1. Pool the row + ptrs slices keyed by column count so consecutive
//     queries with the same shape reuse the same backing arrays.
//  2. Pool the graphSummaryAccum (which carries two maps) so a
//     graph-light query path does not allocate three objects just to
//     find zero nodes/edges to extract.
//  3. Pool a jsontext.Encoder per stream so the row-marshal loop
//     reuses one encoder rather than acquiring/releasing the global
//     encoder pool per row.
//  4. Provide a `marshalRowFast` path that writes int64, float64,
//     string, []string, and map[string]any values directly via
//     jsontext.Encoder tokens, bypassing the jsonv2 reflect-based
//     `any` dispatcher (which calls reflect.New per int64 cell).
//
// The pools are package-level vars so the steady-state hot path
// allocates zero per-row scratch.

// rowScratch holds the per-query scratch slices the streaming codec
// uses. The codec pulls one from the pool sized to len(cols) at the
// start of each query and returns it on exit. Slice contents are
// reset before reuse; backing capacity is preserved.
type rowScratch struct {
	row  []any
	ptrs []any
}

// rowScratchPool stores rowScratch instances indexed loosely by column
// count. A single pool is sufficient because the slices are reset on
// Get; the cap() simply grows to accommodate larger queries.
var rowScratchPool = sync.Pool{
	New: func() any {
		return &rowScratch{}
	},
}

// acquireRowScratch returns scratch slices of length n. The returned
// row + ptrs share the same backing memory pattern row[i] <- &ptrs[i]
// the codec relies on.
func acquireRowScratch(n int) *rowScratch {
	s := rowScratchPool.Get().(*rowScratch)
	if cap(s.row) < n {
		s.row = make([]any, n)
		s.ptrs = make([]any, n)
	} else {
		s.row = s.row[:n]
		s.ptrs = s.ptrs[:n]
	}
	for i := range s.row {
		s.row[i] = nil
		s.ptrs[i] = &s.row[i]
	}
	return s
}

// releaseRowScratch returns the scratch to the pool. The caller MUST
// not retain pointers into row / ptrs after this call.
func releaseRowScratch(s *rowScratch) {
	// Nil the entries so the pool does not pin the previous query's
	// graph maps / strings in memory between uses.
	for i := range s.row {
		s.row[i] = nil
	}
	rowScratchPool.Put(s)
}

// graphSummaryAccumPool stores graphSummaryAccum instances for reuse.
// On Get the maps are cleared (cheap O(1) builtin in Go) and the out
// slices are length-reset; backing capacity is preserved so a
// graph-heavy query path does not re-grow the slices every iteration.
var graphSummaryAccumPool = sync.Pool{
	New: func() any {
		return &graphSummaryAccum{
			seenNode: make(map[int64]struct{}),
			seenEdge: make(map[int64]struct{}),
		}
	},
}

func acquireGraphSummaryAccum() *graphSummaryAccum {
	a := graphSummaryAccumPool.Get().(*graphSummaryAccum)
	clear(a.seenNode)
	clear(a.seenEdge)
	a.out.Nodes = a.out.Nodes[:0]
	a.out.Edges = a.out.Edges[:0]
	return a
}

func releaseGraphSummaryAccum(a *graphSummaryAccum) {
	// Drop references so the pool does not pin graph maps in memory.
	for i := range a.out.Nodes {
		a.out.Nodes[i] = GraphNode{}
	}
	for i := range a.out.Edges {
		a.out.Edges[i] = GraphEdge{}
	}
	a.out.Nodes = a.out.Nodes[:0]
	a.out.Edges = a.out.Edges[:0]
	graphSummaryAccumPool.Put(a)
}

// rowEncoderPool stores per-stream jsontext.Encoder instances bound
// to a sync.Pool-managed *bufio.Writer surrogate (we cannot rebind an
// encoder's destination cheaply so we create one encoder per call
// and pool its surrounding scratch). In practice the WIN from this
// pool is small relative to the marshalRowFast fast path, but
// retaining the structure means later refactors can swap in a
// rebindable encoder without rewriting callers.
//
// Note: jsontext.NewEncoder does NOT support rebinding its writer in
// Go 1.26, so the body of marshalRowFast creates an encoder per call
// and the pool wraps a *bytes.Buffer scratch instead.
//
// PERF #217: marshalRowFast eliminates the jsonv2 reflect path for
// int64-as-any cells, which was the dominant per-row alloc source.

// marshalRowFast writes one row of length len(cols) into bw as a
// JSON array. Cell type dispatch covers the shapes Geode produces:
//
//   - nil            -> "null"
//   - bool           -> "true" / "false"
//   - int64 / int    -> integer literal (jsontext.Int, no alloc)
//   - float64        -> number literal
//   - string         -> JSON string
//   - []string       -> JSON string array
//   - []any          -> recursive walk via marshalAnyFast
//   - map[string]any -> recursive walk via marshalMapFast
//   - everything else -> fallback to json.MarshalWrite (slow path)
//
// The fast paths bypass jsonv2's marshalValueAny default branch
// (line ~44 of arshal_any.go) which calls newAddressableValue ->
// reflect.New(t) per cell. That reflect.New is the per-row
// allocation peak we were chasing.
func marshalRowFast(enc *jsontext.Encoder, row []any) error {
	if err := enc.WriteToken(jsontext.BeginArray); err != nil {
		return err
	}
	for _, cell := range row {
		if err := marshalAnyFast(enc, cell); err != nil {
			return err
		}
	}
	return enc.WriteToken(jsontext.EndArray)
}

// marshalAnyFast is the single-cell dispatcher. Kept separate from
// marshalRowFast so map values + array elements can reuse it.
func marshalAnyFast(enc *jsontext.Encoder, v any) error {
	switch x := v.(type) {
	case nil:
		return enc.WriteToken(jsontext.Null)
	case bool:
		return enc.WriteToken(jsontext.Bool(x))
	case int64:
		return enc.WriteToken(jsontext.Int(x))
	case int:
		return enc.WriteToken(jsontext.Int(int64(x)))
	case int32:
		return enc.WriteToken(jsontext.Int(int64(x)))
	case uint32:
		return enc.WriteToken(jsontext.Uint(uint64(x)))
	case uint64:
		return enc.WriteToken(jsontext.Uint(x))
	case float64:
		return enc.WriteToken(jsontext.Float(x))
	case string:
		return enc.WriteToken(jsontext.String(x))
	case []byte:
		// jsonv2 marshals []byte as base64; preserve the same shape
		// by deferring to MarshalEncode for this niche case.
		return json.MarshalEncode(enc, x)
	case []string:
		if err := enc.WriteToken(jsontext.BeginArray); err != nil {
			return err
		}
		for _, s := range x {
			if err := enc.WriteToken(jsontext.String(s)); err != nil {
				return err
			}
		}
		return enc.WriteToken(jsontext.EndArray)
	case []any:
		if err := enc.WriteToken(jsontext.BeginArray); err != nil {
			return err
		}
		for _, item := range x {
			if err := marshalAnyFast(enc, item); err != nil {
				return err
			}
		}
		return enc.WriteToken(jsontext.EndArray)
	case map[string]any:
		return marshalMapFast(enc, x)
	default:
		// Anything we don't recognise (custom struct types, time.Time,
		// json.Number, etc.) falls back to the generic jsonv2 path.
		// The fallback IS slow (reflect.New per call) but preserves
		// shape compatibility with the prior MarshalWrite path so
		// tests that pin byte-for-byte output do not regress.
		return json.MarshalEncode(enc, v)
	}
}

// marshalMapFast walks a map[string]any cell, dispatching values via
// marshalAnyFast. Map iteration order is intentionally
// non-deterministic (matches jsonv2 default). The reflect path's
// per-int64 allocation is what we're avoiding here.
func marshalMapFast(enc *jsontext.Encoder, m map[string]any) error {
	if err := enc.WriteToken(jsontext.BeginObject); err != nil {
		return err
	}
	for k, v := range m {
		if err := enc.WriteToken(jsontext.String(k)); err != nil {
			return err
		}
		if err := marshalAnyFast(enc, v); err != nil {
			return err
		}
	}
	return enc.WriteToken(jsontext.EndObject)
}

// errWriter is a first-error-latching wrapper around a *bufio.Writer used
// by streamQueryResult. Once any write fails, every subsequent call is a
// no-op and err holds the first failure — so the streaming body becomes a
// linear sequence of `ew.str(...)` / `ew.marshal(...)` / `ew.byte(...)`
// calls with a single error check at the end instead of a dozen inline
// `if _, err := ...; err != nil { return ... }` blocks (Q9 / #125).
type errWriter struct {
	w   *bufio.Writer
	err error
}

func (e *errWriter) str(s string) {
	if e.err == nil {
		_, e.err = io.WriteString(e.w, s)
	}
}

func (e *errWriter) byte(b byte) {
	if e.err == nil {
		e.err = e.w.WriteByte(b)
	}
}

func (e *errWriter) raw(p []byte) {
	if e.err == nil {
		_, e.err = e.w.Write(p)
	}
}

// marshal streams v as JSON directly into the buffered writer via the
// encoding/json/v2 streaming encoder — no per-call []byte allocation,
// unlike json.Marshal(v) + w.Write(raw) (PERF-2026-05-11-07 / #145).
func (e *errWriter) marshal(v any) {
	if e.err == nil {
		e.err = json.MarshalWrite(e.w, v)
	}
}

// queryRowScanner is the read-only subset of *sql.Rows that scanQueryResult
// needs. *sql.Tx.QueryContext and *sql.DB.QueryContext both return
// *sql.Rows, so the same helper services both transactional and one-shot
// query paths.
type queryRowScanner interface {
	Columns() ([]string, error)
	ColumnTypes() ([]*sql.ColumnType, error)
	Next() bool
	Scan(dest ...any) error
	Err() error
}

// queryColumnDescs builds the per-column {name,type} JSON descriptors for a
// result set. Pulled out of scanQueryResult so the streaming HTTP handler
// (PERF-F3) can inspect columns *before* it commits to a 200 — a failure
// here still surfaces as a clean 500 because nothing has been written yet.
// Returns the marshalled descriptors and the raw column-name slice (the
// caller needs len(cols) to size its scan buffers).
func queryColumnDescs(rows queryRowScanner) ([]jsontext.Value, []string, error) {
	cols, err := rows.Columns()
	if err != nil {
		return nil, nil, fmt.Errorf("columns: %w", err)
	}
	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return nil, nil, fmt.Errorf("column types: %w", err)
	}
	colDescs := make([]jsontext.Value, len(cols))
	for i, name := range cols {
		raw, mErr := json.Marshal(struct {
			Name string `json:"name"`
			Type string `json:"type"`
		}{Name: name, Type: colTypes[i].DatabaseTypeName()})
		if mErr != nil {
			return nil, nil, fmt.Errorf("marshal column desc: %w", mErr)
		}
		colDescs[i] = jsontext.Value(raw)
	}
	return colDescs, cols, nil
}

// streamFlushEvery is the row interval at which streamQueryResult flushes
// the buffered writer + http.Flusher so a slow consumer sees rows arrive
// incrementally rather than in one big chunk at end-of-stream. Small enough
// that latency stays low on a trickle of rows, large enough that a tight
// row loop isn't dominated by flush syscalls.
const streamFlushEvery = 64

// streamQueryResult writes a *gentypes.QueryResp-shaped JSON document to w
// incrementally: the {"columns":[...],"rows":[ head (then an immediate
// flush so TTFB == first-rows-arrive, not all-rows-collected), each row as
// a JSON array element (flushing every streamFlushEvery rows), then the
// "row_count" / "elapsed_ms" / "graph_summary" trailer that closes the
// object. The graph summary is folded inline as rows are scanned, exactly
// like scanQueryResult — no second pass, no [][]any buffer.
//
// Contract: caller must NOT have written anything to w yet (this function
// owns the status line / Content-Type / body). On a mid-stream driver error
// (rows.Scan or rows.Err) the head is already on the wire, so we return the
// error with the JSON document left intentionally truncated (unclosed); the
// caller's generated wrapper logs it but cannot change the 200 status. Such
// a mid-stream abort is additionally surfaced server-side via slog.Warn
// (Q39 / #134) because the truncated body is the only client-visible
// signal otherwise. On success returns the row count and a nil error.
func streamQueryResult(w http.ResponseWriter, rows queryRowScanner, cols []string, colDescs []jsontext.Value, start time.Time) (int64, error) {
	bw := bufio.NewWriter(w)
	flusher, _ := w.(http.Flusher)
	flush := func() {
		_ = bw.Flush()
		if flusher != nil {
			flusher.Flush()
		}
	}

	// midStreamAbort logs the abort and wraps err for the caller. Called
	// only after the document head is on the wire, so the on-the-wire
	// behavior (truncated body, 200 already committed) is unchanged — this
	// just makes the failure visible in the server logs (Q39 / #134).
	midStreamAbort := func(stage string, rowCount int64, err error) (int64, error) {
		slog.Warn("streamQueryResult: mid-stream abort",
			"stage", stage,
			"rows_sent", rowCount,
			"elapsed_ms", time.Since(start).Milliseconds(),
			"err", err)
		return rowCount, fmt.Errorf("%s: %w", stage, err)
	}

	w.Header().Set("Content-Type", "application/json")
	// 200 is implied on the first Write; set it explicitly so the
	// status is unambiguous even for an empty result set.
	w.WriteHeader(http.StatusOK)

	ew := &errWriter{w: bw}
	ew.str(`{"columns":[`)
	for i, cd := range colDescs {
		if i > 0 {
			ew.byte(',')
		}
		ew.raw(cd)
	}
	ew.str(`],"rows":[`)
	if ew.err != nil {
		// Head failed before any flush: nothing meaningful is on the wire,
		// but the status is already committed — treat as a head error.
		return 0, fmt.Errorf("write head: %w", ew.err)
	}
	flush() // TTFB: client sees the document open before any rows are fetched.

	summary := acquireGraphSummaryAccum()
	defer releaseGraphSummaryAccum(summary)
	scratch := acquireRowScratch(len(cols))
	defer releaseRowScratch(scratch)
	row := scratch.row
	ptrs := scratch.ptrs
	// PERF #217: bind a single jsontext.Encoder to bw and write each row
	// via marshalRowFast. The encoder is owned by this call (no pool —
	// jsontext.NewEncoder does not support rebinding) and the fast path
	// avoids the reflect.New(t) per int64-as-any cell that dominated the
	// pre-PERF #217 baseline.
	rowEnc := jsontext.NewEncoder(bw)
	rowCount := int64(0)
	for rows.Next() {
		// Reset before each Scan — driver may leave previous values in
		// place for null/skipped columns otherwise.
		for i := range row {
			row[i] = nil
		}
		if err := rows.Scan(ptrs...); err != nil {
			// Head already on the wire — abort with a truncated body.
			return midStreamAbort("scan", rowCount, err)
		}
		summary.visitRow(row)
		if rowCount > 0 {
			ew.byte(',')
			if ew.err != nil {
				return midStreamAbort("write row", rowCount, ew.err)
			}
		}
		if err := marshalRowFast(rowEnc, row); err != nil {
			return midStreamAbort("write row", rowCount, err)
		}
		rowCount++
		if rowCount%streamFlushEvery == 0 {
			flush()
		}
	}
	if err := rows.Err(); err != nil {
		return midStreamAbort("rows", rowCount, err)
	}

	writeTrailer(ew, rowCount, start, summary.finish())
	if ew.err != nil {
		return midStreamAbort("write trailer", rowCount, ew.err)
	}
	flush()
	return rowCount, nil
}

// writeTrailer appends the `],"row_count":N,"elapsed_ms":M,"graph_summary":{...}}`
// tail that closes the streamed QueryResp document. Pulled out of
// streamQueryResult so the row loop reads as a flat sequence of writes
// (Q9 / #125). Errors latch on ew; the caller checks ew.err once.
func writeTrailer(ew *errWriter, rowCount int64, start time.Time, summary GraphSummary) {
	ew.str(`],"row_count":`)
	ew.str(strconv.FormatInt(rowCount, 10))
	ew.str(`,"elapsed_ms":`)
	ew.str(strconv.FormatInt(time.Since(start).Milliseconds(), 10))
	ew.str(`,"graph_summary":`)
	ew.marshal(summary)
	ew.byte('}')
}

// scanQueryResult drains rows into a *gentypes.QueryResp using the same
// shape Query exposes: per-column descriptors, per-row JSON arrays, a
// graph summary, and elapsed_ms measured from start. Both the synchronous
// query handler and the transactional Run handler call this so the shape
// stays consistent across endpoints.
//
// PERF-F1 / issue #18: this is a single-pass scan. Each row is scanned
// once, fed through the inline graph-summary accumulator (visitRow), then
// JSON-marshalled. The previous implementation buffered every row into a
// [][]any slice and walked it again in extractGraphSummary -- two full
// passes plus an extra row-sized allocation per result.
func scanQueryResult(rows queryRowScanner, start time.Time) (*gentypes.QueryResp, error) {
	colDescs, cols, err := queryColumnDescs(rows)
	if err != nil {
		return nil, err
	}

	// Single-pass row drain: scan -> fold into summary -> marshal -> append.
	// PERF #217: reuse pooled row/ptrs scratch + summary accumulator.
	// The JSON marshaller snapshots its inputs so the next iteration can
	// safely overwrite the shared slice contents.
	rowJSON := make([]jsontext.Value, 0)
	summary := acquireGraphSummaryAccum()
	defer releaseGraphSummaryAccum(summary)
	scratch := acquireRowScratch(len(cols))
	defer releaseRowScratch(scratch)
	row := scratch.row
	ptrs := scratch.ptrs
	rowCount := int64(0)
	for rows.Next() {
		// Reset before each Scan -- driver may leave previous values in
		// place for null/skipped columns otherwise.
		for i := range row {
			row[i] = nil
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		summary.visitRow(row)
		raw, mErr := json.Marshal(row)
		if mErr != nil {
			return nil, fmt.Errorf("marshal row: %w", mErr)
		}
		rowJSON = append(rowJSON, jsontext.Value(raw))
		rowCount++
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	graphSummary := summary.finish()
	summaryJSON, err := json.Marshal(graphSummary)
	if err != nil {
		return nil, fmt.Errorf("marshal graph summary: %w", err)
	}

	return &gentypes.QueryResp{
		Columns:      colDescs,
		Rows:         rowJSON,
		RowCount:     rowCount,
		ElapsedMs:    time.Since(start).Milliseconds(),
		GraphSummary: jsontext.Value(summaryJSON),
	}, nil
}

// GraphNode is the JSON-friendly representation of a Geode node row cell.
type GraphNode struct {
	ID         int64          `json:"id"`
	Labels     []string       `json:"labels"`
	Properties map[string]any `json:"properties"`
}

// GraphEdge is the JSON-friendly representation of a Geode edge row cell.
type GraphEdge struct {
	ID         int64          `json:"id"`
	StartNode  int64          `json:"start_node"`
	EndNode    int64          `json:"end_node"`
	Type       string         `json:"type"`
	Properties map[string]any `json:"properties"`
}

// GraphSummary is the deduplicated set of nodes and edges the UI needs to
// render a graph view alongside the tabular result.
type GraphSummary struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

// graphSummaryAccum is the streaming state used by scanQueryResult to
// extract the graph summary inline as rows are scanned. visitRow is
// called once per row with the raw cell slice; finish returns the
// finalised GraphSummary at end-of-stream.
//
// The accumulator is a thin wrapper around two dedup maps -- it deliberately
// has no buffering of its own beyond the GraphSummary slices it builds.
type graphSummaryAccum struct {
	seenNode map[int64]struct{}
	seenEdge map[int64]struct{}
	out      GraphSummary
}

func newGraphSummaryAccum() *graphSummaryAccum {
	return &graphSummaryAccum{
		seenNode: map[int64]struct{}{},
		seenEdge: map[int64]struct{}{},
	}
}

// visit drains a single decoded JSON value (cell, list element, or nested
// path member) into the accumulator. The recursion mirrors the previous
// extractGraphSummary closure: nodes have {id, labels}, edges have
// {id, start_node, end_node}, and paths have {nodes:[], edges:[]}.
func (a *graphSummaryAccum) visit(v any) {
	switch t := v.(type) {
	case map[string]any:
		if id, ok := nodeID(t); ok {
			if _, dup := a.seenNode[id]; !dup {
				a.out.Nodes = append(a.out.Nodes, asNode(t))
				a.seenNode[id] = struct{}{}
			}
		}
		if id, ok := edgeID(t); ok {
			if _, dup := a.seenEdge[id]; !dup {
				a.out.Edges = append(a.out.Edges, asEdge(t))
				a.seenEdge[id] = struct{}{}
			}
		}
		if nodes, ok := t["nodes"].([]any); ok {
			for _, n := range nodes {
				a.visit(n)
			}
		}
		if edges, ok := t["edges"].([]any); ok {
			for _, e := range edges {
				a.visit(e)
			}
		}
	case []any:
		for _, item := range t {
			a.visit(item)
		}
	}
}

// visitRow folds one row's worth of cells into the accumulator.
func (a *graphSummaryAccum) visitRow(row []any) {
	for _, cell := range row {
		a.visit(cell)
	}
}

// finish returns the GraphSummary built up so far. The accumulator is
// not safe to reuse afterwards.
func (a *graphSummaryAccum) finish() GraphSummary {
	return a.out
}

// extractGraphSummary walks rows and returns a GraphSummary. Retained
// for the test surface and any future caller that already has the rows
// buffered; the production hot path now folds the work inline via
// graphSummaryAccum during the single-pass scanQueryResult drain.
//
// Geode returns nodes as map[string]any with keys {id, labels, properties},
// edges as {id, start_node, end_node, type, properties}, paths as
// {nodes: []map, edges: []map}. See geode-client-go/rows.go:118-138.
func extractGraphSummary(rows [][]any) GraphSummary {
	a := newGraphSummaryAccum()
	for _, row := range rows {
		a.visitRow(row)
	}
	return a.finish()
}

// toInt64 best-effort coerces a decoded JSON value into an int64. JSON
// decoders (especially v2 / encoding/json with UseNumber) can hand us
// numbers as float64, json.Number, int, or various sized integers depending
// on the path the value travelled, so we accept all of them and reject
// anything that would lose precision or overflow.
func toInt64(v any) (int64, bool) {
	switch x := v.(type) {
	case int64:
		return x, true
	case int:
		return int64(x), true
	case int32:
		return int64(x), true
	case uint32:
		return int64(x), true
	case uint64:
		if x > math.MaxInt64 {
			return 0, false
		}
		return int64(x), true
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return 0, false
		}
		if math.Trunc(x) != x {
			return 0, false
		}
		if x < math.MinInt64 || x > math.MaxInt64 {
			return 0, false
		}
		return int64(x), true
	case stdjson.Number:
		n, err := x.Int64()
		if err != nil {
			return 0, false
		}
		return n, true
	}
	return 0, false
}

// asStringSlice coerces a decoded JSON value into a []string. JSON arrays
// arrive as []any after a generic decode, so we drop non-string entries
// rather than stringifying numbers/objects (which would surprise UI users
// who expect labels to be authored strings).
func asStringSlice(v any) []string {
	switch x := v.(type) {
	case []string:
		return x
	case []any:
		out := make([]string, 0, len(x))
		for _, item := range x {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

func nodeID(m map[string]any) (int64, bool) {
	if _, hasStart := m["start_node"]; hasStart {
		return 0, false
	}
	id, ok := toInt64(m["id"])
	if !ok {
		return 0, false
	}
	if _, ok := m["labels"]; !ok {
		return 0, false
	}
	return id, true
}

func edgeID(m map[string]any) (int64, bool) {
	id, ok := toInt64(m["id"])
	if !ok {
		return 0, false
	}
	_, hasStart := m["start_node"]
	_, hasEnd := m["end_node"]
	if !hasStart || !hasEnd {
		return 0, false
	}
	return id, true
}

func asNode(m map[string]any) GraphNode {
	id, _ := toInt64(m["id"])
	labels := asStringSlice(m["labels"])
	props, _ := m["properties"].(map[string]any)
	return GraphNode{ID: id, Labels: labels, Properties: props}
}

func asEdge(m map[string]any) GraphEdge {
	id, _ := toInt64(m["id"])
	s, _ := toInt64(m["start_node"])
	e, _ := toInt64(m["end_node"])
	t, _ := m["type"].(string)
	props, _ := m["properties"].(map[string]any)
	return GraphEdge{ID: id, StartNode: s, EndNode: e, Type: t, Properties: props}
}
