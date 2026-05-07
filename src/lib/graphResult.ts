import type { ElementDefinition } from 'cytoscape'

export type GqlNode = {
  id: number
  labels: string[]
  properties: Record<string, unknown>
}

export type GqlEdge = {
  id: number
  start_node: number
  end_node: number
  type: string
  properties: Record<string, unknown>
}

export type QueryRespLike = {
  rows?: unknown[][]
  graph_summary?:
    | { nodes?: GqlNode[]; edges?: GqlEdge[] }
    | Record<string, unknown>
}

function isGraphSummary(
  s: unknown
): s is { nodes?: GqlNode[]; edges?: GqlEdge[] } {
  return typeof s === 'object' && s !== null
}

export function extractElements(resp: QueryRespLike): ElementDefinition[] {
  const els: ElementDefinition[] = []
  const summary = resp.graph_summary
  if (!isGraphSummary(summary)) return els
  const nodes = (summary as { nodes?: GqlNode[] }).nodes
  const edges = (summary as { edges?: GqlEdge[] }).edges
  if (Array.isArray(nodes)) {
    nodes.forEach((n) => {
      els.push({
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
  if (Array.isArray(edges)) {
    edges.forEach((e) => {
      els.push({
        group: 'edges',
        data: {
          id: `e${e.id}`,
          source: String(e.start_node),
          target: String(e.end_node),
          type: e.type,
          props: e.properties,
        },
      })
    })
  }
  return els
}
