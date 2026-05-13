// Configurable builder for the 1-hop "expand neighbours" GQL statement.
//
// The simple form `buildExpandStatement({ id })` produces the same
// undirected statement the original `buildExploreStatement` emitted, so
// existing callers keep their byte-for-byte behavior. Additional
// options (direction, labelFilter, limit) drive the expand-popover UX
// added in Phase 3.
//
// Inputs are validated defensively: ids must be numeric (Geode's `id()`
// predicate expects integers) and the optional label filter must be a
// valid identifier so it can't be used to smuggle additional clauses
// into the statement.

export type ExpandDirection = 'both' | 'in' | 'out'

export type ExpandStatementInput = {
  id: string
  direction?: ExpandDirection
  labelFilter?: string
  limit?: number
}

const ID_RE = /^\d+$/
const LABEL_RE = /^[A-Za-z_][\w]*$/

const MIN_LIMIT = 1
const MAX_LIMIT = 10000
const DEFAULT_LIMIT = 100

function arrow(dir: ExpandDirection): { left: string; right: string } {
  if (dir === 'in') return { left: '<-', right: '-' }
  if (dir === 'out') return { left: '-', right: '->' }
  return { left: '-', right: '-' }
}

function clampLimit(n: number | undefined): number {
  if (!Number.isFinite(n as number)) return DEFAULT_LIMIT
  const v = Math.trunc(n as number)
  if (v < MIN_LIMIT) return MIN_LIMIT
  if (v > MAX_LIMIT) return MAX_LIMIT
  return v
}

export function buildExpandStatement(input: ExpandStatementInput): string {
  if (!ID_RE.test(input.id)) {
    throw new Error(`Expand: invalid node id ${input.id}`)
  }
  const dir = input.direction ?? 'both'
  const { left, right } = arrow(dir)
  let mPart = '(m)'
  if (input.labelFilter) {
    if (!LABEL_RE.test(input.labelFilter)) {
      throw new Error(`Expand: invalid label filter ${input.labelFilter}`)
    }
    mPart = `(m:${input.labelFilter})`
  }
  const limit = clampLimit(input.limit)
  return `MATCH (n)${left}[r]${right}${mPart} WHERE id(n) = ${input.id} RETURN n, r, m LIMIT ${limit};`
}
