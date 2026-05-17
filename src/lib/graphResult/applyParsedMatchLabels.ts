import type { ParsedMatch } from '../matchPattern'

// applyParsedMatchLabels harvests the per-row per-variable scalar
// labels that come from the parsed MATCH/RETURN pattern.
//
// For a query like:
//   MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p.name, r, m.title
//
// the parser produces a colVar array `['p', null, 'm']`. Each result
// row's scalar columns are then grouped by the variable they project
// from, so the Person placeholder gets the value of `p.name` and the
// Movie placeholder gets the value of `m.title` -- not whichever
// column happens to be literally named "name".
//
// `skip` is the set of column indices that hold full NODE/EDGE
// objects (not scalars) on this row; those are never used as labels.
//
// Pure: returns a Map<varName, scalarLabel>. Empty when no
// trustworthy column->variable mapping exists.
export function applyParsedMatchLabels(
  row: unknown[],
  colVar: (string | null)[],
  parsed: ParsedMatch,
  skip: Set<number>
): Map<string, string> {
  const out = new Map<string, string>()
  if (colVar.length === 0) return out
  const varFields = new Map<string, Record<string, unknown>>()
  row.forEach((v, i) => {
    if (skip.has(i)) return
    if (v === null || v === undefined || typeof v === 'object') return
    const vn = colVar[i]
    if (!vn) return
    const fld = parsed.returnColumns[i]?.field ?? `c${i}`
    let entry = varFields.get(vn)
    if (!entry) {
      entry = {}
      varFields.set(vn, entry)
    }
    entry[fld] = v
  })
  varFields.forEach((fields, vn) => {
    const picked = pickScalarLabel(fields)
    if (picked !== null) out.set(vn, picked)
  })
  return out
}

// pickScalarLabel mirrors chooseLabelText's preference order -- a
// field literally named name/title/id, else the first non-empty
// stringifiable scalar -- but works on a flat {field: value} map
// (the per-variable projection gathered from one result row).
//
// Re-exported so tests can pin the preference order independently.
export function pickScalarLabel(
  fields: Record<string, unknown>
): string | null {
  const named = fields.name ?? fields.title ?? fields.id
  if (named !== undefined && named !== null && named !== '') {
    return String(named)
  }
  const keys = Object.keys(fields).sort()
  const hit = keys
    .map((k) => fields[k])
    .find((v) => v !== undefined && v !== null && v !== '')
  return hit !== undefined ? String(hit) : null
}
