// ----- "Explore neighbours" (Phase 2 / Task 2.4) -----
//
// The selected node's 1-hop subgraph is fetched by re-querying the
// connected graph. Geode GQL supports the `id(n)` predicate (see the
// geode docs / shell test suite — e.g. `MATCH (e:Employee) WHERE id(e) =
// nodeId`), so the statement is the id-keyed form below. Only valid for
// nodes that carry a real (numeric) Geode id — synthesised nodes from a
// scalar-only RETURN don't have one, so the inspector disables the
// action for them.

// True when `id` looks like a real Geode node id (a non-negative
// integer in string form, which is what extractElements emits for
// graph_summary nodes and edge-endpoint placeholders).
export function isRealNodeId(id: string): boolean {
  return /^\d+$/.test(id)
}

// Build the 1-hop subgraph statement for a real node id. Undirected
// match (`-[r]-`) so both incoming and outgoing edges come back.
export function buildExploreStatement(nodeId: string): string {
  return `MATCH (n)-[r]-(m) WHERE id(n) = ${nodeId} RETURN n, r, m LIMIT 100;`
}

// Pull the graph name out of a leading `USE GRAPH <name>;` so the
// explore query targets the same graph. Returns undefined when the
// original query has no such prefix (server falls back to the default).
export function graphNameOf(query: string | undefined): string | undefined {
  if (!query) return undefined
  const m = query.match(/^\s*USE\s+GRAPH\s+([A-Za-z_][\w-]*)\s*;/i)
  return m ? m[1] : undefined
}
