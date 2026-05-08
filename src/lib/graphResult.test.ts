import {
  EDGE_TYPE_DEFAULT,
  NODE_LABEL_DEFAULT,
  extractElements,
  labelOptions,
  resolveEdgeLabel,
  resolveNodeLabel,
  typeOptions,
} from './graphResult'

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

test('labelOptions surfaces property keys per node label', () => {
  const els = extractElements({
    columns: [{ name: 'm', type: 'NODE' }],
    rows: [],
    graph_summary: {
      nodes: [
        {
          id: 1,
          labels: ['Movie'],
          properties: { title: 'X', released: 2000, tagline: 'Y' },
        },
        { id: 2, labels: ['Movie'], properties: { title: 'Z' } },
        { id: 3, labels: ['Person'], properties: { name: 'A', born: 1970 } },
      ],
      edges: [],
    },
  } as any)
  const opts = labelOptions(els)
  expect(opts.get('Movie')?.[0]).toBe(NODE_LABEL_DEFAULT)
  expect(opts.get('Movie')?.slice(1)).toEqual(['released', 'tagline', 'title'])
  expect(opts.get('Person')?.[0]).toBe(NODE_LABEL_DEFAULT)
  expect(opts.get('Person')?.slice(1)).toEqual(['born', 'name'])
})

test('typeOptions surfaces property keys per edge type', () => {
  const els = extractElements({
    columns: [{ name: 'r', type: 'EDGE' }],
    rows: [],
    graph_summary: {
      nodes: [],
      edges: [
        {
          id: 1,
          start_node: 1,
          end_node: 2,
          type: 'ACTED_IN',
          properties: { roles: 'Neo' },
        },
        {
          id: 2,
          start_node: 3,
          end_node: 4,
          type: 'ACTED_IN',
          properties: { roles: 'Trinity', credit: 'lead' },
        },
        {
          id: 3,
          start_node: 5,
          end_node: 6,
          type: 'DIRECTED',
          properties: {},
        },
      ],
    },
  } as any)
  const opts = typeOptions(els)
  expect(opts.get('ACTED_IN')?.[0]).toBe(EDGE_TYPE_DEFAULT)
  expect(opts.get('ACTED_IN')?.slice(1)).toEqual(['credit', 'roles'])
  expect(opts.get('DIRECTED')).toEqual([EDGE_TYPE_DEFAULT])
})

test('resolveNodeLabel uses chosen property when set, falls back to label', () => {
  const data = {
    id: '1',
    labels: ['Movie'],
    label: 'Movie',
    props: { title: 'The Matrix', released: 1999 },
  }
  expect(resolveNodeLabel(data, {})).toBe('Movie')
  expect(resolveNodeLabel(data, { Movie: 'title' })).toBe('The Matrix')
  expect(resolveNodeLabel(data, { Movie: 'released' })).toBe('1999')
  // Missing property falls back to data.label.
  expect(resolveNodeLabel(data, { Movie: 'nope' })).toBe('Movie')
})

test('resolveNodeLabel preserves placeholder labels when no pref', () => {
  // Synthesised placeholder: empty labels array, label = scalar from row.
  const placeholder = {
    id: '999',
    labels: [],
    label: 'Keanu Reeves',
    props: {},
    placeholder: true,
  }
  expect(resolveNodeLabel(placeholder, {})).toBe('Keanu Reeves')
  // No labels means no key in the prefs map, so prefs are ignored.
  expect(resolveNodeLabel(placeholder, { Movie: 'title' })).toBe('Keanu Reeves')
})

test('resolveEdgeLabel uses chosen property when set, falls back to type', () => {
  const data = {
    id: 'e1',
    type: 'ACTED_IN',
    label: 'ACTED_IN',
    props: { roles: 'Neo' },
  }
  expect(resolveEdgeLabel(data, {})).toBe('ACTED_IN')
  expect(resolveEdgeLabel(data, { ACTED_IN: 'roles' })).toBe('Neo')
  expect(resolveEdgeLabel(data, { ACTED_IN: 'missing' })).toBe('ACTED_IN')
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
