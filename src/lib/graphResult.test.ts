import {
  EDGE_TYPE_DEFAULT,
  NODE_LABEL_DEFAULT,
  buildCompoundElements,
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

test('labels each edge endpoint from its own variable scalar (not the "name" column)', () => {
  // Reported bug: with
  //   MATCH (p:Person)-[r:ACTED_IN]->(m:Movie)
  //   RETURN p.name, r, m.title LIMIT 25
  // both endpoints are placeholders (only r is a full EDGE column;
  // p and m are scalars). The old code picked the column literally
  // named "name" for *both* endpoints, so the Movie node showed the
  // actor's name. With the MATCH/RETURN parse, start_node should
  // take p.name and end_node should take m.title.
  const personId = 901
  const movieId = 902
  const resp = {
    columns: [
      { name: 'name', type: 'STRING' },
      { name: 'r', type: 'EDGE' },
      { name: 'title', type: 'STRING' },
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
        'The Matrix',
      ],
    ],
    graph_summary: {
      nodes: [],
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
  const els = extractElements(
    resp as any,
    'USE GRAPH movies; MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p.name, r, m.title LIMIT 25'
  )
  const person = els.find(
    (e) => e.group === 'nodes' && (e.data as any).id === String(personId)
  )
  const movie = els.find(
    (e) => e.group === 'nodes' && (e.data as any).id === String(movieId)
  )
  expect((person!.data as any).label).toBe('Keanu Reeves')
  expect((movie!.data as any).label).toBe('The Matrix')
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

test('synthesises full graph from MATCH pattern when only scalars are returned', () => {
  // Reproduces the user-reported case:
  //   MATCH (p:Person)-[r:ACTED_IN]->(m:Movie)
  //   RETURN p.name, r.roles, m.title
  // Geode emits empty graph_summary because no NODE/EDGE columns
  // were projected. With the query string available, extractElements
  // must rebuild the (Person)-[ACTED_IN]->(Movie) shape from each row.
  const query =
    'USE GRAPH movies; MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p.name, r.roles, m.title LIMIT 3'
  const resp = {
    columns: [
      { name: 'name', type: 'STRING' },
      { name: 'roles', type: 'STRING' },
      { name: 'title', type: 'STRING' },
    ],
    rows: [
      ['Keanu Reeves', 'Neo', 'The Matrix'],
      ['Keanu Reeves', 'Neo', 'The Matrix Reloaded'],
      ['Carrie-Anne Moss', 'Trinity', 'The Matrix'],
    ],
    graph_summary: { nodes: [], edges: [] },
  }
  const els = extractElements(resp as any, query)
  const personNodes = els.filter(
    (e) =>
      e.group === 'nodes' &&
      Array.isArray((e.data as any).labels) &&
      (e.data as any).labels[0] === 'Person'
  )
  const movieNodes = els.filter(
    (e) =>
      e.group === 'nodes' &&
      Array.isArray((e.data as any).labels) &&
      (e.data as any).labels[0] === 'Movie'
  )
  const edgeEls = els.filter((e) => e.group === 'edges')

  // Two distinct Persons (Keanu, Carrie-Anne) — the duplicate row
  // pointing to a second movie does NOT produce a second Person.
  expect(personNodes.length).toBe(2)
  expect(personNodes.map((n) => (n.data as any).label).sort()).toEqual([
    'Carrie-Anne Moss',
    'Keanu Reeves',
  ])

  // Two distinct Movies.
  expect(movieNodes.length).toBe(2)
  expect(movieNodes.map((n) => (n.data as any).label).sort()).toEqual([
    'The Matrix',
    'The Matrix Reloaded',
  ])

  // Three edges (one per row), each with type ACTED_IN and the
  // user-projected role as the default label.
  expect(edgeEls.length).toBe(3)
  edgeEls.forEach((e) => {
    expect((e.data as any).type).toBe('ACTED_IN')
  })
  // Edge label defaults to the single projected property value.
  expect(edgeEls.map((e) => (e.data as any).label).sort()).toEqual([
    'Neo',
    'Neo',
    'Trinity',
  ])

  // Source/target ordering matches the MATCH pattern direction
  // (Person -> Movie).
  edgeEls.forEach((e) => {
    expect(String((e.data as any).source)).toMatch(/^p:/)
    expect(String((e.data as any).target)).toMatch(/^m:/)
  })
})

test('synthesised path falls back to graph_summary when both available', () => {
  // If the response already contains graph_summary entries, do NOT
  // synthesise — the real summary wins.
  const query =
    'MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p.name, r, m LIMIT 1'
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
          id: 1,
          start_node: 100,
          end_node: 7,
          type: 'ACTED_IN',
          properties: {},
        },
        { id: 7, labels: ['Movie'], properties: { title: 'The Matrix' } },
      ],
    ],
    graph_summary: {
      nodes: [
        { id: 7, labels: ['Movie'], properties: { title: 'The Matrix' } },
      ],
      edges: [
        {
          id: 1,
          start_node: 100,
          end_node: 7,
          type: 'ACTED_IN',
          properties: {},
        },
      ],
    },
  }
  const els = extractElements(resp as any, query)
  // Real Movie node id=7 + placeholder for id=100 + 1 real edge.
  expect(els.filter((e) => e.group === 'nodes').length).toBe(2)
  expect(els.filter((e) => e.group === 'edges').length).toBe(1)
  // No synthesised:true elements when graph_summary carried the data.
  expect(els.some((e) => (e.data as any).synthesised === true)).toBe(false)
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

// ------------------------------------------------------------------
// Phase 1 / Task 1.4 — group-by-label clustering (compound parents).
// ------------------------------------------------------------------
describe('buildCompoundElements', () => {
  it('wraps nodes in a per-label parent and reparents them', () => {
    const resp = {
      graph_summary: {
        nodes: [
          { id: 1, labels: ['Person'], properties: { name: 'A' } },
          { id: 2, labels: ['Person'], properties: { name: 'B' } },
          { id: 3, labels: ['Company'], properties: { name: 'C' } },
        ],
        edges: [
          {
            id: 10,
            start_node: 1,
            end_node: 3,
            type: 'WORKS_AT',
            properties: {},
          },
        ],
      },
    }
    const els = extractElements(resp as any)
    const compound = buildCompoundElements(els)
    const parents = compound.filter(
      (e) => e.data && (e.data as Record<string, unknown>).isClusterParent
    )
    expect(
      parents.map((p) => (p.data as { label?: string }).label).sort()
    ).toEqual(['Company', 'Person'])
    // Parents are non-interactive.
    parents.forEach((p) => {
      expect(p.selectable).toBe(false)
      expect(p.grabbable).toBe(false)
    })
    // Each original Person node now has a parent pointing at the cluster.
    const personNodes = compound.filter(
      (e) =>
        e.group !== 'edges' &&
        (e.data as { labels?: string[] }).labels?.[0] === 'Person'
    )
    expect(personNodes.length).toBe(2)
    personNodes.forEach((n) => {
      expect((n.data as { parent?: string }).parent).toBe('__cluster__:Person')
    })
    // Edges are unchanged in count.
    expect(compound.filter((e) => e.group === 'edges').length).toBe(1)
    // Pure: the input array is not mutated.
    expect(els.every((e) => !(e.data as Record<string, unknown>)?.parent)).toBe(
      true
    )
  })

  it('adds no parent nodes when every node lacks a label', () => {
    const els = extractElements({
      graph_summary: {
        nodes: [{ id: 1, labels: [], properties: {} }],
        edges: [],
      },
    } as any)
    const out = buildCompoundElements(els)
    expect(
      out.filter(
        (e) => (e.data as Record<string, unknown> | undefined)?.isClusterParent
      )
    ).toHaveLength(0)
    // The lone node is returned untouched (no synthetic parent).
    expect(
      out.filter((e) => (e.data as Record<string, unknown> | undefined)?.parent)
    ).toHaveLength(0)
  })

  it('leaves a node with a pre-set data.parent alone', () => {
    const els = extractElements({
      graph_summary: {
        nodes: [{ id: 1, labels: ['Person'], properties: {} }],
        edges: [],
      },
    } as any)
    // Simulate a caller-set parent.
    const firstData = els[0]?.data as Record<string, unknown>
    firstData.parent = 'manual-parent'
    const out = buildCompoundElements(els)
    const node = out.find((e) => (e.data as { id?: string }).id === '1')
    expect((node?.data as { parent?: string }).parent).toBe('manual-parent')
    // No cluster parent minted for that label since the node was skipped.
    expect(
      out.filter(
        (e) => (e.data as Record<string, unknown> | undefined)?.isClusterParent
      )
    ).toHaveLength(0)
  })
})
