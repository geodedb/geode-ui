import type { ElementDefinition } from 'cytoscape'
import {
  EdgeBinding,
  NodeBinding,
  ParsedMatch,
  parseMatchAndReturn,
} from './matchPattern'

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
//  4. Fully synthetic nodes + edges from a scalar-only RETURN
//     (e.g. `RETURN p.name, r.roles, m.title`) when a `query` arg
//     is supplied. The query's MATCH pattern provides labels +
//     edge types + endpoints; columns are mapped to (var, field)
//     by parsing the RETURN expression list.
export function extractElements(
  resp: QueryRespLike,
  query?: string
): ElementDefinition[] {
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

  // Synthesise from the MATCH pattern when:
  //   (a) the caller passed a query string, AND
  //   (b) graph_summary is empty (or doesn't carry edges) AND
  //   (c) at least one returned column is a `var.field` reference
  //       to a node/edge variable defined in the MATCH.
  // This covers the all-scalars case the user reported, where Geode
  // emits no graph_summary entries because nothing of NODE/EDGE
  // type was projected.
  const haveReal =
    (Array.isArray(nodes) && nodes.length > 0) ||
    (Array.isArray(edges) && edges.length > 0)
  if (!haveReal && query && Array.isArray(rows) && rows.length > 0) {
    pushSynthesised(els, parseMatchAndReturn(query), rows)
  }
  return els
}

function pushSynthesised(
  out: ElementDefinition[],
  parsed: ParsedMatch,
  rows: unknown[][]
): void {
  if (parsed.nodes.size === 0 && parsed.edges.length === 0) return
  // Build a column-index → (var, field) map from the RETURN list.
  // Geode auto-aliases `p.name` to a column named `name`, so the
  // RETURN expression order is the only reliable mapping.
  type ColBind = { varName: string; field: string }
  const colBindings: (ColBind | null)[] = parsed.returnColumns.map((rc) => {
    if (rc.varName && rc.field) return { varName: rc.varName, field: rc.field }
    return null
  })

  // For each row, gather per-variable {field: value}.
  // Dedup across rows: a Person `p` whose name is "Keanu Reeves"
  // appears once even when ten ACTED_IN edges originate from it.
  // We key the synthetic node id by (varName, identityProp:value).
  //   - identityProp prefers a field literally named `id`, then the
  //     first field projected for that variable, alphabetically by
  //     field name, so the key is stable across columns ordered
  //     differently.
  type SyntheticNode = {
    nodeId: string
    binding: NodeBinding
    props: Record<string, unknown>
    label: string
  }
  const synthNodes = new Map<string, SyntheticNode>()
  // Track per-row var → nodeId so edges reference the right side.
  const rowVarToNodeId: Map<string, string>[] = []
  rows.forEach((row) => {
    const varProps = new Map<string, Record<string, unknown>>()
    row.forEach((value, idx) => {
      const cb = colBindings[idx]
      if (!cb) return
      let entry = varProps.get(cb.varName)
      if (!entry) {
        entry = {}
        varProps.set(cb.varName, entry)
      }
      entry[cb.field] = value
    })
    const thisRow = new Map<string, string>()
    parsed.nodes.forEach((binding, varName) => {
      const props = varProps.get(varName)
      if (!props) return
      const identity = identityValue(props)
      if (identity === null) return
      const nodeId = `${varName}:${identity}`
      thisRow.set(varName, nodeId)
      const existing = synthNodes.get(nodeId)
      if (existing) {
        // Merge props from this row (later rows fill in missing
        // fields, never overwrite values already known — keeps the
        // graph stable across row order).
        Object.entries(props).forEach(([k, v]) => {
          if (existing.props[k] === undefined) existing.props[k] = v
        })
      } else {
        const labelChoice = chooseLabelText(binding, props)
        synthNodes.set(nodeId, {
          nodeId,
          binding,
          props: { ...props },
          label: labelChoice,
        })
      }
    })
    rowVarToNodeId.push(thisRow)
  })

  synthNodes.forEach((sn) => {
    const labels = sn.binding.label ? [sn.binding.label] : []
    out.push({
      group: 'nodes',
      data: {
        id: sn.nodeId,
        label: sn.label,
        labels,
        props: sn.props,
        synthesised: true,
      },
    })
  })

  // Edges: one per (row, edgeBinding). Synthetic, so we mint ids
  // from row index + binding name to keep them unique.
  rows.forEach((row, rowIdx) => {
    const thisRow = rowVarToNodeId[rowIdx]
    if (!thisRow) return
    const varProps = new Map<string, Record<string, unknown>>()
    row.forEach((value, idx) => {
      const cb = colBindings[idx]
      if (!cb) return
      let entry = varProps.get(cb.varName)
      if (!entry) {
        entry = {}
        varProps.set(cb.varName, entry)
      }
      entry[cb.field] = value
    })
    parsed.edges.forEach((eb, eIdx) => {
      const fromId = thisRow.get(eb.fromVar)
      const toId = thisRow.get(eb.toVar)
      if (!fromId || !toId) return
      const props = (eb.varName && varProps.get(eb.varName)) || {}
      const labelText = chooseEdgeLabel(eb, props)
      out.push({
        group: 'edges',
        data: {
          id: `synth-r${rowIdx}-${eIdx}`,
          source: fromId,
          target: toId,
          type: eb.type ?? 'REL',
          label: labelText,
          props,
          synthesised: true,
        },
      })
    })
  })
}

function identityValue(props: Record<string, unknown>): string | null {
  const keys = Object.keys(props).sort()
  if (keys.length === 0) return null
  const idKey = keys.find((k) => /^id$/i.test(k)) ?? keys[0]
  if (idKey === undefined) return null
  const v = props[idKey]
  if (v === null || v === undefined) return null
  return String(v)
}

function chooseLabelText(
  binding: NodeBinding,
  props: Record<string, unknown>
): string {
  const named = props.name ?? props.title ?? props.id
  if (named !== undefined && named !== null && named !== '') {
    return String(named)
  }
  const keys = Object.keys(props).sort()
  const found = keys
    .map((k) => props[k])
    .find((v) => v !== undefined && v !== null && v !== '')
  if (found !== undefined) return String(found)
  return binding.label || binding.varName
}

function chooseEdgeLabel(
  binding: EdgeBinding,
  props: Record<string, unknown>
): string {
  // For synthesised edges the user has often projected exactly one
  // edge property (e.g. `r.roles`). Show it as the default — it
  // matches what they typed in RETURN. The Display-panel selector
  // can override later via resolveEdgeLabel.
  const keys = Object.keys(props)
  if (keys.length === 1) {
    const v = props[keys[0]!]
    if (v !== undefined && v !== null && v !== '') return String(v)
  }
  return binding.type ?? 'REL'
}

// ----- per-label / per-type display-property selection -----
//
// The graph view defaults to showing each node's first label
// ("Movie") and each edge's relationship type ("ACTED_IN"). Users
// often want a property instead — `title` for movies, `roles` on
// edges, etc. The UI exposes a selector per label / per type;
// these helpers compute the available options from the rendered
// element set and resolve the chosen key against an individual
// element's data.

const LABEL_DEFAULT = '__label__'
const TYPE_DEFAULT = '__type__'

export type DisplayKey = string // either a property key or the sentinel

// labelOptions returns, for each distinct node label seen in els,
// the union of property keys present on nodes of that label, plus
// the LABEL_DEFAULT sentinel meaning "show the label name itself".
// Placeholder (synthesised) nodes carry an empty labels array and
// no props; they're surfaced under a synthetic '' key so the user
// can still pick what scalar to show, but in practice they always
// already carry the row-derived label so the dropdown is rarely
// useful for them.
export function labelOptions(els: ElementDefinition[]): Map<string, string[]> {
  const out = new Map<string, Set<string>>()
  els.forEach((el) => {
    if (el.group !== 'nodes') return
    const data = el.data as Record<string, unknown>
    const labels = Array.isArray(data.labels) ? (data.labels as string[]) : []
    const labelKey = labels[0] ?? ''
    const set = out.get(labelKey) ?? new Set<string>()
    set.add(LABEL_DEFAULT)
    const props = (data.props as Record<string, unknown>) ?? {}
    Object.keys(props).forEach((k) => set.add(k))
    out.set(labelKey, set)
  })
  const sorted = new Map<string, string[]>()
  out.forEach((set, k) => {
    sorted.set(
      k,
      Array.from(set).sort((a, b) => {
        if (a === LABEL_DEFAULT) return -1
        if (b === LABEL_DEFAULT) return 1
        return a.localeCompare(b)
      })
    )
  })
  return sorted
}

// typeOptions does the same for edges, keyed by edge type. The
// TYPE_DEFAULT sentinel ("show the type name") is always first.
export function typeOptions(els: ElementDefinition[]): Map<string, string[]> {
  const out = new Map<string, Set<string>>()
  els.forEach((el) => {
    if (el.group !== 'edges') return
    const data = el.data as Record<string, unknown>
    const t = String(data.type ?? '')
    const set = out.get(t) ?? new Set<string>()
    set.add(TYPE_DEFAULT)
    const props = (data.props as Record<string, unknown>) ?? {}
    Object.keys(props).forEach((k) => set.add(k))
    out.set(t, set)
  })
  const sorted = new Map<string, string[]>()
  out.forEach((set, k) => {
    sorted.set(
      k,
      Array.from(set).sort((a, b) => {
        if (a === TYPE_DEFAULT) return -1
        if (b === TYPE_DEFAULT) return 1
        return a.localeCompare(b)
      })
    )
  })
  return sorted
}

// resolveNodeLabel decides what string to show on a node given the
// caller's per-label preference map. Falls back to the label name
// (or whatever `data.label` already carries — important for
// synthesised placeholder nodes where labels[0] is undefined and
// data.label was set from a row scalar).
export function resolveNodeLabel(
  data: Record<string, unknown>,
  prefs: Record<string, DisplayKey>
): string {
  const labels = Array.isArray(data.labels) ? (data.labels as string[]) : []
  const labelKey = labels[0] ?? ''
  const pref = prefs[labelKey]
  const props = (data.props as Record<string, unknown>) ?? {}
  if (pref && pref !== LABEL_DEFAULT) {
    const v = props[pref]
    if (v !== undefined && v !== null && v !== '') return String(v)
  }
  // Fall back to whatever the original `label` was — for placeholders
  // this is the row-derived scalar; for real nodes, the label name.
  if (typeof data.label === 'string' && data.label !== '') return data.label
  return labelKey || 'Node'
}

// resolveEdgeLabel does the same for an edge.
export function resolveEdgeLabel(
  data: Record<string, unknown>,
  prefs: Record<string, DisplayKey>
): string {
  const t = String(data.type ?? '')
  const pref = prefs[t]
  const props = (data.props as Record<string, unknown>) ?? {}
  if (pref && pref !== TYPE_DEFAULT) {
    const v = props[pref]
    if (v !== undefined && v !== null && v !== '') return String(v)
  }
  return t
}

export const NODE_LABEL_DEFAULT = LABEL_DEFAULT
export const EDGE_TYPE_DEFAULT = TYPE_DEFAULT
