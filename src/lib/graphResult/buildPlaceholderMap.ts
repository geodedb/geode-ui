import type { EdgeBinding, ParsedMatch } from '../matchPattern'
import type { GqlColumnLike, GqlEdge } from '../graphResult'
import { applyParsedMatchLabels } from './applyParsedMatchLabels'

// isNodeShape / isEdgeShape mirror the in-row predicates from the
// orchestrator. Pulled inline here so the helper is self-contained
// and the orchestrator no longer needs to know which row cells are
// nodes vs scalars to compute placeholder labels.
function isNodeShape(v: unknown): boolean {
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
// column literally named "name" (case-insensitive), then falls back
// to the first non-empty stringifiable scalar.
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

// matchEdgeBinding pairs a result edge with the MATCH edge binding
// it most likely came from: trivial when the pattern had a single
// edge, otherwise a unique relationship-type match. Returns null
// when the pairing is ambiguous so the caller falls back to the
// type-agnostic placeholder label.
function matchEdgeBinding(
  bindings: EdgeBinding[],
  type: string
): EdgeBinding | null {
  if (bindings.length === 1) return bindings[0] ?? null
  const t = type.toLowerCase()
  const hits = bindings.filter((b) => (b.type ?? '').toLowerCase() === t)
  return hits.length === 1 ? (hits[0] ?? null) : null
}

// buildPlaceholderMap walks every result row and produces two maps
// keyed by the placeholder endpoint's node ID:
//
//   - placeholderLabels: the row-derived scalar label to render
//     (e.g. the actor's name for a Person whose `p` variable was
//     not returned as a full NODE column).
//   - placeholderTypeLabels: the GQL label the MATCH pattern
//     declared for that variable (e.g. 'Movie' for the `m` in
//     `(p)-[r]->(m:Movie)`). The matrix view groups placeholder
//     endpoints by this label.
//
// Pure: depends only on its arguments. Uses applyParsedMatchLabels
// for the per-row variable-scoped scalar selection when a parsed
// MATCH pattern + matching column count are available.
export function buildPlaceholderMap(
  rows: unknown[][] | undefined,
  columns: GqlColumnLike[],
  edges: GqlEdge[] | undefined,
  realNodeIds: Set<number>,
  parsed: ParsedMatch | null
): {
  placeholderLabels: Map<number, string>
  placeholderTypeLabels: Map<number, string>
} {
  const placeholderLabels = new Map<number, string>()
  const placeholderTypeLabels = new Map<number, string>()
  if (!Array.isArray(rows) || !Array.isArray(edges) || edges.length === 0) {
    return { placeholderLabels, placeholderTypeLabels }
  }
  // Column index -> the MATCH variable it projects from, but only
  // when the parser recovered exactly one entry per result column so
  // the index alignment is trustworthy.
  const colVar: (string | null)[] =
    parsed && parsed.returnColumns.length === columns.length
      ? parsed.returnColumns.map((rc) => rc.varName ?? null)
      : []
  rows.forEach((row) => {
    if (!Array.isArray(row)) return
    const rowNodeIds = new Set<number>()
    const skip = new Set<number>()
    const rowEdges: GqlEdge[] = []
    row.forEach((v, i) => {
      if (isNodeShape(v)) {
        const o = v as { id: number }
        rowNodeIds.add(o.id)
        skip.add(i)
      } else if (isEdgeShape(v)) {
        rowEdges.push(v)
        skip.add(i)
      }
    })
    if (rowEdges.length === 0) return
    const varScalar =
      parsed && colVar.length > 0
        ? applyParsedMatchLabels(row, colVar, parsed, skip)
        : new Map<string, string>()
    const fallback = scalarLabel(row, columns, skip)
    rowEdges.forEach((edge) => {
      const eb = parsed ? matchEdgeBinding(parsed.edges, edge.type) : null
      const assign = (endpoint: number, varName?: string): void => {
        if (realNodeIds.has(endpoint)) return
        if (rowNodeIds.has(endpoint)) return
        if (varName && parsed && !placeholderTypeLabels.has(endpoint)) {
          const typeLabel = parsed.nodes.get(varName)?.label
          if (typeLabel) placeholderTypeLabels.set(endpoint, typeLabel)
        }
        if (placeholderLabels.has(endpoint)) return
        const byVar = varName ? varScalar.get(varName) : undefined
        const label = byVar ?? fallback
        if (label !== null) placeholderLabels.set(endpoint, label)
      }
      assign(edge.start_node, eb?.fromVar)
      assign(edge.end_node, eb?.toVar)
    })
  })
  return { placeholderLabels, placeholderTypeLabels }
}
