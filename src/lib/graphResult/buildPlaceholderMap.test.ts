import { parseMatchAndReturn } from '../matchPattern'
import { buildPlaceholderMap } from './buildPlaceholderMap'

describe('buildPlaceholderMap', () => {
  test('returns empty maps when rows is undefined', () => {
    const { placeholderLabels, placeholderTypeLabels } = buildPlaceholderMap(
      undefined,
      [],
      [],
      new Set(),
      null
    )
    expect(placeholderLabels.size).toBe(0)
    expect(placeholderTypeLabels.size).toBe(0)
  })

  test('returns empty maps when there are no edges', () => {
    const { placeholderLabels } = buildPlaceholderMap(
      [['Alice', 30]],
      [{ name: 'name' }, { name: 'age' }],
      undefined,
      new Set(),
      null
    )
    expect(placeholderLabels.size).toBe(0)
  })

  test('labels placeholder endpoints from a row scalar column named "name"', () => {
    // The row must contain the edge as a column so isEdgeShape() picks
    // it up; the scalar "name" column then provides the label.
    const edge = {
      id: 99,
      start_node: 10,
      end_node: 20,
      type: 'REL',
      properties: {},
    }
    const { placeholderLabels } = buildPlaceholderMap(
      [['Alice', edge]],
      [{ name: 'name' }, { name: 'r' }],
      [edge],
      new Set(),
      null
    )
    expect(placeholderLabels.get(10)).toBe('Alice')
    expect(placeholderLabels.get(20)).toBe('Alice')
  })

  test('with parsed MATCH, labels each placeholder from its own variable', () => {
    // RETURN p.name, r, m.title -- the Person placeholder takes the
    // value of p.name; the Movie placeholder takes m.title. The edge
    // must be in the row so isEdgeShape() can find it; otherwise the
    // helper has no edge to walk for this row.
    const parsed = parseMatchAndReturn(
      'MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p.name, r, m.title'
    )
    const edge = {
      id: 1,
      start_node: 100,
      end_node: 200,
      type: 'ACTED_IN',
      properties: {},
    }
    const { placeholderLabels, placeholderTypeLabels } = buildPlaceholderMap(
      [['Keanu', edge, 'The Matrix']],
      [{ name: 'name' }, { name: 'r' }, { name: 'title' }],
      [edge],
      new Set(),
      parsed
    )
    expect(placeholderLabels.get(100)).toBe('Keanu')
    expect(placeholderLabels.get(200)).toBe('The Matrix')
    // The MATCH-derived GQL labels also surface so the matrix view
    // can group placeholder endpoints.
    expect(placeholderTypeLabels.get(100)).toBe('Person')
    expect(placeholderTypeLabels.get(200)).toBe('Movie')
  })

  test('first-seen wins on label so repeat IDs do not flicker', () => {
    const edge = {
      id: 1,
      start_node: 7,
      end_node: 8,
      type: 'REL',
      properties: {},
    }
    const { placeholderLabels } = buildPlaceholderMap(
      [
        ['first-label', edge],
        ['second-label', edge],
      ],
      [{ name: 'name' }, { name: 'r' }],
      [edge, edge],
      new Set(),
      null
    )
    expect(placeholderLabels.get(7)).toBe('first-label')
  })

  test('endpoints already in realNodeIds are skipped', () => {
    const edge = {
      id: 1,
      start_node: 1,
      end_node: 2,
      type: 'REL',
      properties: {},
    }
    const { placeholderLabels } = buildPlaceholderMap(
      [['Alice', edge]],
      [{ name: 'name' }, { name: 'r' }],
      [edge],
      new Set([1, 2]),
      null
    )
    expect(placeholderLabels.has(1)).toBe(false)
    expect(placeholderLabels.has(2)).toBe(false)
  })
})
