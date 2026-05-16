import { extractElements } from './graphResult'
import {
  applyMatrixBudget,
  buildAdjacencyMatrix,
  DEFAULT_MATRIX_LABEL_BUDGET,
  matrixCellKey,
} from './adjacencyMatrix'

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

describe('applyMatrixBudget', () => {
  // Build a matrix with N labels and pairwise edges; label `Lk` participates
  // in `k+1` edges (linear ramp) so the degree-ranked tail is predictable.
  function ramp(n: number): {
    labels: string[]
    cells: Map<string, { count: number; edgeTypes: Record<string, number> }>
  } {
    const labels = Array.from(
      { length: n },
      (_, i) => `L${String(i).padStart(3, '0')}`
    )
    const cells = new Map<
      string,
      { count: number; edgeTypes: Record<string, number> }
    >()
    labels.forEach((row, ri) => {
      // ri+1 outgoing edges, all directed L{ri} → L{(ri+1) % n}
      for (let k = 0; k <= ri; k += 1) {
        const col = labels[(ri + k + 1) % n]!
        const key = matrixCellKey(row, col)
        const existing = cells.get(key)
        if (existing) {
          existing.count += 1
          existing.edgeTypes.REL = (existing.edgeTypes.REL ?? 0) + 1
        } else {
          cells.set(key, { count: 1, edgeTypes: { REL: 1 } })
        }
      }
    })
    return { labels, cells }
  }

  it('returns labels unchanged when budget >= labels.length', () => {
    const m = ramp(5)
    const r = applyMatrixBudget(m, 10)
    expect(r.labels).toEqual(m.labels)
    expect(r.hiddenLabels).toEqual([])
    expect(r.hiddenEdges).toBe(0)
  })

  it('returns labels unchanged when budget is 0 (cap disabled)', () => {
    const m = ramp(100)
    const r = applyMatrixBudget(m, 0)
    expect(r.labels).toEqual(m.labels)
    expect(r.hiddenLabels).toEqual([])
  })

  it('keeps the budget × budget densest cells when labels exceed the budget', () => {
    // 80 labels, budget = 60 → 20 dropped. The ramp gives `Lk` an
    // outgoing degree of k+1, so the lowest-degree labels (low indices)
    // are the ones with the fewest total edges and should be dropped.
    const m = ramp(80)
    const r = applyMatrixBudget(m, 60)
    expect(r.labels).toHaveLength(60)
    expect(r.hiddenLabels).toHaveLength(20)
    // The ramp is monotone in outgoing degree (Lk emits k+1 edges), so
    // the dropped set should be biased toward low-index labels. Allow
    // a small overlap from rotation-induced incoming-edge ties — the
    // important property is that the average dropped index is far
    // below the average kept index.
    const avg = (xs: number[]): number =>
      xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
    const avgKept = avg(r.labels.map((l) => Number(l.slice(1))))
    const avgHidden = avg(r.hiddenLabels.map((l) => Number(l.slice(1))))
    expect(avgHidden).toBeLessThan(avgKept)
    // The kept labels are still alpha-sorted so render order matches
    // the un-budgeted code path.
    const keptSorted = r.labels.slice().sort()
    expect(r.labels).toEqual(keptSorted)
  })

  it('reports hiddenEdges as the count of edges touching dropped labels', () => {
    // 3 labels: A→B (1 edge), B→A (5 edges), C→A (10 edges). Budget = 2
    // drops the lowest-degree label (A: 1+5+10 = 16, B: 1+5 = 6, C: 10 = 10).
    // Wait — A has highest degree. So budget=2 drops B (deg 6, lowest).
    // The hidden edges are B→A (5) + A→B (1) = 6.
    const cells = new Map<
      string,
      { count: number; edgeTypes: Record<string, number> }
    >()
    cells.set(matrixCellKey('A', 'B'), { count: 1, edgeTypes: { R: 1 } })
    cells.set(matrixCellKey('B', 'A'), { count: 5, edgeTypes: { R: 5 } })
    cells.set(matrixCellKey('C', 'A'), { count: 10, edgeTypes: { R: 10 } })
    const m = { labels: ['A', 'B', 'C'], cells }
    const r = applyMatrixBudget(m, 2)
    expect(r.labels).toEqual(['A', 'C'])
    expect(r.hiddenLabels).toEqual(['B'])
    expect(r.hiddenEdges).toBe(6)
  })

  it('uses alpha order as the tiebreaker when degrees are equal', () => {
    // Five labels with identical degree (1 each). Budget = 3 keeps A,B,C.
    const labels = ['E', 'D', 'C', 'B', 'A']
    const cells = new Map<
      string,
      { count: number; edgeTypes: Record<string, number> }
    >()
    labels.forEach((l) =>
      cells.set(matrixCellKey(l, l), { count: 1, edgeTypes: { R: 1 } })
    )
    const sorted = labels.slice().sort()
    const r = applyMatrixBudget({ labels: sorted, cells }, 3)
    expect(r.labels).toEqual(['A', 'B', 'C'])
    expect(r.hiddenLabels).toEqual(['D', 'E'])
  })

  it('exposes a default budget at 60', () => {
    expect(DEFAULT_MATRIX_LABEL_BUDGET).toBe(60)
  })

  // PERF #216 micro-bench: label-count scaling. Build a 200×200 matrix
  // (40k potential cells) and confirm applyMatrixBudget completes in
  // well under one frame. This is a regression gate — if a future change
  // adds an O(L²) path on the budget side, the assertion fires.
  it('handles 200 labels in < 50 ms (regression gate)', () => {
    const m = ramp(200)
    const t0 = performance.now()
    const r = applyMatrixBudget(m, 60)
    const dt = performance.now() - t0
    expect(r.labels).toHaveLength(60)
    expect(dt).toBeLessThan(50)
  })
})
