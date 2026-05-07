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
