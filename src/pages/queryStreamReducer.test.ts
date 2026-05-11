import {
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
