import type { ElementDefinition } from 'cytoscape'

export type MatrixCell = { count: number; edgeTypes: Record<string, number> }
export type AdjacencyMatrix = {
  labels: string[]
  cells: Map<string, MatrixCell>
}

// NUL — a control character that cannot appear in a graph label, so
// `matrixCellKey("Film Noir", "Movie")` can't collide with
// `matrixCellKey("Film", "Noir Movie")`. Callers only ever round-trip
// keys through matrixCellKey, so the exact separator is an implementation
// detail.
const SEP = '\0'

export function matrixCellKey(row: string, col: string): string {
  return row + SEP + col
}

// nodeLabel returns the primary label of a node element, or null if the
// element is an edge / a synthetic cluster-parent (Phase 1 clustering) /
// a placeholder or dangling-endpoint node (which carry an empty `labels`
// array). extractElements stores a node's labels under `data.labels`
// (an array; `labels[0]` is the primary) — keep this key in sync with
// extractElements in src/lib/graphResult.ts.
function nodeLabel(el: ElementDefinition): string | null {
  if (el.group === 'edges') return null
  const data = (el.data ?? {}) as Record<string, unknown>
  if (data.isClusterParent) return null
  const labels = Array.isArray(data.labels) ? (data.labels as string[]) : []
  return labels[0] ?? null
}

// edgeTypeOf reads the relationship type from an edge's data bag —
// `data.type` (extractElements' canonical key), falling back to
// `data.label` (its mirror), then a generic 'edge'.
function edgeTypeOf(d: Record<string, unknown>): string {
  if (typeof d.type === 'string' && d.type !== '') return d.type
  if (typeof d.label === 'string' && d.label !== '') return d.label
  return 'edge'
}

/**
 * Groups nodes by primary label and counts edges between groups.
 * `cells` is keyed by `matrixCellKey(rowLabel, colLabel)`; missing keys
 * mean 0. Edge direction is honoured (the source node's label is the row,
 * the target node's label is the column). `labels` is the sorted unique
 * set of node labels seen. Synthetic cluster-parent nodes and
 * placeholder / dangling-endpoint nodes (no labels) are excluded — an
 * edge that touches such a node is dropped. Pure: does not mutate `els`
 * or any element's `data` bag.
 *
 * extractElements puts node labels on `data.labels`, edge endpoints on
 * `data.source` / `data.target`, and the relationship type on
 * `data.type` (it also mirrors the type onto `data.label`); we read
 * `data.type` first and fall back to `data.label` if absent.
 */
export function buildAdjacencyMatrix(
  els: ElementDefinition[]
): AdjacencyMatrix {
  const labelById = new Map<string, string>()
  const labelSet = new Set<string>()
  els.forEach((el) => {
    const lbl = nodeLabel(el)
    if (lbl == null) return
    const data = (el.data ?? {}) as { id?: unknown }
    const id = String(data.id ?? '')
    if (!id) return
    labelById.set(id, lbl)
    labelSet.add(lbl)
  })

  const cells = new Map<string, MatrixCell>()
  els.forEach((el) => {
    if (el.group !== 'edges') return
    const d = (el.data ?? {}) as Record<string, unknown>
    const srcId = String(d.source ?? '')
    const tgtId = String(d.target ?? '')
    const rowLabel = labelById.get(srcId)
    const colLabel = labelById.get(tgtId)
    if (!rowLabel || !colLabel) return
    const type = edgeTypeOf(d)
    const key = matrixCellKey(rowLabel, colLabel)
    const existing = cells.get(key)
    const cell: MatrixCell = existing ?? { count: 0, edgeTypes: {} }
    cell.count += 1
    cell.edgeTypes[type] = (cell.edgeTypes[type] ?? 0) + 1
    cells.set(key, cell)
  })

  return { labels: Array.from(labelSet).sort(), cells }
}
