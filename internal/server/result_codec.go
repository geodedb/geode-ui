package server

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

func nodeID(m map[string]any) (int64, bool) {
	if _, hasStart := m["start_node"]; hasStart {
		return 0, false
	}
	id, ok := m["id"].(int64)
	if !ok {
		return 0, false
	}
	if _, ok := m["labels"]; !ok {
		return 0, false
	}
	return id, true
}

func edgeID(m map[string]any) (int64, bool) {
	id, ok := m["id"].(int64)
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
	id, _ := m["id"].(int64)
	labels, _ := m["labels"].([]string)
	props, _ := m["properties"].(map[string]any)
	return GraphNode{ID: id, Labels: labels, Properties: props}
}

func asEdge(m map[string]any) GraphEdge {
	id, _ := m["id"].(int64)
	s, _ := m["start_node"].(int64)
	e, _ := m["end_node"].(int64)
	t, _ := m["type"].(string)
	props, _ := m["properties"].(map[string]any)
	return GraphEdge{ID: id, StartNode: s, EndNode: e, Type: t, Properties: props}
}
