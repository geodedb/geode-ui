import { seededGraph } from './seededGraph'

describe('seededGraph', () => {
  it('returns the requested node count', () => {
    const { nodes } = seededGraph(100)
    expect(nodes).toHaveLength(100)
  })

  it('is deterministic for the same seed', () => {
    const a = seededGraph(50, 7)
    const b = seededGraph(50, 7)
    expect(a.nodes.map((n) => n.id)).toEqual(b.nodes.map((n) => n.id))
    expect(a.edges).toEqual(b.edges)
  })

  it('produces different outputs for different seeds', () => {
    const a = seededGraph(50, 1)
    const b = seededGraph(50, 2)
    expect(a.edges).not.toEqual(b.edges)
  })

  it('respects expected edge bounds (avg degree ≈ 3, no self-loops)', () => {
    const { nodes, edges } = seededGraph(1000)
    // ~3 edges/node ⇒ ~1500 unique undirected; we keep them directed in
    // the source array but dedupe by (source,target) — call it 1000-1500.
    expect(edges.length).toBeGreaterThanOrEqual(800)
    expect(edges.length).toBeLessThanOrEqual(2000)
    edges.forEach((e) => {
      expect(e.source).not.toBe(e.target)
    })
    const ids = new Set(nodes.map((n) => n.id))
    edges.forEach((e) => {
      expect(ids.has(e.source)).toBe(true)
      expect(ids.has(e.target)).toBe(true)
    })
  })

  it('labels nodes across a few buckets so coloring is exercised', () => {
    const { nodes } = seededGraph(200)
    const labels = new Set(nodes.map((n) => n.label))
    expect(labels.size).toBeGreaterThanOrEqual(3)
    expect(labels.size).toBeLessThanOrEqual(10)
  })
})
