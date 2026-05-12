import { useQueryHistory, MAX_HISTORY } from './useQueryHistory'

describe('useQueryHistory', () => {
  beforeEach(() => {
    localStorage.clear()
    useQueryHistory.setState({ entries: [] })
  })

  it('starts empty', () => {
    expect(useQueryHistory.getState().entries).toEqual([])
  })

  it('record prepends newest-first', () => {
    useQueryHistory.getState().record({ statement: 'A', rowCount: 1, ok: true })
    useQueryHistory.getState().record({ statement: 'B', rowCount: 2, ok: true })
    expect(useQueryHistory.getState().entries.map((e) => e.statement)).toEqual([
      'B',
      'A',
    ])
  })

  it('coalesces consecutive identical statements (same statement+ok) instead of duplicating', () => {
    useQueryHistory.getState().record({ statement: 'A', rowCount: 1, ok: true })
    useQueryHistory.getState().record({ statement: 'A', rowCount: 5, ok: true })
    const { entries } = useQueryHistory.getState()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.rowCount).toBe(5)
  })

  it(`caps at ${MAX_HISTORY} entries (FIFO eviction)`, () => {
    for (let i = 0; i <= MAX_HISTORY; i += 1) {
      useQueryHistory
        .getState()
        .record({ statement: `Q${i}`, rowCount: 0, ok: true })
    }
    const { entries } = useQueryHistory.getState()
    expect(entries).toHaveLength(MAX_HISTORY)
    expect(entries[0]?.statement).toBe(`Q${MAX_HISTORY}`)
    expect(entries.find((e) => e.statement === 'Q0')).toBeUndefined()
  })

  it('persists to localStorage and clear() empties', () => {
    useQueryHistory.getState().record({ statement: 'A', rowCount: 1, ok: true })
    expect(localStorage.getItem('geode-ui.query-history')).toMatch(
      /"statement":"A"/
    )
    useQueryHistory.getState().clear()
    expect(useQueryHistory.getState().entries).toEqual([])
  })
})
