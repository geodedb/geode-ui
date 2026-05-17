import type { ElementDefinition } from 'cytoscape'
import { parseMatchAndReturn } from './matchPattern'
import { buildPlaceholderMap } from './graphResult/buildPlaceholderMap'
import { collectRealEndpoints } from './graphResult/collectRealEndpoints'
import {
  pushPlaceholderNodes,
  pushRealEdges,
  pushRealNodes,
} from './graphResult/pushRealElements'
import { pushSynthesisedRows } from './graphResult/pushSynthesisedRows'

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
// QUAL #247: the original 181-LOC body is decomposed into focused
// pure helpers under src/lib/graphResult/. The orchestrator below
// only owns the dispatch shape (gate on graph_summary, sequence the
// helpers); everything else lives in its own file with focused unit
// tests.
export function extractElements(
  resp: QueryRespLike,
  query?: string
): ElementDefinition[] {
  const els: ElementDefinition[] = []
  const summary = resp.graph_summary
  if (!isGraphSummary(summary)) return els
  const nodes = (summary as { nodes?: GqlNode[] }).nodes
  const edges = (summary as { edges?: GqlEdge[] }).edges
  const rows = resp.rows
  const columns = resp.columns ?? []
  const parsed = query ? parseMatchAndReturn(query) : null

  const { realNodeIds, danglingIds } = collectRealEndpoints(nodes, edges)
  const { placeholderLabels, placeholderTypeLabels } = buildPlaceholderMap(
    rows,
    columns,
    edges,
    realNodeIds,
    parsed
  )
  pushRealNodes(els, nodes)
  pushPlaceholderNodes(
    els,
    danglingIds,
    placeholderLabels,
    placeholderTypeLabels
  )
  pushRealEdges(els, edges)

  const haveReal =
    (Array.isArray(nodes) && nodes.length > 0) ||
    (Array.isArray(edges) && edges.length > 0)
  if (!haveReal && parsed && Array.isArray(rows) && rows.length > 0) {
    pushSynthesisedRows(els, parsed, rows)
  }
  return els
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

// ----- group-by-label clustering (compound parent nodes) -----

// Prefix for the synthetic per-label "cluster parent" node ids.
export const CLUSTER_PARENT_PREFIX = '__cluster__:'

/**
 * Returns a *copy* of `els` where each node is reparented under a
 * synthetic "cluster parent" node keyed by its primary label, so
 * Cytoscape renders labelled groups. Nodes with no label — or a node
 * that already carries a `data.parent` (caller-set parenting wins) —
 * are returned untouched and do not contribute a cluster parent. Edges
 * are returned unchanged. Pure: does not mutate `els` or any element's
 * `data` bag.
 *
 * extractElements stores a node's labels under `data.labels` (an array;
 * `labels[0]` is the primary). This function mirrors that key — keep it
 * in sync with extractElements if the element shape ever changes.
 */
export function buildCompoundElements(
  els: ElementDefinition[]
): ElementDefinition[] {
  const labelsSeen = new Set<string>()
  const out: ElementDefinition[] = []
  els.forEach((el) => {
    if (el.group === 'edges') {
      out.push(el)
      return
    }
    const data = (el.data ?? {}) as Record<string, unknown>
    const labels = Array.isArray(data.labels) ? (data.labels as string[]) : []
    const primary = labels[0]
    if (!primary || data.parent) {
      out.push(el)
      return
    }
    labelsSeen.add(primary)
    out.push({
      ...el,
      data: { ...data, parent: CLUSTER_PARENT_PREFIX + primary },
    })
  })
  labelsSeen.forEach((label) => {
    out.push({
      group: 'nodes',
      data: { id: CLUSTER_PARENT_PREFIX + label, label, isClusterParent: true },
      selectable: false,
      grabbable: false,
    })
  })
  return out
}
