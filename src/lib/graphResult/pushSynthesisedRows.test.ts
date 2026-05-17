import type { ElementDefinition } from 'cytoscape'
import { parseMatchAndReturn } from '../matchPattern'
import { pushSynthesisedRows } from './pushSynthesisedRows'

describe('pushSynthesisedRows', () => {
  test('synthesises nodes + edges from a scalar-only RETURN', () => {
    const parsed = parseMatchAndReturn(
      'MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p.name, r.role, m.title'
    )
    const rows = [
      ['Keanu', 'Neo', 'The Matrix'],
      ['Carrie-Anne', 'Trinity', 'The Matrix'],
    ]
    const out: ElementDefinition[] = []
    pushSynthesisedRows(out, parsed, rows)
    const nodes = out.filter((e) => e.group === 'nodes')
    const edges = out.filter((e) => e.group === 'edges')
    // Two distinct Persons + one Movie = 3 nodes.
    expect(nodes).toHaveLength(3)
    // Two ACTED_IN edges (one per row).
    expect(edges).toHaveLength(2)
    // All synthesised elements carry the flag.
    out.forEach((el) =>
      expect((el.data as Record<string, unknown>).synthesised).toBe(true)
    )
  })

  test('node identity prefers a field literally named id', () => {
    const parsed = parseMatchAndReturn('MATCH (p:Person) RETURN p.id, p.name')
    const rows = [
      [1, 'Alice'],
      [1, 'Alice-renamed'], // same id, different name
      [2, 'Bob'],
    ]
    const out: ElementDefinition[] = []
    pushSynthesisedRows(out, parsed, rows)
    const nodes = out.filter((e) => e.group === 'nodes')
    // The first row sets Alice -> id=1; the second row's name is
    // ignored because props merge never overwrites existing values.
    expect(nodes).toHaveLength(2)
  })

  test('no-op when parsed.nodes and parsed.edges are both empty', () => {
    // A query with no MATCH variables (e.g. RETURN 1) yields a parsed
    // result with no nodes/edges; nothing should be pushed.
    const parsed = parseMatchAndReturn('RETURN 1')
    const out: ElementDefinition[] = []
    pushSynthesisedRows(out, parsed, [[1]])
    expect(out).toHaveLength(0)
  })

  test('mints unique synthetic edge ids per (row, binding)', () => {
    const parsed = parseMatchAndReturn(
      'MATCH (p:Person)-[r:KNOWS]->(q:Person) RETURN p.id, q.id'
    )
    const rows = [
      [1, 2],
      [2, 3],
    ]
    const out: ElementDefinition[] = []
    pushSynthesisedRows(out, parsed, rows)
    const edges = out.filter((e) => e.group === 'edges')
    const ids = new Set(
      edges.map((e) => (e.data as Record<string, unknown>).id)
    )
    expect(ids.size).toBe(edges.length)
  })
})
