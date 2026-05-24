import { client } from '../client'

// queryRunner — typed wrapper around the generated POST /api/v1/query
// client method. Procedures like `geode.rls.add_deny_policy` are NOT
// exposed as discrete REST endpoints; we call them with
//
//   CALL <proc>('arg1', 'arg2', ...)
//
// arguments are positional and single-quoted; embedded single quotes
// are doubled (SQL-style escape), matching geode's GQL lexer.

export type Cell = unknown

export interface ProcedureResult {
  columns: string[]
  rows: Array<Record<string, Cell>>
  rowCount: number
  elapsedMs: number
}

export function parseColumns(raw: Array<Record<string, unknown>>): string[] {
  return raw.map((c) => (typeof c?.name === 'string' ? c.name : ''))
}

export function parseRows(
  columns: string[],
  rows: Array<Array<unknown>>
): Array<Record<string, Cell>> {
  return rows.map((row) => {
    const out: Record<string, Cell> = {}
    columns.forEach((col, i) => {
      out[col] = row[i]
    })
    return out
  })
}

export function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

export function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function escapeLiteral(s: string): string {
  // SQL-style: double every single quote. geode's lexer accepts the
  // doubled form as a literal ' character inside the literal.
  return s.replace(/'/g, "''")
}

export async function runProcedure(
  procedure: string,
  args: string[]
): Promise<ProcedureResult> {
  const literalArgs = args.map((a) => `'${escapeLiteral(a)}'`).join(', ')
  const statement = `CALL ${procedure}(${literalArgs})`
  const resp = await client.query({ statement })
  const columns = parseColumns(resp.columns ?? [])
  const rows = parseRows(columns, resp.rows ?? [])
  return {
    columns,
    rows,
    rowCount: resp.row_count ?? rows.length,
    elapsedMs: resp.elapsed_ms ?? 0,
  }
}
