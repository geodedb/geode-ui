// GAP-060 Phase 1: pure-function GQL synthesiser for the visual query
// builder. Takes a normalised builder state (starting label, edge
// type + direction, terminal label, projection) and emits a GQL
// string the text editor accepts verbatim.
//
// Why a pure function: the builder UI lives in a side panel; on
// "Apply" we synthesise the statement and SHIP it to the existing
// editor + queryStore plumbing. The synthesiser has no React
// dependency, so a unit test pins the round-trip without touching
// the DOM. A future Phase-2 canvas editor reuses this synthesiser
// for the "drag → emit GQL" path.

export type EdgeDirection = 'out' | 'in' | 'both'

export interface BuilderState {
  /** Active graph — surfaces as `USE GRAPH <name>;` when set. */
  graph?: string
  /** First node label (required). */
  startLabel: string
  /** Optional edge type. Empty / undefined → no relationship. */
  edgeType?: string
  /** Edge direction. Ignored when edgeType is empty. */
  edgeDirection?: EdgeDirection
  /** Terminal node label. Required when edgeType is set. */
  endLabel?: string
  /**
   * Projection — array of identifiers + property paths.
   * Empty array defaults to `RETURN n` (and `RETURN n, m` when an
   * edge is present). Otherwise emitted verbatim.
   */
  projection: string[]
  /** LIMIT N. Omitted when zero or negative. */
  limit?: number
}

const STARTING_ALIAS = 'n'
const ENDING_ALIAS = 'm'
const EDGE_ALIAS = 'r'

function projectionString(state: BuilderState): string {
  if (state.projection.length > 0) {
    return state.projection.join(', ')
  }
  if (state.edgeType) {
    return `${STARTING_ALIAS}, ${EDGE_ALIAS}, ${ENDING_ALIAS}`
  }
  return STARTING_ALIAS
}

function matchClause(state: BuilderState): string {
  const start = `(${STARTING_ALIAS}:${state.startLabel})`
  if (!state.edgeType) return start
  const dir = state.edgeDirection ?? 'out'
  const end = `(${ENDING_ALIAS}:${state.endLabel ?? ''})`
  const edge = `[${EDGE_ALIAS}:${state.edgeType}]`
  if (dir === 'out') return `${start}-${edge}->${end}`
  if (dir === 'in') return `${start}<-${edge}-${end}`
  return `${start}-${edge}-${end}`
}

/**
 * Synthesise a GQL statement from a builder state. The output is
 * always parseable by the text editor — round-trip parsing is
 * exercised by src/components/editor/queryBuilder.test.ts.
 */
export function synthesiseGql(state: BuilderState): string {
  const parts: string[] = []
  if (state.graph) parts.push(`USE GRAPH ${state.graph};`)
  parts.push(`MATCH ${matchClause(state)}`)
  parts.push(`RETURN ${projectionString(state)}`)
  if (state.limit && state.limit > 0) parts.push(`LIMIT ${state.limit}`)
  return parts.join(' ')
}
