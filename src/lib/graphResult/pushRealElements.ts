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
    const primaryLabel = (n.labels && n.labels[0]) || 'Node'
    out.push({
      group: 'nodes',
      data: {
        id: String(n.id),
        label: primaryLabel,
        labels: n.labels,
        // nodeType is the IMMUTABLE color seed. cytoscapeStyle.ts hashes
        // it to pick the node's background palette slot — keeping it
        // stable across `applyLabels` mutations means the canvas color
        // stays bound to the graph TYPE (Movie, Person), not whichever
        // display property the user picked.
        nodeType: primaryLabel,
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
        // Placeholders inherit the MATCH-derived type when the parser
        // could pin it; otherwise fall back to the row-derived label.
        // Either way the field exists so cytoscapeStyle.ts can hash a
        // stable color without falling back to e.data('label') (which
        // applyLabels mutates).
        nodeType: typeLabel ?? label,
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
        // edgeType is the IMMUTABLE color seed for edges, the analogue
        // of nodeType. applyLabels mutates `data.type` to whichever
        // display property the user picked; edgeType stays bound to the
        // relationship type ('ACTED_IN', 'DIRECTED') so the canvas
        // color is stable.
        edgeType: e.type,
        props: e.properties,
      },
    })
  })
}
