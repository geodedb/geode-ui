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
