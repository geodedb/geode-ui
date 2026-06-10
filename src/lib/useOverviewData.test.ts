import { act, renderHook, waitFor } from '@testing-library/react'

const graphsMock = jest.fn()
const capsMock = jest.fn()
const queryMock = jest.fn()
jest.mock('../api/client', () => ({
  client: {
    graphs: (...a: unknown[]) => graphsMock(...a),
    getCapabilities: (...a: unknown[]) => capsMock(...a),
    query: (...a: unknown[]) => queryMock(...a),
  },
}))
// useActiveConnection is the cache key source for PERF #237; a static
// mock provides a stable connectionId so cache lookups are deterministic.
const useActiveConnectionMock = jest.fn(() => ({
  connectionId: 'test-conn-1',
  profileName: 'test-profile',
  token: 'tok',
  expiresAt: Date.now() + 60_000,
}))
jest.mock('../api/connections', () => ({
  useActiveConnection: () => useActiveConnectionMock(),
}))
import {
  useOverviewData,
  testOnlyResetGraphStatsCache,
  testOnlySetGraphStatsCacheTTL,
  testOnlyGetGraphStatsCacheTTL,
  testOnlyGraphStatsCacheSize,
  testOnlyGraphStatsCacheHas,
  graphStatsCacheMax,
} from './useOverviewData'

// fetchCapabilities (src/api/capabilities.ts) internally calls
// client.getCapabilities({}). genapi 0.11.1's generated client converts the
// snake_case wire response to camelCase, so the mock resolves the
// camelCase {geodeVersion, adminWritable} shape the client actually returns
// and fetchCapabilities narrows it into the typed Capabilities.
const rawCaps = {
  geodeVersion: 'v0.5.11',
  adminWritable: {
    users: false,
    roles: false,
    policies: false,
    grants: false,
  },
}

describe('useOverviewData', () => {
  beforeEach(() => {
    graphsMock.mockReset()
    capsMock.mockReset()
    queryMock.mockReset()
    testOnlyResetGraphStatsCache()
    useActiveConnectionMock.mockImplementation(() => ({
      connectionId: 'test-conn-1',
      profileName: 'test-profile',
      token: 'tok',
      expiresAt: Date.now() + 60_000,
    }))
  })

  it('loads graphs + capabilities on mount', async () => {
    graphsMock.mockResolvedValue({ graphs: ['default', 'movies'] })
    capsMock.mockResolvedValue(rawCaps)
    const { result } = renderHook(() => useOverviewData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.graphs).toEqual(['default', 'movies'])
    expect(result.current.geodeVersion).toBe('v0.5.11')
    expect(result.current.adminWritable).toEqual({
      users: false,
      roles: false,
      policies: false,
      grants: false,
      attributes: false,
      rlsDenyPolicies: false,
      rlsAttributePolicies: false,
    })
  })

  it('a failing graphs() does not blank the version', async () => {
    graphsMock.mockRejectedValue(new Error('boom'))
    capsMock.mockResolvedValue(rawCaps)
    const { result } = renderHook(() => useOverviewData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.graphsError).toMatch(/boom/)
    expect(result.current.geodeVersion).toBe('v0.5.11')
  })

  it('loadStats runs the two count queries and exposes node/edge counts', async () => {
    graphsMock.mockResolvedValue({ graphs: ['default'] })
    capsMock.mockResolvedValue(rawCaps)
    queryMock
      .mockResolvedValueOnce({
        columns: [{ name: 'c', type: 'INT' }],
        rows: [[42]],
        row_count: 1,
        elapsed_ms: 1,
      })
      .mockResolvedValueOnce({
        columns: [{ name: 'c', type: 'INT' }],
        rows: [[99]],
        row_count: 1,
        elapsed_ms: 1,
      })
    const { result } = renderHook(() => useOverviewData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.loadStats('default'))
    await waitFor(() => expect(result.current.statsLoading).toBe(false))
    expect(result.current.defaultGraphStats).toEqual({ nodes: 42, edges: 99 })
    expect(queryMock).toHaveBeenCalledTimes(2)
  })

  it('loadStats error sets statsError and leaves defaultGraphStats null', async () => {
    graphsMock.mockResolvedValue({ graphs: ['default'] })
    capsMock.mockResolvedValue(rawCaps)
    queryMock.mockRejectedValue(new Error('stats boom'))
    const { result } = renderHook(() => useOverviewData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.loadStats('default'))
    await waitFor(() => expect(result.current.statsLoading).toBe(false))
    expect(result.current.statsError).toMatch(/stats boom/)
    expect(result.current.defaultGraphStats).toBeNull()
  })

  // PERF #237 acceptance: the second loadStats call for the same
  // (connectionId, graph) within the TTL window MUST NOT issue another
  // query. The pre-cache implementation fired two count queries on
  // every call regardless of recency.
  it('loadStats serves from the module cache within the TTL window', async () => {
    graphsMock.mockResolvedValue({ graphs: ['default'] })
    capsMock.mockResolvedValue(rawCaps)
    queryMock
      .mockResolvedValueOnce({
        columns: [{ name: 'c', type: 'INT' }],
        rows: [[42]],
        row_count: 1,
        elapsed_ms: 1,
      })
      .mockResolvedValueOnce({
        columns: [{ name: 'c', type: 'INT' }],
        rows: [[99]],
        row_count: 1,
        elapsed_ms: 1,
      })
    const { result } = renderHook(() => useOverviewData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.loadStats('default'))
    await waitFor(() => expect(result.current.statsLoading).toBe(false))
    expect(result.current.defaultGraphStats).toEqual({ nodes: 42, edges: 99 })
    expect(queryMock).toHaveBeenCalledTimes(2)

    // Second call: cache hit -> no new queries, stats served sync.
    queryMock.mockClear()
    act(() => result.current.loadStats('default'))
    await waitFor(() =>
      expect(result.current.defaultGraphStats).toEqual({ nodes: 42, edges: 99 })
    )
    expect(queryMock).toHaveBeenCalledTimes(0)
  })

  it('loadStats cache survives unmount/remount within TTL', async () => {
    graphsMock.mockResolvedValue({ graphs: ['default'] })
    capsMock.mockResolvedValue(rawCaps)
    queryMock
      .mockResolvedValueOnce({
        columns: [{ name: 'c', type: 'INT' }],
        rows: [[7]],
        row_count: 1,
        elapsed_ms: 1,
      })
      .mockResolvedValueOnce({
        columns: [{ name: 'c', type: 'INT' }],
        rows: [[3]],
        row_count: 1,
        elapsed_ms: 1,
      })
    const r1 = renderHook(() => useOverviewData())
    await waitFor(() => expect(r1.result.current.loading).toBe(false))
    act(() => r1.result.current.loadStats('default'))
    await waitFor(() => expect(r1.result.current.statsLoading).toBe(false))
    expect(queryMock).toHaveBeenCalledTimes(2)
    r1.unmount()

    // Remount: a fresh hook instance MUST still hit the cache.
    queryMock.mockClear()
    const r2 = renderHook(() => useOverviewData())
    await waitFor(() => expect(r2.result.current.loading).toBe(false))
    act(() => r2.result.current.loadStats('default'))
    await waitFor(() =>
      expect(r2.result.current.defaultGraphStats).toEqual({
        nodes: 7,
        edges: 3,
      })
    )
    expect(queryMock).toHaveBeenCalledTimes(0)
  })

  it('loadStats cache is keyed on (connectionId, graph)', async () => {
    graphsMock.mockResolvedValue({ graphs: ['default'] })
    capsMock.mockResolvedValue(rawCaps)
    queryMock
      .mockResolvedValueOnce({
        columns: [{ name: 'c', type: 'INT' }],
        rows: [[10]],
        row_count: 1,
        elapsed_ms: 1,
      })
      .mockResolvedValueOnce({
        columns: [{ name: 'c', type: 'INT' }],
        rows: [[20]],
        row_count: 1,
        elapsed_ms: 1,
      })
    const r1 = renderHook(() => useOverviewData())
    await waitFor(() => expect(r1.result.current.loading).toBe(false))
    act(() => r1.result.current.loadStats('default'))
    await waitFor(() => expect(r1.result.current.statsLoading).toBe(false))
    expect(queryMock).toHaveBeenCalledTimes(2)
    r1.unmount()

    // Switch active connection: must MISS the cache and re-issue.
    useActiveConnectionMock.mockImplementation(() => ({
      connectionId: 'other-conn-2',
      profileName: 'other-profile',
      token: 'tok2',
      expiresAt: Date.now() + 60_000,
    }))
    queryMock.mockClear()
    queryMock
      .mockResolvedValueOnce({
        columns: [{ name: 'c', type: 'INT' }],
        rows: [[1000]],
        row_count: 1,
        elapsed_ms: 1,
      })
      .mockResolvedValueOnce({
        columns: [{ name: 'c', type: 'INT' }],
        rows: [[2000]],
        row_count: 1,
        elapsed_ms: 1,
      })
    const r2 = renderHook(() => useOverviewData())
    await waitFor(() => expect(r2.result.current.loading).toBe(false))
    act(() => r2.result.current.loadStats('default'))
    await waitFor(() => expect(r2.result.current.statsLoading).toBe(false))
    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(r2.result.current.defaultGraphStats).toEqual({
      nodes: 1000,
      edges: 2000,
    })
  })

  // PERF-N7 (#286): the module-level graphStatsCache MUST be LRU-
  // bounded so a long-lived tab that browses through many graphs
  // doesn't leak entries. The 60s TTL evicts only on a matching-key
  // read, so without a cap unread entries sit forever.
  it('loadStats LRU eviction: oldest entry drops past the cap', async () => {
    graphsMock.mockResolvedValue({ graphs: ['default'] })
    capsMock.mockResolvedValue(rawCaps)
    const { result } = renderHook(() => useOverviewData())
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Fill the cache to capacity. Each graph name gets its own
    // (nodes=i, edges=i+1) tuple so we can assert which entries
    // survived.
    for (let i = 0; i < graphStatsCacheMax; i += 1) {
      queryMock
        .mockResolvedValueOnce({
          columns: [{ name: 'c', type: 'INT' }],
          rows: [[i]],
          row_count: 1,
          elapsed_ms: 1,
        })
        .mockResolvedValueOnce({
          columns: [{ name: 'c', type: 'INT' }],
          rows: [[i + 1]],
          row_count: 1,
          elapsed_ms: 1,
        })
      act(() => result.current.loadStats(`g${i}`))
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(result.current.statsLoading).toBe(false))
    }
    expect(testOnlyGraphStatsCacheSize()).toBe(graphStatsCacheMax)
    expect(testOnlyGraphStatsCacheHas('test-conn-1', 'g0')).toBe(true)
    expect(
      testOnlyGraphStatsCacheHas('test-conn-1', `g${graphStatsCacheMax - 1}`)
    ).toBe(true)

    // Insert one more entry. The cap should evict the OLDEST (g0).
    queryMock
      .mockResolvedValueOnce({
        columns: [{ name: 'c', type: 'INT' }],
        rows: [[9001]],
        row_count: 1,
        elapsed_ms: 1,
      })
      .mockResolvedValueOnce({
        columns: [{ name: 'c', type: 'INT' }],
        rows: [[9002]],
        row_count: 1,
        elapsed_ms: 1,
      })
    act(() => result.current.loadStats('g-overflow'))
    await waitFor(() => expect(result.current.statsLoading).toBe(false))

    expect(testOnlyGraphStatsCacheSize()).toBe(graphStatsCacheMax)
    expect(testOnlyGraphStatsCacheHas('test-conn-1', 'g0')).toBe(false)
    // The next-oldest survives (g1) and the new entry is present.
    expect(testOnlyGraphStatsCacheHas('test-conn-1', 'g1')).toBe(true)
    expect(testOnlyGraphStatsCacheHas('test-conn-1', 'g-overflow')).toBe(true)
  })

  // PERF-N7 (#286) refresh contract: re-writing the SAME key should
  // refresh its LRU position. We seed k1..k(cap-1) first, then
  // (twice) write k0 so its second write moves it to the END of the
  // iteration order. Inserting one more entry then evicts k1 (the
  // oldest), proving k0's re-write moved it past k1.
  it('loadStats LRU refresh: re-writing a key moves it to the head', async () => {
    graphsMock.mockResolvedValue({ graphs: ['default'] })
    capsMock.mockResolvedValue(rawCaps)
    const originalTTL = testOnlyGetGraphStatsCacheTTL()
    // Use a short TTL only around the refresh-write so a re-write
    // actually fires (skipping the cache). The rest of the fill uses
    // a long TTL so entries do not lazily expire mid-test.
    testOnlySetGraphStatsCacheTTL(20)
    try {
      const { result } = renderHook(() => useOverviewData())
      await waitFor(() => expect(result.current.loading).toBe(false))

      // Seed k0 with a short-TTL entry.
      queryMock
        .mockResolvedValueOnce({
          columns: [{ name: 'c', type: 'INT' }],
          rows: [[1]],
          row_count: 1,
          elapsed_ms: 1,
        })
        .mockResolvedValueOnce({
          columns: [{ name: 'c', type: 'INT' }],
          rows: [[2]],
          row_count: 1,
          elapsed_ms: 1,
        })
      act(() => result.current.loadStats('k0'))
      await waitFor(() => expect(result.current.statsLoading).toBe(false))

      // Bump TTL up so the next cold-fill entries do not lazily expire.
      testOnlySetGraphStatsCacheTTL(60_000)
      // Fill k1..k(cap-1). After this loop the iteration order is:
      // k0, k1, ..., k(cap-1).
      for (let i = 1; i < graphStatsCacheMax; i += 1) {
        queryMock
          .mockResolvedValueOnce({
            columns: [{ name: 'c', type: 'INT' }],
            rows: [[100 + i]],
            row_count: 1,
            elapsed_ms: 1,
          })
          .mockResolvedValueOnce({
            columns: [{ name: 'c', type: 'INT' }],
            rows: [[200 + i]],
            row_count: 1,
            elapsed_ms: 1,
          })
        act(() => result.current.loadStats(`k${i}`))
        // eslint-disable-next-line no-await-in-loop
        await waitFor(() => expect(result.current.statsLoading).toBe(false))
      }
      expect(testOnlyGraphStatsCacheSize()).toBe(graphStatsCacheMax)
      expect(testOnlyGraphStatsCacheHas('test-conn-1', 'k0')).toBe(true)

      // Wait past the short TTL k0 was seeded with so the next
      // loadStats('k0') re-issues the count queries and re-writes
      // the entry (the refresh moves k0 to the end of iteration
      // order).
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 40)
      })
      queryMock.mockClear()
      queryMock
        .mockResolvedValueOnce({
          columns: [{ name: 'c', type: 'INT' }],
          rows: [[3]],
          row_count: 1,
          elapsed_ms: 1,
        })
        .mockResolvedValueOnce({
          columns: [{ name: 'c', type: 'INT' }],
          rows: [[4]],
          row_count: 1,
          elapsed_ms: 1,
        })
      act(() => result.current.loadStats('k0'))
      await waitFor(() => expect(result.current.statsLoading).toBe(false))

      // After the refresh the iteration order is:
      //   k1, k2, ..., k(cap-1), k0   (k0 last because it was just
      //   re-written; k1 is the OLDEST).
      // Inserting `overflow` evicts the OLDEST entry, which is k1
      // -- NOT k0. This is the load-bearing assertion: k0's re-write
      // moved it past k1.
      queryMock
        .mockResolvedValueOnce({
          columns: [{ name: 'c', type: 'INT' }],
          rows: [[9001]],
          row_count: 1,
          elapsed_ms: 1,
        })
        .mockResolvedValueOnce({
          columns: [{ name: 'c', type: 'INT' }],
          rows: [[9002]],
          row_count: 1,
          elapsed_ms: 1,
        })
      act(() => result.current.loadStats('overflow'))
      await waitFor(() => expect(result.current.statsLoading).toBe(false))

      expect(testOnlyGraphStatsCacheHas('test-conn-1', 'k0')).toBe(true)
      expect(testOnlyGraphStatsCacheHas('test-conn-1', 'k1')).toBe(false)
      expect(testOnlyGraphStatsCacheHas('test-conn-1', 'overflow')).toBe(true)
    } finally {
      testOnlySetGraphStatsCacheTTL(originalTTL)
    }
  })

  it('loadStats cache entry expires after the TTL', async () => {
    graphsMock.mockResolvedValue({ graphs: ['default'] })
    capsMock.mockResolvedValue(rawCaps)
    const originalTTL = testOnlyGetGraphStatsCacheTTL()
    // Bug 4 (2026-05-21 bug-fix bundle): the auto-load fan-out
    // populates the cache before the manual loadStats() runs. A 10ms
    // TTL is too tight to survive the awaits below — bump to 200ms
    // so the cache-hit window is reliable, then sleep past it for
    // the expiry phase.
    testOnlySetGraphStatsCacheTTL(200)
    try {
      // Bug 4 (2026-05-21 bug-fix bundle): useOverviewData now
      // auto-loads stats for every graph in the list once the graphs
      // settles. Provide enough mocks for the auto-load AND seed the
      // loadStats cache, then re-run after TTL expiry.
      queryMock
        .mockResolvedValueOnce({
          columns: [{ name: 'c', type: 'INT' }],
          rows: [[5]],
          row_count: 1,
          elapsed_ms: 1,
        })
        .mockResolvedValueOnce({
          columns: [{ name: 'c', type: 'INT' }],
          rows: [[9]],
          row_count: 1,
          elapsed_ms: 1,
        })
      const { result } = renderHook(() => useOverviewData())
      await waitFor(() => expect(result.current.loading).toBe(false))
      // Wait for the auto-load to populate the cache so the manual
      // loadStats below hits cache and does not consume more mocks.
      await waitFor(() =>
        expect(result.current.allGraphStats.get('default')?.nodes).toBe(5)
      )
      act(() => result.current.loadStats('default'))
      await waitFor(() => expect(result.current.statsLoading).toBe(false))
      // Auto-load fired 2 queries; manual loadStats was a cache hit.
      expect(queryMock).toHaveBeenCalledTimes(2)

      // Wait past the TTL (200ms).
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 250)
      })
      queryMock.mockClear()
      queryMock
        .mockResolvedValueOnce({
          columns: [{ name: 'c', type: 'INT' }],
          rows: [[55]],
          row_count: 1,
          elapsed_ms: 1,
        })
        .mockResolvedValueOnce({
          columns: [{ name: 'c', type: 'INT' }],
          rows: [[77]],
          row_count: 1,
          elapsed_ms: 1,
        })
      act(() => result.current.loadStats('default'))
      await waitFor(() => expect(result.current.statsLoading).toBe(false))
      expect(queryMock).toHaveBeenCalledTimes(2)
      expect(result.current.defaultGraphStats).toEqual({ nodes: 55, edges: 77 })
    } finally {
      testOnlySetGraphStatsCacheTTL(originalTTL)
    }
  })

  // 2026-05-22 bug report — operator switches active profile through
  // the chrome ConnectionSwitcher; the dashboard kept showing the
  // PREVIOUS profile's graph list (because `load()` only ran on
  // mount) and the per-graph stats fan-out then re-fired
  // `client.query({ graph: <oldName> })` against the NEW connection,
  // producing a 422 (the old graph doesn't exist on the new upstream
  // — observed against a Geode-B that lacks the primary's seeded
  // graphs). The dashboard MUST refetch its graphs + capabilities
  // when the active connection changes, AND clear the per-graph
  // stats map so the user does not see the prior profile's stats
  // while the new data is in flight.
  describe('profile switch → refetch invariants', () => {
    it('refetches graphs + capabilities when the active connection changes', async () => {
      graphsMock
        .mockResolvedValueOnce({ graphs: ['movies', 'vulndb'] })
        .mockResolvedValueOnce({ graphs: ['social'] })
      capsMock
        .mockResolvedValueOnce({
          ...rawCaps,
          geodeVersion: 'v0.5.11-default',
        })
        .mockResolvedValueOnce({
          ...rawCaps,
          geodeVersion: 'v0.5.19-social',
        })

      const { result, rerender } = renderHook(() => useOverviewData())
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.graphs).toEqual(['movies', 'vulndb'])
      expect(result.current.geodeVersion).toBe('v0.5.11-default')
      expect(graphsMock).toHaveBeenCalledTimes(1)
      expect(capsMock).toHaveBeenCalledTimes(1)

      // Operator picks a different profile in the chrome — useActiveConnection
      // now returns a different connectionId.
      useActiveConnectionMock.mockImplementation(() => ({
        connectionId: 'test-conn-2',
        profileName: 'social',
        token: 'tok-social',
        expiresAt: Date.now() + 60_000,
      }))
      rerender()

      // RELEASE-BLOCKER: graphs + capabilities MUST refetch for the new
      // profile. Pre-fix they stayed pinned to the previous profile's
      // values and the dashboard rendered stale data.
      await waitFor(() => expect(result.current.graphs).toEqual(['social']))
      expect(result.current.geodeVersion).toBe('v0.5.19-social')
      expect(graphsMock).toHaveBeenCalledTimes(2)
      expect(capsMock).toHaveBeenCalledTimes(2)
    })

    it('clears the per-graph stats map across a connection change so stale entries cannot leak', async () => {
      graphsMock
        .mockResolvedValueOnce({ graphs: ['movies'] })
        .mockResolvedValueOnce({ graphs: ['social'] })
      capsMock.mockResolvedValue(rawCaps)
      queryMock
        // First pair: movies stats on connection 1.
        .mockResolvedValueOnce({
          columns: [{ name: 'c', type: 'INT' }],
          rows: [[171]],
          row_count: 1,
          elapsed_ms: 1,
        })
        .mockResolvedValueOnce({
          columns: [{ name: 'c', type: 'INT' }],
          rows: [[253]],
          row_count: 1,
          elapsed_ms: 1,
        })
        // Second pair: social stats on connection 2.
        .mockResolvedValueOnce({
          columns: [{ name: 'c', type: 'INT' }],
          rows: [[10_028]],
          row_count: 1,
          elapsed_ms: 1,
        })
        .mockResolvedValueOnce({
          columns: [{ name: 'c', type: 'INT' }],
          rows: [[50_446]],
          row_count: 1,
          elapsed_ms: 1,
        })

      const { result, rerender } = renderHook(() => useOverviewData())
      await waitFor(() => expect(result.current.loading).toBe(false))
      // The auto-load effect fans out stats for the loaded graph list.
      await waitFor(() => expect(result.current.allGraphStats.size).toBe(1))
      expect(result.current.allGraphStats.get('movies')?.nodes).toBe(171)

      // Switch profile.
      useActiveConnectionMock.mockImplementation(() => ({
        connectionId: 'test-conn-2',
        profileName: 'social',
        token: 'tok-social',
        expiresAt: Date.now() + 60_000,
      }))
      rerender()

      // RELEASE-BLOCKER: the prior profile's entries MUST NOT remain
      // visible after the connection changes. Pre-fix the dashboard
      // kept rendering "movies: 171 nodes, 253 edges" under the new
      // profile until the operator manually refreshed.
      await waitFor(() => expect(result.current.graphs).toEqual(['social']))
      await waitFor(() =>
        expect(result.current.allGraphStats.has('movies')).toBe(false)
      )
      await waitFor(() => expect(result.current.allGraphStats.size).toBe(1))
      expect(result.current.allGraphStats.get('social')?.nodes).toBe(10_028)
    })
  })
})
