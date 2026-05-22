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

  // Regression — React Minified error #185 ("Maximum update depth
  // exceeded") observed on /dashboard after a successful login. Root
  // cause: entriesFor() returned `s.byProfile[name] ?? []` — a NEW
  // empty array literal each call. Zustand's useStore(selector) is
  // built on useSyncExternalStore which compares the selector result
  // with Object.is. Two different `[]` references are not equal, so
  // React thought the snapshot had changed every render and
  // re-scheduled another render to recheck — infinite loop. Caught by
  // 2026-05-22 1Password-autofill bug report. The fix returns a
  // shared empty-array singleton when the profile has no entries.
  describe('selector stability (#185 regression)', () => {
    it('returns the SAME empty-array reference every call for an unknown profile', () => {
      const s = useQueryHistory.getState()
      const a = entriesFor(s, 'never-recorded')
      const b = entriesFor(s, 'also-never-recorded')
      const c = entriesFor(s, 'never-recorded')
      // All three must point at the same singleton — referentially
      // stable, not just structurally equal.
      expect(a).toBe(b)
      expect(b).toBe(c)
      expect(a).toEqual([])
    })

    it('returns the SAME populated-array reference across calls when state has not changed', () => {
      useQueryHistory
        .getState()
        .record('default', { statement: 'A', rowCount: 1, ok: true })
      const s = useQueryHistory.getState()
      const a = entriesFor(s, 'default')
      const b = entriesFor(s, 'default')
      // Populated lookup must also be referentially stable —
      // returning a fresh map/filter would loop just like the empty
      // case.
      expect(a).toBe(b)
      expect(a.map((e) => e.statement)).toEqual(['A'])
    })

    it('empty-array singleton is frozen (cannot be mutated by callers)', () => {
      const s = useQueryHistory.getState()
      const empty = entriesFor(s, 'never-recorded')
      // The singleton must be frozen so a careless caller can't push
      // into it and corrupt every future "no entries" lookup. The
      // freeze also documents the API contract: the array is shared,
      // do not mutate.
      expect(Object.isFrozen(empty)).toBe(true)
    })
  })
})
