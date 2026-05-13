import { renderHook } from '@testing-library/react'
import { useGraphElements } from './useGraphElements'

describe('useGraphElements — degree stamp', () => {
  const resp = {
    columns: [{ name: 'n' }, { name: 'r' }, { name: 'm' }],
    rows: [],
    graph_summary: {
      nodes: [
        { id: 1, labels: ['Person'], properties: { name: 'A' } },
        { id: 2, labels: ['Person'], properties: { name: 'B' } },
        { id: 3, labels: ['Movie'], properties: { title: 'X' } },
      ],
      edges: [
        { id: 10, start_node: 1, end_node: 2, type: 'KNOWS', properties: {} },
        {
          id: 11,
          start_node: 1,
          end_node: 3,
          type: 'ACTED_IN',
          properties: {},
        },
      ],
    },
  }

  it('stamps data.degree and data.size on each node', () => {
    const { result } = renderHook(() =>
      useGraphElements({ resp, clusterByLabel: false })
    )
    const nodes = result.current.baseEls.filter(
      (e) => (e.data as { source?: unknown }).source === undefined
    )
    const byId = new Map(
      nodes.map((n) => [
        String((n.data as { id: unknown }).id),
        n.data as Record<string, unknown>,
      ])
    )
    expect(byId.get('1')?.degree).toBe(2)
    expect(byId.get('2')?.degree).toBe(1)
    expect(byId.get('3')?.degree).toBe(1)
    expect(typeof byId.get('1')?.size).toBe('number')
    expect(byId.get('1')?.size as number).toBeGreaterThan(
      byId.get('3')?.size as number
    )
  })
})
