/// <reference types="@testing-library/jest-dom" />
import { act, renderHook } from '@testing-library/react'
import { useGraphActions } from './useGraphActions'
import { client } from '../../../api/client'

jest.mock('../../../api/client', () => ({
  client: { query: jest.fn() },
}))

describe('useGraphActions — onExploreNeighbours with options', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('passes direction + labelFilter + limit into the query statement', async () => {
    const mockQuery = client.query as jest.Mock
    mockQuery.mockResolvedValue({ rows: [], graph_summary: {} })
    const cyRef = {
      current: {
        add: jest.fn(),
        getElementById: () => ({ empty: () => true }),
        layout: () => ({ run: () => {} }),
        fit: () => {},
      } as never,
    }
    const layoutRef = { current: 'cose' as const }
    const queryRef = { current: 'USE GRAPH g;' }
    const { result } = renderHook(() =>
      useGraphActions({
        cyRef: cyRef as never,
        layoutRef: layoutRef as never,
        queryRef: queryRef as never,
        setSelected: jest.fn(),
        setError: jest.fn(),
        t: (k) => k,
      })
    )
    await act(async () => {
      result.current.onExploreNeighbours('42', {
        direction: 'out',
        labelFilter: 'Movie',
        limit: 25,
      })
    })
    expect(client.query).toHaveBeenCalledWith(
      expect.objectContaining({
        statement:
          'MATCH (n)-[r]->(m:Movie) WHERE id(n) = 42 RETURN n, r, m LIMIT 25;',
        graph: 'g',
      })
    )
  })
})

describe('useGraphActions — onHideNode', () => {
  const render = (cy: unknown) => {
    const setSelected = jest.fn()
    const hook = renderHook(() =>
      useGraphActions({
        cyRef: { current: cy } as never,
        layoutRef: { current: 'cose' } as never,
        queryRef: { current: undefined } as never,
        setSelected,
        setError: jest.fn(),
        t: (k) => k,
      })
    )
    return { ...hook, setSelected }
  }

  it('records the hide before the Cytoscape core exists', () => {
    // The inspector can be driven from the keyboard id picker before the
    // debounced build has created a core; the hide must not be dropped.
    const { result, setSelected } = render(null)
    act(() => {
      result.current.onHideNode('117424107931660290')
    })
    expect([...result.current.hidden]).toEqual(['117424107931660290'])
    expect(setSelected).toHaveBeenCalledWith(null)
  })

  it('hides the node on a live core', () => {
    const addClass = jest.fn()
    const { result } = render({ getElementById: () => ({ addClass }) })
    act(() => {
      result.current.onHideNode('7')
    })
    expect(addClass).toHaveBeenCalledWith('hidden-node')
    expect(result.current.hidden.has('7')).toBe(true)
  })
})
