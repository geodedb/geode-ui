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
        {
          id: 100,
          start_node: 1,
          end_node: 2,
          type: 'KNOWS',
          properties: { since: 2020 },
        },
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
  expect(
    extractElements({ graph_summary: { nodes: [], edges: [] } } as any)
  ).toEqual([])
})

test('synthesises placeholder nodes for projected scalars', () => {
  // Reproduces the reported regression: query is
  //   MATCH (p:Person)-[r:ACTED_IN]->(m:Movie)
  //   RETURN p.name AS name, r, m
  // graph_summary contains only the Movie nodes (because m is the
  // only NODE column); each edge's start_node references a Person ID
  // that isn't in graph_summary.nodes. extractElements must
  // synthesise a placeholder for that ID and label it from the
  // matching scalar column ("name").
  const personId = 999
  const movieId = 7
  const resp = {
    columns: [
      { name: 'name', type: 'STRING' },
      { name: 'r', type: 'EDGE' },
      { name: 'm', type: 'NODE' },
    ],
    rows: [
      [
        'Keanu Reeves',
        {
          id: 100,
          start_node: personId,
          end_node: movieId,
          type: 'ACTED_IN',
          properties: { roles: 'Neo' },
        },
        {
          id: movieId,
          labels: ['Movie'],
          properties: { title: 'The Matrix' },
        },
      ],
    ],
    graph_summary: {
      nodes: [
        { id: movieId, labels: ['Movie'], properties: { title: 'The Matrix' } },
      ],
      edges: [
        {
          id: 100,
          start_node: personId,
          end_node: movieId,
          type: 'ACTED_IN',
          properties: { roles: 'Neo' },
        },
      ],
    },
  }
  const els = extractElements(resp as any)
  const placeholder = els.find(
    (e) => e.group === 'nodes' && (e.data as any).id === String(personId)
  )
  expect(placeholder).toBeDefined()
  expect((placeholder!.data as any).label).toBe('Keanu Reeves')
  expect((placeholder!.data as any).placeholder).toBe(true)
  // Edge should still be present and its source/target stringified.
  const edge = els.find((e) => e.group === 'edges')!
  expect((edge.data as any).source).toBe(String(personId))
  expect((edge.data as any).target).toBe(String(movieId))
  // Edge label exposed for cytoscape rendering.
  expect((edge.data as any).label).toBe('ACTED_IN')
})

test('falls back to placeholder #id when no scalar column is available', () => {
  // Edge endpoint isn't in graph_summary.nodes AND no scalar column
  // exists in the row to label it with. Must still emit a stub so
  // cytoscape doesn't drop the edge.
  const resp = {
    columns: [{ name: 'r', type: 'EDGE' }],
    rows: [
      [
        {
          id: 1,
          start_node: 42,
          end_node: 43,
          type: 'KNOWS',
          properties: {},
        },
      ],
    ],
    graph_summary: {
      nodes: [],
      edges: [
        { id: 1, start_node: 42, end_node: 43, type: 'KNOWS', properties: {} },
      ],
    },
  }
  const els = extractElements(resp as any)
  const stubs = els.filter(
    (e) => e.group === 'nodes' && (e.data as any).placeholder === true
  )
  expect(stubs.length).toBe(2)
  expect((stubs[0]?.data as any).label).toMatch(/^#\d+$/)
})
