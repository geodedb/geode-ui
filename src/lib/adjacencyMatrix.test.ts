import { extractElements } from './graphResult'
import { buildAdjacencyMatrix, matrixCellKey } from './adjacencyMatrix'

describe('buildAdjacencyMatrix', () => {
  it('counts edges between node-label groups', () => {
    const resp = {
      graph_summary: {
        nodes: [
          { id: 1, labels: ['Person'], properties: {} },
          { id: 2, labels: ['Person'], properties: {} },
          { id: 3, labels: ['Movie'], properties: {} },
          { id: 4, labels: ['Movie'], properties: {} },
        ],
        edges: [
          {
            id: 13,
            start_node: 1,
            end_node: 3,
            type: 'ACTED_IN',
            properties: {},
          },
          {
            id: 14,
            start_node: 1,
            end_node: 4,
            type: 'ACTED_IN',
            properties: {},
          },
          {
            id: 23,
            start_node: 2,
            end_node: 3,
            type: 'DIRECTED',
            properties: {},
          },
        ],
      },
    }
    const m = buildAdjacencyMatrix(extractElements(resp))
    expect(m.labels.slice().sort()).toEqual(['Movie', 'Person'])
    const pm = m.cells.get(matrixCellKey('Person', 'Movie'))
    expect(pm?.count).toBe(3)
    expect(pm?.edgeTypes).toEqual({ ACTED_IN: 2, DIRECTED: 1 })
    // no Movie→Person edges
    expect(m.cells.get(matrixCellKey('Movie', 'Person'))?.count ?? 0).toBe(0)
  })

  it('returns empty labels for a graph with no nodes/edges', () => {
    expect(buildAdjacencyMatrix([]).labels).toEqual([])
  })

  it('ignores synthetic cluster-parent and placeholder nodes', () => {
    // a placeholder node (no labels) must not become a row/col
    const els = extractElements({
      graph_summary: {
        nodes: [{ id: 1, labels: [], properties: {} }],
        edges: [],
      },
    })
    expect(buildAdjacencyMatrix(els).labels).toEqual([])
  })

  it('skips synthetic cluster-parent nodes when resolving edge endpoints', () => {
    // buildAdjacencyMatrix is fed raw ElementDefinition-shaped objects
    // here (not via extractElements) so the cluster-parent guard can be
    // exercised directly. Two edges land on `Person → Movie`: a real one
    // (1 → 2) and one whose source is the synthetic cluster parent
    // (__cluster__:Person → 2). The guard drops the parent's label, so
    // only the real edge counts. Remove the `isClusterParent` guard and
    // the parent resolves to 'Person', making the count 2.
    const els = [
      {
        group: 'nodes',
        data: { id: '1', label: 'Person', labels: ['Person'] },
      },
      {
        group: 'nodes',
        data: {
          id: '__cluster__:Person',
          label: 'Person',
          labels: ['Person'],
          isClusterParent: true,
        },
      },
      { group: 'nodes', data: { id: '2', label: 'Movie', labels: ['Movie'] } },
      {
        group: 'edges',
        data: {
          id: 'e12',
          source: '1',
          target: '2',
          type: 'ACTED_IN',
          label: 'ACTED_IN',
        },
      },
      {
        group: 'edges',
        data: {
          id: 'eP2',
          source: '__cluster__:Person',
          target: '2',
          type: 'GROUPED',
          label: 'GROUPED',
        },
      },
    ] as Parameters<typeof buildAdjacencyMatrix>[0]
    const m = buildAdjacencyMatrix(els)
    // the cluster-parent did not add a phantom label entry
    expect(m.labels).toEqual(['Movie', 'Person'])
    // only the real 1 → 2 edge counts — the eP2 edge is dropped because
    // its source resolves to no label
    expect(m.cells.get(matrixCellKey('Person', 'Movie'))?.count).toBe(1)
    // no cell is keyed off the cluster-parent's id or any phantom label
    expect(m.cells.get(matrixCellKey('__cluster__:Person', 'Movie'))).toBe(
      undefined
    )
    expect(m.cells.size).toBe(1)
  })

  it('does not mutate the input element list', () => {
    const els = extractElements({
      graph_summary: {
        nodes: [
          { id: 1, labels: ['A'], properties: {} },
          { id: 2, labels: ['B'], properties: {} },
        ],
        edges: [
          { id: 12, start_node: 1, end_node: 2, type: 'REL', properties: {} },
        ],
      },
    })
    const snapshot = JSON.stringify(els)
    buildAdjacencyMatrix(els)
    expect(JSON.stringify(els)).toBe(snapshot)
  })
})
