import { act, renderHook } from '@testing-library/react'
import { usePane } from './usePane'
import { useQueryHistory } from '../../lib/useQueryHistory'

type FakeHandle = {
  statement: string
  onMessage: (m: unknown) => void
  cancel: jest.Mock
  resolveDone: () => void
}

const handles: FakeHandle[] = []
jest.mock('../../lib/queryStream', () => ({
  streamQuery: (
    statement: string,
    _graph: unknown,
    onMessage: (m: unknown) => void
  ) => {
    let resolveDone = (): void => {}
    const done = new Promise<void>((r) => {
      resolveDone = r
    })
    const cancel = jest.fn()
    handles.push({ statement, onMessage, cancel, resolveDone })
    return { cancel, done }
  },
}))

// handleAt returns handles[i] with a non-optional type — the test fails
// loudly if streamQuery wasn't called the expected number of times,
// rather than tripping noUncheckedIndexedAccess at every use site.
function handleAt(i: number): FakeHandle {
  const h = handles[i]
  if (!h) throw new Error(`expected a stream handle at index ${i}`)
  return h
}

describe('usePane', () => {
  beforeEach(() => {
    handles.length = 0
    localStorage.clear()
    useQueryHistory.setState({ entries: [] })
  })

  it('run() opens a stream with the pane statement and exposes streamed rows', () => {
    const { result } = renderHook(() => usePane())
    act(() => result.current.setStatement('MATCH (n) RETURN n LIMIT 2'))
    act(() => result.current.run())
    expect(handles).toHaveLength(1)
    expect(handleAt(0).statement).toBe('MATCH (n) RETURN n LIMIT 2')
    act(() => {
      handleAt(0).onMessage({
        kind: 'schema',
        columns: [{ name: 'n', type: 'NODE' }],
      })
      handleAt(0).onMessage({ kind: 'rowBatch', rows: [[1], [2]] })
      handleAt(0).onMessage({ kind: 'summary', row_count: 2, elapsed_ms: 5 })
      handleAt(0).onMessage({ kind: 'end' })
    })
    expect(result.current.resp?.row_count).toBe(2)
    expect(result.current.resp?.rows).toHaveLength(2)
    // Completing the run records the run-time statement into history.
    expect(useQueryHistory.getState().entries[0]?.statement).toBe(
      'MATCH (n) RETURN n LIMIT 2'
    )
    expect(useQueryHistory.getState().entries[0]?.ok).toBe(true)
  })

  it('cancel() cancels the active handle', () => {
    const { result } = renderHook(() => usePane())
    act(() => result.current.run())
    act(() => result.current.cancel())
    expect(handleAt(0).cancel).toHaveBeenCalled()
  })

  it('two pane instances are independent', () => {
    const a = renderHook(() => usePane())
    const b = renderHook(() => usePane())
    act(() => a.result.current.setStatement('A'))
    act(() => b.result.current.setStatement('B'))
    act(() => a.result.current.run())
    expect(handles).toHaveLength(1)
    expect(handleAt(0).statement).toBe('A')
    expect(b.result.current.busy).toBe(false) // b unaffected
  })
})
