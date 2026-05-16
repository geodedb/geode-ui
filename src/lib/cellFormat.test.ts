/**
 * Q rank 19 / #184: pure unit tests for the cellFormat helpers
 * extracted from src/components/results/TableView.tsx. The TableView
 * test file (TableView.test.tsx) still pins the public formatCell
 * contract end-to-end; this file covers the smaller predicates
 * (isNode / isEdge / isPath / summarizeProps / formatNode /
 * formatEdge / formatPath) directly so a regression at the helper
 * level is caught without a full table render.
 */
import {
  formatCell,
  formatEdge,
  formatNode,
  formatPath,
  isEdge,
  isNode,
  isPath,
  summarizeProps,
} from './cellFormat'

describe('isNode / isEdge / isPath predicates', () => {
  it('isNode accepts canonical node shape', () => {
    expect(
      isNode({ id: 1, labels: ['Person'], properties: { name: 'Alice' } })
    ).toBe(true)
  })

  it('isNode rejects edge-shaped objects (has start_node)', () => {
    expect(
      isNode({
        id: 2,
        start_node: 1,
        end_node: 3,
        type: 'KNOWS',
        properties: {},
        labels: [], // would otherwise pass isNode
      })
    ).toBe(false)
  })

  it('isNode rejects objects missing labels', () => {
    expect(isNode({ id: 1, properties: {} })).toBe(false)
  })

  it('isEdge accepts canonical edge shape', () => {
    expect(
      isEdge({
        id: 2,
        start_node: 1,
        end_node: 3,
        type: 'KNOWS',
        properties: {},
      })
    ).toBe(true)
  })

  it('isEdge rejects nodes (missing start_node/end_node)', () => {
    expect(isEdge({ id: 1, labels: ['Person'], properties: {} })).toBe(false)
  })

  it('isPath accepts canonical path shape', () => {
    expect(isPath({ nodes: [], edges: [] })).toBe(true)
  })

  it('isPath rejects nodes', () => {
    expect(isPath({ id: 1, labels: ['Person'], properties: {} })).toBe(false)
  })
})

describe('summarizeProps', () => {
  it('returns empty string for empty props', () => {
    expect(summarizeProps({})).toBe('')
  })

  it('renders single-key prop bag', () => {
    expect(summarizeProps({ name: 'Alice' })).toBe(" {name: 'Alice'}")
  })

  it('preserves insertion order across keys', () => {
    const out = summarizeProps({ a: 1, b: 2, c: 3 })
    expect(out).toBe(' {a: 1, b: 2, c: 3}')
  })
})

describe('formatNode / formatEdge / formatPath', () => {
  it('formatNode wraps labels with leading colons', () => {
    const s = formatNode({
      id: 1,
      labels: ['Person', 'Actor'],
      properties: { name: 'Alice' },
    })
    expect(s).toBe("(:Person:Actor {name: 'Alice'})")
  })

  it('formatNode emits empty parens for label-less node with no props', () => {
    const s = formatNode({ id: 1, labels: [], properties: {} })
    expect(s).toBe('()')
  })

  it('formatEdge wraps type with leading colon', () => {
    const s = formatEdge({
      id: 2,
      start_node: 1,
      end_node: 3,
      type: 'KNOWS',
      properties: { since: 2020 },
    })
    expect(s).toBe('[:KNOWS {since: 2020}]')
  })

  it('formatPath reports the node/edge counts', () => {
    const s = formatPath({
      nodes: [{ id: 1 }, { id: 2 }],
      edges: [{ id: 3 }],
    })
    expect(s).toBe('<path: 2 nodes, 1 edges>')
  })
})

describe('formatCell dispatch', () => {
  it('returns "" for null / undefined', () => {
    expect(formatCell(null)).toBe('')
    expect(formatCell(undefined)).toBe('')
  })

  it('coerces primitives via String()', () => {
    expect(formatCell(42)).toBe('42')
    expect(formatCell(true)).toBe('true')
    expect(formatCell('alice')).toBe('alice')
  })

  it('arrays go through JSON.stringify', () => {
    expect(formatCell([1, 2, 3])).toBe('[1,2,3]')
  })

  it('node-shaped objects route through formatNode', () => {
    expect(
      formatCell({ id: 1, labels: ['Person'], properties: { name: 'Alice' } })
    ).toBe("(:Person {name: 'Alice'})")
  })

  it('edge-shaped objects route through formatEdge', () => {
    expect(
      formatCell({
        id: 2,
        start_node: 1,
        end_node: 3,
        type: 'KNOWS',
        properties: {},
      })
    ).toBe('[:KNOWS]')
  })

  it('path-shaped objects route through formatPath', () => {
    expect(
      formatCell({
        nodes: [{ id: 1 }, { id: 2 }, { id: 3 }],
        edges: [{ id: 4 }, { id: 5 }],
      })
    ).toBe('<path: 3 nodes, 2 edges>')
  })

  it('generic objects fall through to JSON.stringify', () => {
    expect(formatCell({ foo: 'bar' })).toBe('{"foo":"bar"}')
  })
})
