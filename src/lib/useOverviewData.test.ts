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
import { useOverviewData } from './useOverviewData'

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
})
