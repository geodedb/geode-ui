package server

import (
	"encoding/json"
	"math"
)

// extractGraphSummary walks the rows of a query result and pulls out any
// nodes/edges/paths so the UI can render a graph view alongside the table.
//
// Geode returns nodes as map[string]any with keys {id, labels, properties},
// edges as {id, start_node, end_node, type, properties}, paths as
// {nodes: []map, edges: []map}. See geode-client-go/rows.go:118-138.

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

func extractGraphSummary(rows [][]any) GraphSummary {
	seenNode := map[int64]struct{}{}
	seenEdge := map[int64]struct{}{}
	var summary GraphSummary
	var visit func(v any)
	visit = func(v any) {
		switch t := v.(type) {
		case map[string]any:
			if id, ok := nodeID(t); ok {
				if _, dup := seenNode[id]; !dup {
					summary.Nodes = append(summary.Nodes, asNode(t))
					seenNode[id] = struct{}{}
				}
			}
			if id, ok := edgeID(t); ok {
				if _, dup := seenEdge[id]; !dup {
					summary.Edges = append(summary.Edges, asEdge(t))
					seenEdge[id] = struct{}{}
				}
			}
			if nodes, ok := t["nodes"].([]any); ok {
				for _, n := range nodes {
					visit(n)
				}
			}
			if edges, ok := t["edges"].([]any); ok {
				for _, e := range edges {
					visit(e)
				}
			}
		case []any:
			for _, item := range t {
				visit(item)
			}
		}
	}
	for _, row := range rows {
		for _, cell := range row {
			visit(cell)
		}
	}
	return summary
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
	case json.Number:
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
