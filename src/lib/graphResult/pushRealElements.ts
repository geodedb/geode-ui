import type { ElementDefinition } from 'cytoscape'
import type { GqlEdge, GqlNode } from '../graphResult'

// pushRealNodes appends every NODE-typed entry the server returned in
// graph_summary.nodes onto `out`. Pure write-through; preserves the
// original element shape so downstream consumers (labelOptions,
// resolveNodeLabel, buildCompoundElements) keep working.
export function pushRealNodes(
  out: ElementDefinition[],
  nodes: GqlNode[] | undefined
): void {
  if (!Array.isArray(nodes)) return
  nodes.forEach((n) => {
    out.push({
      group: 'nodes',
      data: {
        id: String(n.id),
        label: (n.labels && n.labels[0]) || 'Node',
        labels: n.labels,
        props: n.properties,
      },
    })
  })
}

// pushPlaceholderNodes appends one stub-node per dangling edge
// endpoint (an endpoint NOT present in realNodeIds). The stub uses
// the row-derived display label from placeholderLabels and the
// MATCH-derived GQL label from placeholderTypeLabels when available.
// Without these stubs Cytoscape silently drops edges whose
// source/target points at a missing node.
export function pushPlaceholderNodes(
  out: ElementDefinition[],
  danglingIds: Set<number>,
  placeholderLabels: Map<number, string>,
  placeholderTypeLabels: Map<number, string>
): void {
  danglingIds.forEach((id) => {
    const label = placeholderLabels.get(id) ?? `#${id}`
    const typeLabel = placeholderTypeLabels.get(id)
    out.push({
      group: 'nodes',
      data: {
        id: String(id),
        label,
        labels: typeLabel ? [typeLabel] : [],
        props: {},
        placeholder: true,
      },
    })
  })
}

// pushRealEdges appends every EDGE entry from graph_summary.edges
// with the wire-stable shape ({id, source, target, type, label,
// props}). Pure write-through.
export function pushRealEdges(
  out: ElementDefinition[],
  edges: GqlEdge[] | undefined
): void {
  if (!Array.isArray(edges)) return
  edges.forEach((e) => {
    out.push({
      group: 'edges',
      data: {
        id: `e${e.id}`,
        source: String(e.start_node),
        target: String(e.end_node),
        type: e.type,
        label: e.type,
        props: e.properties,
      },
    })
  })
}
