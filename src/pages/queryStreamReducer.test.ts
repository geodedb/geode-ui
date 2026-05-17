import {
  DEFAULT_ROW_RETENTION_CAP,
  StreamState,
  initialStreamState,
  streamReducer,
} from './queryStreamReducer'

describe('streamReducer', () => {
  test('reset returns a freshly-allocated initial state', () => {
    let s: StreamState = initialStreamState
    s = streamReducer(s, { type: 'start' })
    s = streamReducer(s, { type: 'msg', msg: { kind: 'row', row: [1] } })
    s = streamReducer(s, { type: 'reset' })
    expect(s.rows).toEqual([])
    expect(s.rowsVersion).toBe(0)
    expect(s.status).toBe('idle')
  })

  test('start clears rows from a previous run', () => {
    let s: StreamState = initialStreamState
    s = streamReducer(s, { type: 'msg', msg: { kind: 'row', row: ['a'] } })
    s = streamReducer(s, { type: 'start' })
    expect(s.rows).toEqual([])
    expect(s.status).toBe('running')
  })

  test('row appends mutably without spread-copy (rows array reference is stable)', () => {
    let s: StreamState = streamReducer(initialStreamState, { type: 'start' })
    const rowsRef = s.rows
    for (let i = 0; i < 1000; i += 1) {
      s = streamReducer(s, { type: 'msg', msg: { kind: 'row', row: [i] } })
    }
    expect(s.rows).toBe(rowsRef)
    expect(s.rows.length).toBe(1000)
    expect(s.rowsVersion).toBe(1000)
  })

  test('row produces a new top-level state object on every push', () => {
    let s: StreamState = streamReducer(initialStreamState, { type: 'start' })
    const prev = s
    s = streamReducer(s, { type: 'msg', msg: { kind: 'row', row: [42] } })
    expect(s).not.toBe(prev)
    expect(s.rowsVersion).toBe(prev.rowsVersion + 1)
  })

  test('rowBatch appends a whole frame in one reduction (single rowsVersion bump per frame)', () => {
    let s: StreamState = streamReducer(initialStreamState, { type: 'start' })
    const rowsRef = s.rows
    // Three server frames, 64/64/32 rows — mirrors the wire batching.
    const frame = (start: number, n: number): unknown[][] =>
      Array.from({ length: n }, (_, i) => [start + i])
    s = streamReducer(s, {
      type: 'msg',
      msg: { kind: 'rowBatch', rows: frame(0, 64) },
    })
    s = streamReducer(s, {
      type: 'msg',
      msg: { kind: 'rowBatch', rows: frame(64, 64) },
    })
    s = streamReducer(s, {
      type: 'msg',
      msg: { kind: 'rowBatch', rows: frame(128, 32) },
    })
    // Stable rows array reference (no spread-copy), all 160 rows present,
    // and exactly one rowsVersion bump per frame — O(frames), not O(rows).
    expect(s.rows).toBe(rowsRef)
    expect(s.rows.length).toBe(160)
    expect(s.rowsVersion).toBe(3)
    expect(s.rows[0]).toEqual([0])
    expect(s.rows[159]).toEqual([159])
  })

  test('empty rowBatch is a no-op (no state churn, no version bump)', () => {
    const s0: StreamState = streamReducer(initialStreamState, { type: 'start' })
    const s1 = streamReducer(s0, {
      type: 'msg',
      msg: { kind: 'rowBatch', rows: [] },
    })
    expect(s1).toBe(s0)
    expect(s1.rowsVersion).toBe(0)
  })

  // PERF-2026-05-17-03 (#240): the reducer must apply a retention cap so
  // a 100k-row stream (server-spooled) cannot blow up the Electron heap
  // — RAM stability matters more than retaining rows the table is never
  // going to show. Beyond the cap incoming rows are dropped on the floor
  // and counted into rowsTruncated; rowsVersion is still bumped IF any
  // rows were actually retained that frame so memoized derivations
  // refresh correctly, and is NOT bumped on pure-overflow frames so
  // memoized derivations don't churn for no visible change.
  describe('retention cap (PERF #240)', () => {
    test('row append stops at the default cap and counts the overflow', () => {
      let s: StreamState = streamReducer(initialStreamState, { type: 'start' })
      // 'start' must seed the cap so the reducer is closed under the
      // initial state — callers don't have to remember to pass it on
      // every dispatch.
      expect(s.rowRetentionCap).toBe(DEFAULT_ROW_RETENTION_CAP)
      // Synthesise (cap+10) row dispatches; the rows array must clamp
      // to the cap and rowsTruncated must capture exactly the overflow.
      for (let i = 0; i < DEFAULT_ROW_RETENTION_CAP + 10; i += 1) {
        s = streamReducer(s, { type: 'msg', msg: { kind: 'row', row: [i] } })
      }
      expect(s.rows.length).toBe(DEFAULT_ROW_RETENTION_CAP)
      expect(s.rowsTruncated).toBe(10)
    })

    test('rowBatch retains the partial fit and counts the overflow', () => {
      let s: StreamState = streamReducer(initialStreamState, {
        type: 'start',
        rowRetentionCap: 5,
      })
      expect(s.rowRetentionCap).toBe(5)
      // First batch: 3 rows -> all retained, rowsTruncated stays 0.
      s = streamReducer(s, {
        type: 'msg',
        msg: { kind: 'rowBatch', rows: [[0], [1], [2]] },
      })
      expect(s.rows.length).toBe(3)
      expect(s.rowsTruncated).toBe(0)
      // Second batch: 4 rows but only 2 slots remain -> partial fit.
      // Retained rows are the FIRST 2 of the incoming frame so a stable
      // sort order is preserved on partial truncation.
      s = streamReducer(s, {
        type: 'msg',
        msg: { kind: 'rowBatch', rows: [[3], [4], [5], [6]] },
      })
      expect(s.rows.length).toBe(5)
      expect(s.rows[3]).toEqual([3])
      expect(s.rows[4]).toEqual([4])
      expect(s.rowsTruncated).toBe(2)
      // Third batch: 100 rows, every one is pure overflow. Rows array
      // unchanged, rowsTruncated catches the full frame, rowsVersion
      // does NOT bump (no visible change).
      const v = s.rowsVersion
      s = streamReducer(s, {
        type: 'msg',
        msg: {
          kind: 'rowBatch',
          rows: Array.from({ length: 100 }, (_, i) => [i + 7]),
        },
      })
      expect(s.rows.length).toBe(5)
      expect(s.rowsTruncated).toBe(102)
      expect(s.rowsVersion).toBe(v)
    })

    test('reset clears rowsTruncated and the cap reverts to the default until the next start', () => {
      let s: StreamState = streamReducer(initialStreamState, {
        type: 'start',
        rowRetentionCap: 2,
      })
      s = streamReducer(s, {
        type: 'msg',
        msg: { kind: 'rowBatch', rows: [[0], [1], [2], [3]] },
      })
      expect(s.rowsTruncated).toBe(2)
      s = streamReducer(s, { type: 'reset' })
      expect(s.rowsTruncated).toBe(0)
      expect(s.rowRetentionCap).toBe(DEFAULT_ROW_RETENTION_CAP)
    })
  })

  test('schema, summary, error, end branches still work', () => {
    let s: StreamState = streamReducer(initialStreamState, { type: 'start' })
    s = streamReducer(s, {
      type: 'msg',
      msg: {
        kind: 'schema',
        columns: [{ name: 'n', type: 'NODE' }],
      },
    })
    expect(s.columns).toEqual([{ name: 'n', type: 'NODE' }])

    s = streamReducer(s, {
      type: 'msg',
      msg: { kind: 'summary', row_count: 7, elapsed_ms: 12 },
    })
    expect(s.rowCount).toBe(7)
    expect(s.elapsedMs).toBe(12)

    s = streamReducer(s, { type: 'msg', msg: { kind: 'end' } })
    expect(s.status).toBe('done')

    const e = streamReducer(initialStreamState, {
      type: 'msg',
      msg: { kind: 'error', code: 'X', message: 'boom' },
    })
    expect(e.status).toBe('error')
    expect(e.error).toBe('X: boom')
  })
})
