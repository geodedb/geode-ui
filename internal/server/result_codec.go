package server

import (
	"database/sql"
	stdjson "encoding/json"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"math"
	"time"

	gentypes "geodedb.com/geode-ui/gen/types"
)

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
	cols, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("columns: %w", err)
	}
	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return nil, fmt.Errorf("column types: %w", err)
	}
	colDescs := make([]jsontext.Value, len(cols))
	for i, name := range cols {
		raw, mErr := json.Marshal(struct {
			Name string `json:"name"`
			Type string `json:"type"`
		}{Name: name, Type: colTypes[i].DatabaseTypeName()})
		if mErr != nil {
			return nil, fmt.Errorf("marshal column desc: %w", mErr)
		}
		colDescs[i] = jsontext.Value(raw)
	}

	// Single-pass row drain: scan -> fold into summary -> marshal -> append.
	// We reuse one row backing array per iteration; the JSON marshaller
	// snapshots its inputs so the next iteration can safely overwrite the
	// slice contents.
	rowJSON := make([]jsontext.Value, 0)
	summary := newGraphSummaryAccum()
	row := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range row {
		ptrs[i] = &row[i]
	}
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
