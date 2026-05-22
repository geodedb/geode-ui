import { useQueryHistory, entriesFor, MAX_HISTORY } from './useQueryHistory'

describe('useQueryHistory', () => {
  beforeEach(() => {
    localStorage.clear()
    useQueryHistory.setState({ byProfile: {} })
  })

  it('starts empty (no profile, any profile)', () => {
    const s = useQueryHistory.getState()
    expect(s.byProfile).toEqual({})
    expect(entriesFor(s, 'default')).toEqual([])
    expect(entriesFor(s, '')).toEqual([])
  })

  it('record prepends newest-first within a single profile', () => {
    useQueryHistory
      .getState()
      .record('default', { statement: 'A', rowCount: 1, ok: true })
    useQueryHistory
      .getState()
      .record('default', { statement: 'B', rowCount: 2, ok: true })
    expect(
      entriesFor(useQueryHistory.getState(), 'default').map((e) => e.statement)
    ).toEqual(['B', 'A'])
  })

  it('coalesces consecutive identical statements (same statement+ok) within a profile', () => {
    useQueryHistory
      .getState()
      .record('default', { statement: 'A', rowCount: 1, ok: true })
    useQueryHistory
      .getState()
      .record('default', { statement: 'A', rowCount: 5, ok: true })
    const entries = entriesFor(useQueryHistory.getState(), 'default')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.rowCount).toBe(5)
  })

  it(`caps at ${MAX_HISTORY} entries per profile (FIFO eviction)`, () => {
    for (let i = 0; i <= MAX_HISTORY; i += 1) {
      useQueryHistory
        .getState()
        .record('default', { statement: `Q${i}`, rowCount: 0, ok: true })
    }
    const entries = entriesFor(useQueryHistory.getState(), 'default')
    expect(entries).toHaveLength(MAX_HISTORY)
    expect(entries[0]?.statement).toBe(`Q${MAX_HISTORY}`)
    expect(entries.find((e) => e.statement === 'Q0')).toBeUndefined()
  })

  it('persists to localStorage and clear(profile) empties only that profile', () => {
    useQueryHistory
      .getState()
      .record('default', { statement: 'A', rowCount: 1, ok: true })
    useQueryHistory
      .getState()
      .record('social', { statement: 'B', rowCount: 2, ok: true })
    expect(localStorage.getItem('geode-ui.query-history')).toMatch(
      /"statement":"A"/
    )
    useQueryHistory.getState().clear('default')
    const s = useQueryHistory.getState()
    expect(entriesFor(s, 'default')).toEqual([])
    expect(entriesFor(s, 'social').map((e) => e.statement)).toEqual(['B'])
  })

  // ---------------------------------------------------------------------------
  // 2026-05-22 bug-fix: per-profile scoping.
  //
  // Pre-fix the store was a single global array, so a query recorded
  // while connected to profile A leaked into the dashboard view for
  // profile B. These tests pin the new contract: record(profileName,
  // …) writes to that profile's bucket only, and entriesFor reads
  // exactly the same bucket.
  // ---------------------------------------------------------------------------

  it('isolates entries by profile — A and B do not see each other', () => {
    useQueryHistory
      .getState()
      .record('default', { statement: 'movies-query', rowCount: 5, ok: true })
    useQueryHistory
      .getState()
      .record('social', { statement: 'social-query', rowCount: 12, ok: true })

    const s = useQueryHistory.getState()
    const defaultEntries = entriesFor(s, 'default')
    const socialEntries = entriesFor(s, 'social')

    expect(defaultEntries.map((e) => e.statement)).toEqual(['movies-query'])
    expect(socialEntries.map((e) => e.statement)).toEqual(['social-query'])
    expect(
      defaultEntries.find((e) => e.statement === 'social-query')
    ).toBeUndefined()
    expect(
      socialEntries.find((e) => e.statement === 'movies-query')
    ).toBeUndefined()
  })

  it('clearing one profile leaves the other intact', () => {
    useQueryHistory
      .getState()
      .record('default', { statement: 'A', rowCount: 1, ok: true })
    useQueryHistory
      .getState()
      .record('social', { statement: 'B', rowCount: 2, ok: true })
    useQueryHistory.getState().clear('default')
    const s = useQueryHistory.getState()
    expect(entriesFor(s, 'default')).toEqual([])
    expect(entriesFor(s, 'social').map((e) => e.statement)).toEqual(['B'])
  })

  it('clear() on a never-seen profile is a no-op (no spurious state churn)', () => {
    useQueryHistory
      .getState()
      .record('default', { statement: 'A', rowCount: 1, ok: true })
    const before = useQueryHistory.getState().byProfile
    useQueryHistory.getState().clear('never-existed')
    expect(useQueryHistory.getState().byProfile).toBe(before)
  })

  it('coalescing is per-profile — identical statement against different profiles stacks separately', () => {
    useQueryHistory
      .getState()
      .record('default', { statement: 'SAME', rowCount: 1, ok: true })
    useQueryHistory
      .getState()
      .record('social', { statement: 'SAME', rowCount: 2, ok: true })
    const s = useQueryHistory.getState()
    // Each profile keeps its own single entry (coalescing doesn't cross
    // profile boundaries; the social entry has a distinct rowCount).
    expect(entriesFor(s, 'default')).toHaveLength(1)
    expect(entriesFor(s, 'social')).toHaveLength(1)
    expect(entriesFor(s, 'default')[0]?.rowCount).toBe(1)
    expect(entriesFor(s, 'social')[0]?.rowCount).toBe(2)
  })
})
