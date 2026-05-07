// Reducer + state for the streaming query path on QueryPage.
//
// The reducer is extracted into its own module so it can be unit-tested
// in isolation (without rendering QueryPage) and so the row-fan-in
// hot path can be benchmarked or replaced without touching the page
// shell.
//
// PERF-F4 (issue #26): the previous 'row' branch did
//   { ...state, rows: [...state.rows, m.row] }
// which copies the entire row array on every incoming row. Under a
// 1000-row stream that is O(N^2) memory copies (~500K row references
// shuffled). The new implementation keeps a stable rows array reference
// and pushes mutably, then bumps a `rowsVersion` counter so React still
// observes a state change. Downstream consumers re-render via the
// changed top-level state object; the inner rows array is the same
// reference, but every consumer that touches `rowsVersion` (or any
// other field) will pick up the new pushes.
//
// Mutating state inside a reducer normally violates React's reducer
// contract. We tolerate it here because:
//   1. The mutation is confined to the rows[] array; every other
//      field is replaced via spread.
//   2. We always return a new top-level state object, so React's
//      shallow-equal bail-out in useReducer still triggers a re-render.
//   3. Nothing else in the app reads `state.rows` from a stale closure
//      that depends on referential equality of that inner array.

import { StreamMsg } from '../lib/queryStream'

export type StreamStatus = 'idle' | 'running' | 'done' | 'error'

export type StreamState = {
  status: StreamStatus
  columns: { name: string; type: string }[]
  rows: unknown[][]
  rowCount: number
  // rowsVersion is bumped every time we push to rows[]; consumers can
  // include it in deps arrays to invalidate memoized derivations of
  // rows without paying the spread-copy cost on every push.
  rowsVersion: number
  elapsedMs: number
  error: string | null
}

export type StreamAction =
  | { type: 'reset' }
  | { type: 'start' }
  | { type: 'msg'; msg: StreamMsg }
  | { type: 'closed' }

export const initialStreamState: StreamState = {
  status: 'idle',
  columns: [],
  rows: [],
  rowCount: 0,
  rowsVersion: 0,
  elapsedMs: 0,
  error: null,
}

export function streamReducer(
  state: StreamState,
  action: StreamAction
): StreamState {
  switch (action.type) {
    case 'reset':
      // Reset always allocates a fresh rows array so the previous
      // mutable buffer cannot leak into the next run.
      return {
        ...initialStreamState,
        rows: [],
      }
    case 'start':
      return {
        ...initialStreamState,
        rows: [],
        status: 'running',
      }
    case 'msg': {
      const m = action.msg
      if (m.kind === 'schema') return { ...state, columns: m.columns }
      if (m.kind === 'row') {
        // Mutable push: keep the rows array reference stable so we
        // avoid the O(N) spread-copy on every row arrival. Bump
        // rowsVersion so the new state object differs from the prior.
        state.rows.push(m.row)
        return { ...state, rowsVersion: state.rowsVersion + 1 }
      }
      if (m.kind === 'summary') {
        return { ...state, rowCount: m.row_count, elapsedMs: m.elapsed_ms }
      }
      if (m.kind === 'error') {
        return { ...state, status: 'error', error: `${m.code}: ${m.message}` }
      }
      if (m.kind === 'end') return { ...state, status: 'done' }
      return state
    }
    case 'closed':
      return state.status === 'running' ? { ...state, status: 'done' } : state
    default:
      return state
  }
}
