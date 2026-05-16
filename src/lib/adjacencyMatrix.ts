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

// Sensible default for MatrixView label budget (per dimension) — beyond
// ~60 labels the rendered DOM table approaches 3.6k cells, which is the
// inflection point where layout / scroll work starts to dominate the
// frame budget on commodity hardware. Callers can override the budget
// for tests or future tuning. See PERF #216.
export const DEFAULT_MATRIX_LABEL_BUDGET = 60

export type MatrixBudgetResult = {
  // Sorted labels kept under the budget (by descending total edge count
  // touching the label, with stable alpha order as the tiebreaker). For
  // matrices with `labels.length <= budget`, this is just `labels` in
  // alpha order — no overflow.
  labels: string[]
  // Labels dropped from the rendered table. Empty when no overflow.
  hiddenLabels: string[]
  // Total edges in the input matrix that are NOT covered by `labels`
  // (every cell where row or col is hidden). Useful for surfacing
  // "+N more" disclosure with an accurate dropped-edge count.
  hiddenEdges: number
}

/**
 * applyMatrixBudget caps a matrix to `budget` rows/cols (per dimension)
 * by total-edge-degree. Labels are ranked by how many edges touch them
 * (sum of cell counts where the label is the row OR the column), so the
 * densest part of the heatmap is what survives the cap. Ties break on
 * alpha order. The returned `labels` array is alpha-sorted (so the
 * DOM render order matches the un-budgeted path), and `hiddenLabels`
 * is alpha-sorted too — UI surfaces want a stable display order, not
 * a degree-ranked one.
 *
 * Budget semantics:
 *   - `budget <= 0` disables the cap (returns labels unchanged).
 *   - `budget >= labels.length` is a no-op (no overflow).
 *   - Otherwise the top-`budget` labels by degree win.
 *
 * Skipping zero-intensity cells from the DOM is the consumer's job
 * (MatrixView reads cell counts via matrix.cells.get(...) and renders
 * `null` when count is 0 / undefined — see PERF #216). This helper only
 * controls which row/col labels are eligible to be rendered.
 */
export function applyMatrixBudget(
  matrix: AdjacencyMatrix,
  budget: number = DEFAULT_MATRIX_LABEL_BUDGET
): MatrixBudgetResult {
  const labels = matrix.labels
  if (budget <= 0 || labels.length <= budget) {
    return { labels: labels.slice(), hiddenLabels: [], hiddenEdges: 0 }
  }
  const degree = new Map<string, number>()
  labels.forEach((lbl) => degree.set(lbl, 0))
  matrix.cells.forEach((cell, key) => {
    const idx = key.indexOf('\0')
    if (idx <= 0) return
    const row = key.slice(0, idx)
    const col = key.slice(idx + 1)
    degree.set(row, (degree.get(row) ?? 0) + cell.count)
    if (col !== row) {
      degree.set(col, (degree.get(col) ?? 0) + cell.count)
    }
  })
  // Stable sort: degree desc, then alpha asc.
  const ranked = labels.slice().sort((a, b) => {
    const da = degree.get(a) ?? 0
    const db = degree.get(b) ?? 0
    if (db !== da) return db - da
    if (a < b) return -1
    if (a > b) return 1
    return 0
  })
  const kept = new Set(ranked.slice(0, budget))
  const keptLabels = labels.filter((l) => kept.has(l))
  const hiddenLabels = labels.filter((l) => !kept.has(l))
  let hiddenEdges = 0
  matrix.cells.forEach((cell, key) => {
    const idx = key.indexOf('\0')
    if (idx <= 0) return
    const row = key.slice(0, idx)
    const col = key.slice(idx + 1)
    if (!kept.has(row) || !kept.has(col)) {
      hiddenEdges += cell.count
    }
  })
  return { labels: keptLabels, hiddenLabels, hiddenEdges }
}
