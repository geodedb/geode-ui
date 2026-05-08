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

// columns metadata is sourced from the gen client which types it as
// Record<string, unknown>[]; we read .name and .type when present and
// degrade gracefully (fall back to col index) when absent.
export type GqlColumnLike = { name?: unknown; type?: unknown } & Record<
  string,
  unknown
>

export type QueryRespLike = {
  columns?: GqlColumnLike[]
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

function isNodeShape(v: unknown): v is GqlNode {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'number' && Array.isArray(o.labels)
}

function isEdgeShape(v: unknown): v is GqlEdge {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.start_node === 'number' &&
    typeof o.end_node === 'number' &&
    typeof o.id === 'number'
  )
}

// scalarLabel picks the most descriptive value from a row's scalar
// columns to use as a placeholder node's display label. Prefers a
// column literally named "name" (case-insensitive), then falls back to
// the first non-empty stringifiable scalar.
function scalarLabel(
  row: unknown[],
  columns: GqlColumnLike[],
  skipIndices: Set<number>
): string | null {
  let preferred: string | null = null
  let fallback: string | null = null
  row.forEach((v, i) => {
    if (skipIndices.has(i)) return
    if (v === null || v === undefined) return
    if (typeof v === 'object') return
    const s = String(v)
    if (s === '') return
    const rawName = columns[i]?.name
    const colName = typeof rawName === 'string' ? rawName : ''
    if (/^name$/i.test(colName) && preferred === null) {
      preferred = s
    } else if (fallback === null) {
      fallback = s
    }
  })
  return preferred ?? fallback
}

// extractElements builds the Cytoscape element list from a query
// response. It draws:
//
//  1. Every node from graph_summary.nodes — these are full NODE-typed
//     columns the query author returned (e.g. `RETURN m`).
//  2. Every edge from graph_summary.edges — including ACTED_IN-style
//     relationship rows.
//  3. Placeholder nodes for edge endpoints that don't appear in
//     graph_summary.nodes. This happens whenever a query projects a
//     scalar in place of a full node — e.g.
//        MATCH (p:Person)-[r:ACTED_IN]->(m:Movie)
//        RETURN p.name, r, m
//     The edge's start_node is a Person ID but `p` itself was not
//     returned, only `p.name`. Without placeholder synthesis the
//     graph view would render dangling edges with no source node.
//     We correlate each row's edge endpoints with that row's scalar
//     columns and use the first sensible scalar (preferring a column
//     literally named "name") as the placeholder node's display label.
export function extractElements(resp: QueryRespLike): ElementDefinition[] {
  const els: ElementDefinition[] = []
  const summary = resp.graph_summary
  if (!isGraphSummary(summary)) return els
  const nodes = (summary as { nodes?: GqlNode[] }).nodes
  const edges = (summary as { edges?: GqlEdge[] }).edges

  const realNodeIds = new Set<number>()
  if (Array.isArray(nodes)) {
    nodes.forEach((n) => realNodeIds.add(n.id))
  }

  // Build a placeholder ID -> label map by walking rows. We only
  // need to consider IDs referenced by edges that aren't already in
  // realNodeIds; first-seen wins on label so the same Person ID
  // appearing across many rows doesn't keep getting overwritten.
  const placeholderLabels = new Map<number, string>()
  const rows = resp.rows
  const columns = resp.columns ?? []
  if (Array.isArray(rows) && Array.isArray(edges) && edges.length > 0) {
    rows.forEach((row) => {
      if (!Array.isArray(row)) return
      // Identify which columns are NODE/EDGE shaped this row so the
      // scalar-label scan can skip them.
      const rowNodeIds = new Set<number>()
      const skip = new Set<number>()
      const rowEdges: GqlEdge[] = []
      row.forEach((v, i) => {
        if (isNodeShape(v)) {
          rowNodeIds.add(v.id)
          skip.add(i)
        } else if (isEdgeShape(v)) {
          rowEdges.push(v)
          skip.add(i)
        }
      })
      if (rowEdges.length === 0) return
      rowEdges.forEach((edge) => {
        const endpoints = [edge.start_node, edge.end_node]
        endpoints.forEach((endpoint) => {
          if (realNodeIds.has(endpoint)) return
          if (rowNodeIds.has(endpoint)) return
          if (placeholderLabels.has(endpoint)) return
          const label = scalarLabel(row, columns, skip)
          if (label !== null) {
            placeholderLabels.set(endpoint, label)
          }
        })
      })
    })
  }

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

  // Emit placeholder nodes for any edge endpoint that didn't make it
  // into graph_summary.nodes. Without an `id`-keyed entry in the
  // Cytoscape graph, an edge whose source/target points at it would
  // be silently dropped on graph mount, so we always emit a stub
  // even when no scalar label could be inferred.
  if (Array.isArray(edges)) {
    const danglingIds = new Set<number>()
    edges.forEach((e) => {
      if (!realNodeIds.has(e.start_node)) danglingIds.add(e.start_node)
      if (!realNodeIds.has(e.end_node)) danglingIds.add(e.end_node)
    })
    danglingIds.forEach((id) => {
      const label = placeholderLabels.get(id) ?? `#${id}`
      els.push({
        group: 'nodes',
        data: {
          id: String(id),
          label,
          labels: [],
          props: {},
          placeholder: true,
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
          label: e.type,
          props: e.properties,
        },
      })
    })
  }
  return els
}
