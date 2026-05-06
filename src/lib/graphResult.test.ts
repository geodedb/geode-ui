import { extractElements } from './graphResult'

test('flattens nodes + edges from a query result', () => {
  const resp = {
    columns: [],
    rows: [],
    graph_summary: {
      nodes: [
        { id: 1, labels: ['Person'], properties: { name: 'Alice' } },
        { id: 2, labels: ['Person'], properties: { name: 'Bob' } },
      ],
      edges: [
        { id: 100, start_node: 1, end_node: 2, type: 'KNOWS', properties: { since: 2020 } },
      ],
    },
  }
  const els = extractElements(resp as any)
  expect(els.filter((e) => e.group === 'nodes').length).toBe(2)
  expect(els.filter((e) => e.group === 'edges').length).toBe(1)
  const edge = els.find((e) => e.group === 'edges')!
  expect((edge.data as any).source).toBe('1')
  expect((edge.data as any).target).toBe('2')
})

test('handles empty graph_summary', () => {
  expect(extractElements({} as any)).toEqual([])
  expect(extractElements({ graph_summary: { nodes: [], edges: [] } } as any)).toEqual([])
})
