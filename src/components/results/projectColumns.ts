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
// PERF-F6 (issue #26): the previous implementation made three passes
// over `rows` for every node/edge column (kindOf + orderedKeys + the
// final cell projection). For a 1000-row response with several node
// columns that's O(rows*cols*3). The current implementation walks the
// rows exactly once per node/edge column to discover its kind + the
// union of property keys, then walks the rows once more to materialize
// the output table. Net effect: 2x rows*cols of work instead of
// 4x (3 discovery passes + 1 build).

export type Col = { name: string; type: string }
export type ProjResp = { columns: Col[]; rows: unknown[][] }

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

// discoverPlan walks the rows once per column, decides the column kind
// (using the declared type when present, else the first non-null cell's
// shape), and accumulates the first-seen-property-key order. This
// fuses what used to be the kindOf and orderedKeys passes into a
// single sweep so we only walk the row set once per column instead of
// three times.
function discoverPlan(
  rows: unknown[][],
  colIdx: number,
  declaredType: string,
  name: string
): Plan {
  let kind: Kind | null = null
  if (declaredType && declaredType.toUpperCase() === 'NODE') kind = 'node'
  else if (declaredType && declaredType.toUpperCase() === 'EDGE') kind = 'edge'

  const seen = new Set<string>()
  const keys: string[] = []

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const cell = row ? row[colIdx] : null
    if (cell != null) {
      if (kind === null) {
        if (isNode(cell)) kind = 'node'
        else if (isEdge(cell)) kind = 'edge'
        else kind = 'other'
      }

      if (kind !== 'node' && kind !== 'edge') break

      if (typeof cell === 'object') {
        const props = (cell as AnyRecord).properties as AnyRecord | undefined
        if (props) {
          const propKeys = Object.keys(props)
          for (let k = 0; k < propKeys.length; k += 1) {
            const key = propKeys[k] as string
            if (!seen.has(key)) {
              seen.add(key)
              keys.push(key)
            }
          }
        }
      }
    }
  }

  if (kind === null) kind = 'other'
  if (kind === 'other') return { kind: 'other', name, type: declaredType }
  return { kind, name, type: declaredType, keys }
}

export function projectColumns(resp: {
  columns: Array<{ name: string; type: string } | Record<string, unknown>>
  rows: unknown[][]
}): ProjResp {
  const cols: Col[] = resp.columns.map((c) => {
    const r = c as AnyRecord
    return {
      name: typeof r.name === 'string' ? r.name : '',
      type: typeof r.type === 'string' ? r.type : '',
    }
  })

  const plan: Plan[] = cols.map((c, i) =>
    discoverPlan(resp.rows, i, c.type, c.name)
  )

  if (plan.every((p) => p.kind === 'other')) {
    return { columns: cols, rows: resp.rows }
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

  const outRows: unknown[][] = new Array(resp.rows.length)
  for (let r = 0; r < resp.rows.length; r += 1) {
    const row = resp.rows[r] as unknown[]
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

  return { columns: outCols, rows: outRows }
}
