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
} from './useOverviewData'

// fetchCapabilities (src/api/capabilities.ts) internally calls
// client.getCapabilities({}) and normalises the raw {geode_version,
// admin_writable} response, so the mock above resolves the *raw* shape and
// fetchCapabilities does the narrowing into {geodeVersion, adminWritable}.
const rawCaps = {
  geode_version: 'v0.5.11',
  admin_writable: {
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

  it('loadStats cache entry expires after the TTL', async () => {
    graphsMock.mockResolvedValue({ graphs: ['default'] })
    capsMock.mockResolvedValue(rawCaps)
    const originalTTL = testOnlyGetGraphStatsCacheTTL()
    testOnlySetGraphStatsCacheTTL(10) // 10ms for fast test
    try {
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
      act(() => result.current.loadStats('default'))
      await waitFor(() => expect(result.current.statsLoading).toBe(false))
      expect(queryMock).toHaveBeenCalledTimes(2)

      // Wait past the TTL.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 30)
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
})
