import type { GqlEdge, GqlNode } from '../graphResult'
import { edgeEndNode, edgeStartNode } from '../graphResult'

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
      const s = edgeStartNode(e)
      const t = edgeEndNode(e)
      if (!realNodeIds.has(s)) danglingIds.add(s)
      if (!realNodeIds.has(t)) danglingIds.add(t)
    })
  }
  return { realNodeIds, danglingIds }
}
