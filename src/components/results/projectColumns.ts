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
function kindOf(rows: unknown[][], colIdx: number, declared: string): Kind {
  if (declared && declared.toUpperCase() === 'NODE') return 'node'
  if (declared && declared.toUpperCase() === 'EDGE') return 'edge'
  let resolved: Kind | null = null
  rows.some((row) => {
    const cell = row[colIdx]
    if (cell == null) return false
    if (isNode(cell)) {
      resolved = 'node'
      return true
    }
    if (isEdge(cell)) {
      resolved = 'edge'
      return true
    }
    resolved = 'other'
    return true
  })
  return resolved ?? 'other'
}

function orderedKeys(rows: unknown[][], colIdx: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  rows.forEach((row) => {
    const cell = row[colIdx]
    if (!cell || typeof cell !== 'object') return
    const props = (cell as AnyRecord).properties as AnyRecord | undefined
    if (!props) return
    Object.keys(props).forEach((k) => {
      if (!seen.has(k)) {
        seen.add(k)
        out.push(k)
      }
    })
  })
  return out
}

type Plan =
  | { kind: 'other'; name: string; type: string }
  | { kind: 'node' | 'edge'; name: string; type: string; keys: string[] }

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

  const plan: Plan[] = cols.map((c, i) => {
    const k = kindOf(resp.rows, i, c.type)
    if (k === 'other') return { kind: 'other', name: c.name, type: c.type }
    return {
      kind: k,
      name: c.name,
      type: c.type,
      keys: orderedKeys(resp.rows, i),
    }
  })

  if (plan.every((p) => p.kind === 'other')) {
    return { columns: cols, rows: resp.rows }
  }

  const outCols: Col[] = []
  plan.forEach((p) => {
    if (p.kind === 'node') {
      outCols.push({ name: `${p.name}._labels`, type: 'STRING' })
      p.keys.forEach((k) => outCols.push({ name: `${p.name}.${k}`, type: '' }))
    } else if (p.kind === 'edge') {
      outCols.push({ name: `${p.name}._type`, type: 'STRING' })
      p.keys.forEach((k) => outCols.push({ name: `${p.name}.${k}`, type: '' }))
    } else {
      outCols.push({ name: p.name, type: p.type })
    }
  })

  const outRows: unknown[][] = resp.rows.map((row) => {
    const out: unknown[] = []
    plan.forEach((p, i) => {
      const cell = row[i]
      if (p.kind === 'node') {
        if (cell && typeof cell === 'object') {
          const r = cell as AnyRecord
          const labels = (r.labels as string[]) || []
          out.push(labels.join(':'))
          const props = (r.properties as AnyRecord) || {}
          p.keys.forEach((k) => {
            out.push(
              Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null
            )
          })
        } else {
          out.push(null)
          p.keys.forEach(() => out.push(null))
        }
      } else if (p.kind === 'edge') {
        if (cell && typeof cell === 'object') {
          const r = cell as AnyRecord
          out.push(r.type as string)
          const props = (r.properties as AnyRecord) || {}
          p.keys.forEach((k) => {
            out.push(
              Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null
            )
          })
        } else {
          out.push(null)
          p.keys.forEach(() => out.push(null))
        }
      } else {
        out.push(cell)
      }
    })
    return out
  })

  return { columns: outCols, rows: outRows }
}
