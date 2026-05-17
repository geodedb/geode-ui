import type { GqlEdge, GqlNode } from '../graphResult'

// collectRealEndpoints builds two sets out of graph_summary:
//
//   - realNodeIds: every node ID the server actually materialised
//     (full NODE-typed entries in graph_summary.nodes). Edges whose
//     endpoints land in this set are NOT placeholders -- the node
//     exists.
//   - danglingIds: every edge endpoint that is NOT in realNodeIds
//     and therefore needs a placeholder stub emitted so Cytoscape
//     doesn't silently drop the edge.
//
// Pure: only reads `nodes` and `edges`, returns plain Sets.
export function collectRealEndpoints(
  nodes: GqlNode[] | undefined,
  edges: GqlEdge[] | undefined
): { realNodeIds: Set<number>; danglingIds: Set<number> } {
  const realNodeIds = new Set<number>()
  if (Array.isArray(nodes)) {
    nodes.forEach((n) => realNodeIds.add(n.id))
  }
  const danglingIds = new Set<number>()
  if (Array.isArray(edges)) {
    edges.forEach((e) => {
      if (!realNodeIds.has(e.start_node)) danglingIds.add(e.start_node)
      if (!realNodeIds.has(e.end_node)) danglingIds.add(e.end_node)
    })
  }
  return { realNodeIds, danglingIds }
}
