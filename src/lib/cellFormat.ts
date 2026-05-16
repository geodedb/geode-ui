/**
 * Cell-level formatting helpers for the table renderer.
 *
 * Extracted from src/components/results/TableView.tsx as part of
 * Q rank 19 / #184 -- the original 605+ LOC file mixed cell formatting,
 * sizing, virtualizer config, and rendering in one module. Pulling the
 * pure (non-React) formatting logic out gives:
 *
 *   - direct unit testability without rendering a styled <table>;
 *   - reuse by any non-TableView consumer that wants the same Cypher-
 *     style cell-text rendering (e.g. graph inspector, NDJSON exporter
 *     side-views, the future flattened-csv export);
 *   - smaller TableView.tsx so the remaining file is rendering +
 *     virtualizer config only.
 *
 * Backwards compatibility: TableView.tsx re-exports `formatCell` from
 * this module under the same name, so existing tests + imports stay
 * green without changes.
 */

import { formatPropValue } from '../components/results/propFormat'

// Graph result types come back as plain JSON objects with the
// canonical {id, labels, properties} (node), {id, start_node,
// end_node, type, properties} (edge), or {nodes[], edges[]} (path)
// shape -- see gen/types/types.gen.go and the geode-client-go
// conversion in rows.go:118-138. We render them in a Cypher-like
// notation so the table is readable, falling back to JSON for any
// other object.
export type AnyRecord = Record<string, unknown>

export function isNode(o: AnyRecord): boolean {
  return (
    typeof o.id !== 'undefined' &&
    Array.isArray(o.labels) &&
    typeof o.properties === 'object' &&
    o.properties !== null &&
    typeof (o as AnyRecord).start_node === 'undefined'
  )
}

export function isEdge(o: AnyRecord): boolean {
  return (
    typeof o.id !== 'undefined' &&
    typeof o.start_node !== 'undefined' &&
    typeof o.end_node !== 'undefined' &&
    typeof o.type === 'string'
  )
}

export function isPath(o: AnyRecord): boolean {
  return Array.isArray(o.nodes) && Array.isArray(o.edges)
}

// summarizeProps renders ALL keys of a node/edge property bag in a
// cypher-like " {k: v, ...}" form. We deliberately do NOT truncate --
// the previous "first 2 props + ..." form was unhelpful for admin
// views where the interesting fields (username, email, roles)
// routinely landed past the cap. Cell-level wrapping (white-space:
// pre-wrap on the cell) keeps the row readable when the property bag
// is large.
export function summarizeProps(props: AnyRecord): string {
  const keys = Object.keys(props)
  if (keys.length === 0) return ''
  const pairs = keys.map((k) => `${k}: ${formatPropValue(props[k])}`)
  return ` {${pairs.join(', ')}}`
}

export function formatNode(o: AnyRecord): string {
  const labels = (o.labels as string[]).map((l) => `:${l}`).join('')
  return `(${labels}${summarizeProps(o.properties as AnyRecord)})`
}

export function formatEdge(o: AnyRecord): string {
  return `[:${o.type as string}${summarizeProps(o.properties as AnyRecord)}]`
}

export function formatPath(o: AnyRecord): string {
  const n = (o.nodes as unknown[]).length
  const e = (o.edges as unknown[]).length
  return `<path: ${n} nodes, ${e} edges>`
}

/**
 * formatCell turns any cell value into a Cypher-style human-readable
 * string for the tabular renderer. Used by every cell in TableView
 * and by the row-height estimator (which works off the rendered
 * string length).
 *
 *  - null / undefined       -> "" (empty cell)
 *  - arrays / generic objs  -> JSON.stringify
 *  - node-shaped objects    -> "(:Label {k: v, ...})"
 *  - edge-shaped objects    -> "[:TYPE {k: v, ...}]"
 *  - path-shaped objects    -> "<path: N nodes, M edges>"
 *  - everything else        -> String(v)
 */
export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return JSON.stringify(v)
  if (typeof v === 'object') {
    const o = v as AnyRecord
    if (isNode(o)) return formatNode(o)
    if (isEdge(o)) return formatEdge(o)
    if (isPath(o)) return formatPath(o)
    return JSON.stringify(o)
  }
  return String(v)
}
