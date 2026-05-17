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

/**
 * DEFAULT_ROW_RETENTION_CAP caps the rows we keep in-memory for the
 * streaming query path (PERF #240). The server can spool a 100k-row
 * result through the WebSocket; without a cap, the Electron heap grows
 * monotonically with the stream and the table re-projection runs over
 * a much larger array than the 5,000-row display cap is willing to
 * show. The cap is conservative enough that a 5,000-row display always
 * has 5x headroom for slicing without dropping a single visible row,
 * but small enough that a runaway stream never exhausts the renderer.
 * Caller overrides via `start.rowRetentionCap`.
 */
export const DEFAULT_ROW_RETENTION_CAP = 25_000

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
  // rowRetentionCap is the maximum size of rows[]; incoming rows past
  // this point are dropped and counted into rowsTruncated. Sourced from
  // the 'start' action so a caller can override the default per-run.
  rowRetentionCap: number
  // rowsTruncated is the number of rows the server delivered that we
  // declined to retain because the retention cap was reached. The UI
  // surfaces this as an overflow banner with a hint to re-run with
  // server-spooled export when the user needs the full set.
  rowsTruncated: number
}

export type StreamAction =
  | { type: 'reset' }
  | { type: 'start'; rowRetentionCap?: number }
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
  rowRetentionCap: DEFAULT_ROW_RETENTION_CAP,
  rowsTruncated: 0,
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
        rowRetentionCap: action.rowRetentionCap ?? DEFAULT_ROW_RETENTION_CAP,
      }
    case 'msg': {
      const m = action.msg
      if (m.kind === 'schema') return { ...state, columns: m.columns }
      if (m.kind === 'row') {
        // PERF-2026-05-17-03 (#240): respect the retention cap. Past the
        // cap incoming rows are dropped on the floor and counted into
        // rowsTruncated so the UI can surface an overflow banner; the
        // rows array reference is still stable so memoized derivations
        // don't tear.
        if (state.rows.length >= state.rowRetentionCap) {
          return { ...state, rowsTruncated: state.rowsTruncated + 1 }
        }
        // Mutable push: keep the rows array reference stable so we
        // avoid the O(N) spread-copy on every row arrival. Bump
        // rowsVersion so the new state object differs from the prior.
        state.rows.push(m.row)
        return { ...state, rowsVersion: state.rowsVersion + 1 }
      }
      if (m.kind === 'rowBatch') {
        // PERF-2026-05-11-04 (#137): append a whole server-batched
        // frame (up to 64 rows) in a single reduction. One mutable
        // push of the array contents, one rowsVersion bump per frame —
        // so an N-frame stream costs O(frames) reductions, not O(rows).
        // An empty batch is still a no-op state change (no version bump)
        // so memoized row derivations don't churn for an empty frame.
        if (m.rows.length === 0) return state
        // PERF-2026-05-17-03 (#240): partial-fit + pure-overflow paths.
        // A pure-overflow frame (no slots remain) bumps rowsTruncated
        // by the full frame and DOES NOT bump rowsVersion — there is
        // no visible change for memoized derivations to refresh.
        const remaining = state.rowRetentionCap - state.rows.length
        if (remaining <= 0) {
          return {
            ...state,
            rowsTruncated: state.rowsTruncated + m.rows.length,
          }
        }
        if (remaining < m.rows.length) {
          // Partial fit: retain the FIRST `remaining` rows of the frame
          // so a server-side ordered result still surfaces in order;
          // count the dropped tail into rowsTruncated.
          state.rows.push(...m.rows.slice(0, remaining))
          return {
            ...state,
            rowsVersion: state.rowsVersion + 1,
            rowsTruncated: state.rowsTruncated + (m.rows.length - remaining),
          }
        }
        state.rows.push(...m.rows)
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
