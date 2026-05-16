// projectColumns turns a graph-aware QueryResp into a flat tabular shape.
//
// - For each NODE column, emit `{name}._labels` followed by one
//   `{name}.{key}` column for every property key found across all
//   rows (preserving first-seen order). Cells become the corresponding
//   property value (or null when absent / the original cell was null).
// - For each EDGE column, emit `{name}._type` followed by one
//   `{name}.{key}` column per edge property key.
// - Other columns (paths, scalars, unknown objects) pass through
//   unchanged in their original positions.
//
// Returns the original shape verbatim if no row contains a node or
// edge — projection only fires when there's something to project.
//
// PERF history:
//
//   F6 (#26): previous impl made 3 separate passes per node/edge
//   column (kindOf + orderedKeys + final project). Replaced with a
//   2-pass shape: discoverPlan per column, then a single materialise
//   walk. Total work: ~2 * rows * cols.
//
//   F7 (#51): collapse the per-column discovery walks into a single
//   row-major sweep so we visit each row exactly once during
//   inference. Materialisation still walks once. Total walks over
//   the input row set drops from N+1 (one per node/edge column, plus
//   the materialise walk) to exactly 2 regardless of column count.

export type Col = { name: string; type: string }
export type ProjResp = {
  columns: Col[]
  rows: unknown[][]
  /**
   * PERF #236 + #234c (#236, #234): present when the projection collapsed
   * columns or capped rows. Surfaced to the UI so it can render a "+N more"
   * disclosure and a "download full result as NDJSON" affordance.
   */
  overflow?: {
    columnsHidden: number // columns dropped beyond DEFAULT_COLUMN_BUDGET
    rowsHidden: number // rows beyond DEFAULT_ROW_DISPLAY_CAP
    totalRows: number // unfiltered row count
    totalColumns: number // unfiltered column count
  }
}

/**
 * DEFAULT_COLUMN_BUDGET caps the number of materialised property columns
 * a single projection emits (PERF #236 / #236). When a graph node/edge
 * has many distinct property keys (e.g. heterogeneous JSON blobs), the
 * unbounded code path could materialise thousands of columns and pay
 * O(rows × keys) per WebSocket batch.
 *
 * 64 columns is generous: a typical Geode result has 1-3 columns and
 * dozens of property keys at most. The remaining columns are reported
 * via `overflow.columnsHidden` and the UI surfaces them under a
 * "+N more" disclosure plus an NDJSON export affordance.
 *
 * This is the planner's sensible default per the gap-close authorization;
 * operators can override at call-time with `projectColumns(resp, { columnBudget })`.
 */
export const DEFAULT_COLUMN_BUDGET = 64

/**
 * DEFAULT_ROW_DISPLAY_CAP caps the number of rows the projection
 * materialises for the table renderer (PERF #234c). Beyond this the
 * UI shows the cap warning + an NDJSON export of the full set.
 */
export const DEFAULT_ROW_DISPLAY_CAP = 5000

export type ProjectColumnsOpts = {
  columnBudget?: number
  rowDisplayCap?: number
}

type AnyRecord = Record<string, unknown>

function isNode(o: unknown): o is AnyRecord {
  if (!o || typeof o !== 'object') return false
  const r = o as AnyRecord
  return (
    typeof r.id !== 'undefined' &&
    Array.isArray(r.labels) &&
    typeof r.properties === 'object' &&
    r.properties !== null &&
    typeof r.start_node === 'undefined'
  )
}

function isEdge(o: unknown): o is AnyRecord {
  if (!o || typeof o !== 'object') return false
  const r = o as AnyRecord
  return (
    typeof r.id !== 'undefined' &&
    typeof r.start_node !== 'undefined' &&
    typeof r.end_node !== 'undefined' &&
    typeof r.type === 'string'
  )
}

type Kind = 'node' | 'edge' | 'other'

type Plan =
  | { kind: 'other'; name: string; type: string }
  | { kind: 'node' | 'edge'; name: string; type: string; keys: string[] }

// PlanState is the per-column accumulator used during the single row
// sweep. It carries the running kind (resolved from declared type or
// the first non-null cell shape) plus the first-seen-property-key
// order. Once every row has been visited we freeze each accumulator
// into a Plan.
type PlanState = {
  name: string
  declaredType: string
  kind: Kind | null
  seen: Set<string>
  keys: string[]
}

export function projectColumns(
  resp: {
    columns: Array<{ name: string; type: string } | Record<string, unknown>>
    rows: unknown[][]
  },
  opts: ProjectColumnsOpts = {}
): ProjResp {
  const columnBudget = opts.columnBudget ?? DEFAULT_COLUMN_BUDGET
  const rowDisplayCap = opts.rowDisplayCap ?? DEFAULT_ROW_DISPLAY_CAP
  const cols: Col[] = resp.columns.map((c) => {
    const r = c as AnyRecord
    return {
      name: typeof r.name === 'string' ? r.name : '',
      type: typeof r.type === 'string' ? r.type : '',
    }
  })

  // Seed each column's PlanState. Declared NODE/EDGE types win
  // immediately so an empty row set still emits the structural
  // column (`{name}._labels` / `{name}._type`).
  const states: PlanState[] = new Array(cols.length)
  for (let i = 0; i < cols.length; i += 1) {
    const col = cols[i] as Col
    const declared = col.type ? col.type.toUpperCase() : ''
    let kind: Kind | null = null
    if (declared === 'NODE') kind = 'node'
    else if (declared === 'EDGE') kind = 'edge'
    states[i] = {
      name: col.name,
      declaredType: col.type,
      kind,
      seen: new Set<string>(),
      keys: [],
    }
  }

  // F7 single-pass inference: ONE row-major sweep updates every
  // column's PlanState in lockstep. Columns whose kind has resolved
  // to 'other' early-exit per cell so we don't pay the property-key
  // discovery cost on pure scalar columns.
  for (let r = 0; r < resp.rows.length; r += 1) {
    const row = resp.rows[r]
    if (row) {
      for (let i = 0; i < states.length; i += 1) {
        const st = states[i] as PlanState
        if (st.kind !== 'other') {
          const cell = row[i]
          if (cell != null) {
            if (st.kind === null) {
              if (isNode(cell)) st.kind = 'node'
              else if (isEdge(cell)) st.kind = 'edge'
              else st.kind = 'other'
            }
            if (st.kind === 'node' || st.kind === 'edge') {
              const props = (cell as AnyRecord).properties as
                | AnyRecord
                | undefined
              if (props) {
                const propKeys = Object.keys(props)
                for (let k = 0; k < propKeys.length; k += 1) {
                  const key = propKeys[k] as string
                  if (!st.seen.has(key)) {
                    st.seen.add(key)
                    st.keys.push(key)
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Freeze each PlanState into the immutable Plan shape the
  // materialiser consumes. An unresolved kind (no non-null cell
  // ever seen) collapses to 'other'.
  const plan: Plan[] = new Array(states.length)
  for (let i = 0; i < states.length; i += 1) {
    const st = states[i] as PlanState
    const kind = st.kind ?? 'other'
    if (kind === 'other') {
      plan[i] = { kind: 'other', name: st.name, type: st.declaredType }
    } else {
      plan[i] = { kind, name: st.name, type: st.declaredType, keys: st.keys }
    }
  }

  // PERF #234c (#234): row display cap. The cap is OFF when
  // rowDisplayCap <= 0 (callers that pass 0 want the full set —
  // export paths, tests).
  const totalRows = resp.rows.length
  const rowsHidden =
    rowDisplayCap > 0 && totalRows > rowDisplayCap
      ? totalRows - rowDisplayCap
      : 0
  const rowsForDisplay =
    rowsHidden > 0 ? resp.rows.slice(0, rowDisplayCap) : resp.rows

  if (plan.every((p) => p.kind === 'other')) {
    const out: ProjResp = { columns: cols, rows: rowsForDisplay }
    if (rowsHidden > 0) {
      out.overflow = {
        columnsHidden: 0,
        rowsHidden,
        totalRows,
        totalColumns: cols.length,
      }
    }
    return out
  }

  // PERF #236 (#236): per-plan column budget. Walk each NODE/EDGE
  // plan and trim its `keys` slice so the total emitted columns stay
  // within columnBudget. The budget is distributed proportionally:
  // every projection always keeps the structural `_labels` / `_type`
  // column AND at least one property key. Excess keys are reported
  // via overflow.columnsHidden so the UI can render a "+N more" cue.
  //
  // When columnBudget <= 0 (off) all keys flow through.
  let totalColumnsBeforeBudget = 0
  for (let i = 0; i < plan.length; i += 1) {
    const p = plan[i] as Plan
    if (p.kind === 'node' || p.kind === 'edge') {
      totalColumnsBeforeBudget += 1 + p.keys.length
    } else {
      totalColumnsBeforeBudget += 1
    }
  }
  let columnsHidden = 0
  if (columnBudget > 0 && totalColumnsBeforeBudget > columnBudget) {
    // Reserve one column per plan (scalar OR structural _labels/_type).
    const reserved = plan.length
    let propertyBudget = Math.max(0, columnBudget - reserved)
    // Distribute the property budget round-robin across node/edge
    // plans so a single high-cardinality node doesn't starve the
    // others.
    const nodeEdgePlans: Plan[] = []
    for (let i = 0; i < plan.length; i += 1) {
      const p = plan[i] as Plan
      if (p.kind === 'node' || p.kind === 'edge') {
        nodeEdgePlans.push(p)
      }
    }
    if (nodeEdgePlans.length > 0) {
      // Cap each plan's keys at propertyBudget/N (rounded up), but
      // never below 1 so the disclosure UX always shows at least one
      // key (the "+N more" cue is more useful than zero columns).
      const perPlan = Math.max(
        1,
        Math.ceil(propertyBudget / nodeEdgePlans.length)
      )
      for (let i = 0; i < nodeEdgePlans.length; i += 1) {
        const p = nodeEdgePlans[i] as Plan
        if (
          (p.kind === 'node' || p.kind === 'edge') &&
          p.keys.length > perPlan
        ) {
          columnsHidden += p.keys.length - perPlan
          const mutable = p as { keys: string[] }
          mutable.keys = p.keys.slice(0, perPlan)
        }
      }
      propertyBudget -= nodeEdgePlans.reduce(
        (acc, p) =>
          acc + (p.kind === 'node' || p.kind === 'edge' ? p.keys.length : 0),
        0
      )
      // propertyBudget can go negative when a single plan needed >1
      // column even after rounding — that's the floor we accepted
      // above (always at least one key). columnsHidden already
      // reflects the cap.
    }
  }

  const outCols: Col[] = []
  for (let i = 0; i < plan.length; i += 1) {
    const p = plan[i] as Plan
    if (p.kind === 'node') {
      outCols.push({ name: `${p.name}._labels`, type: 'STRING' })
      for (let k = 0; k < p.keys.length; k += 1) {
        outCols.push({ name: `${p.name}.${p.keys[k]}`, type: '' })
      }
    } else if (p.kind === 'edge') {
      outCols.push({ name: `${p.name}._type`, type: 'STRING' })
      for (let k = 0; k < p.keys.length; k += 1) {
        outCols.push({ name: `${p.name}.${p.keys[k]}`, type: '' })
      }
    } else {
      outCols.push({ name: p.name, type: p.type })
    }
  }

  const outRows: unknown[][] = new Array(rowsForDisplay.length)
  for (let r = 0; r < rowsForDisplay.length; r += 1) {
    const row = rowsForDisplay[r] as unknown[]
    const out: unknown[] = []
    for (let i = 0; i < plan.length; i += 1) {
      const p = plan[i] as Plan
      const cell = row[i]
      if (p.kind === 'node') {
        if (cell && typeof cell === 'object') {
          const rec = cell as AnyRecord
          const labels = (rec.labels as string[]) || []
          out.push(labels.join(':'))
          const props = (rec.properties as AnyRecord) || {}
          for (let k = 0; k < p.keys.length; k += 1) {
            const key = p.keys[k] as string
            out.push(
              Object.prototype.hasOwnProperty.call(props, key)
                ? props[key]
                : null
            )
          }
        } else {
          out.push(null)
          for (let k = 0; k < p.keys.length; k += 1) out.push(null)
        }
      } else if (p.kind === 'edge') {
        if (cell && typeof cell === 'object') {
          const rec = cell as AnyRecord
          out.push(rec.type as string)
          const props = (rec.properties as AnyRecord) || {}
          for (let k = 0; k < p.keys.length; k += 1) {
            const key = p.keys[k] as string
            out.push(
              Object.prototype.hasOwnProperty.call(props, key)
                ? props[key]
                : null
            )
          }
        } else {
          out.push(null)
          for (let k = 0; k < p.keys.length; k += 1) out.push(null)
        }
      } else {
        out.push(cell)
      }
    }
    outRows[r] = out
  }

  const out: ProjResp = { columns: outCols, rows: outRows }
  if (columnsHidden > 0 || rowsHidden > 0) {
    out.overflow = {
      columnsHidden,
      rowsHidden,
      totalRows,
      totalColumns: totalColumnsBeforeBudget,
    }
  }
  return out
}
