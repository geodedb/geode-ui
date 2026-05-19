import type { ElementDefinition } from 'cytoscape'
import {
  pushPlaceholderNodes,
  pushRealEdges,
  pushRealNodes,
} from './pushRealElements'

describe('pushRealNodes', () => {
  test('emits one element per node with id, label, labels, props', () => {
    const out: ElementDefinition[] = []
    pushRealNodes(out, [
      { id: 1, labels: ['Person'], properties: { name: 'Alice' } },
      { id: 2, labels: ['Movie', 'Film'], properties: { title: 'X' } },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      group: 'nodes',
      data: {
        id: '1',
        label: 'Person',
        labels: ['Person'],
        // nodeType is the immutable color seed — stamped at extract
        // time so cyHelpers.applyLabels can mutate `label` for display
        // without reshuffling the canvas palette. See colorBinding.test
        // for the contract.
        nodeType: 'Person',
        props: { name: 'Alice' },
      },
    })
    expect(out[1]?.data).toMatchObject({ id: '2', label: 'Movie' })
  })

  test('defaults label to "Node" when labels array is empty', () => {
    const out: ElementDefinition[] = []
    pushRealNodes(out, [{ id: 1, labels: [], properties: {} }])
    expect((out[0]?.data as Record<string, unknown>).label).toBe('Node')
  })

  test('no-op when nodes is undefined', () => {
    const out: ElementDefinition[] = []
    pushRealNodes(out, undefined)
    expect(out).toHaveLength(0)
  })
})

describe('pushPlaceholderNodes', () => {
  test('emits one stub per dangling endpoint with placeholder:true', () => {
    const out: ElementDefinition[] = []
    pushPlaceholderNodes(
      out,
      new Set([10, 20]),
      new Map([
        [10, 'Alice'],
        [20, 'Bob'],
      ]),
      new Map([
        [10, 'Person'],
        [20, 'Person'],
      ])
    )
    expect(out).toHaveLength(2)
    out.forEach((el) =>
      expect((el.data as Record<string, unknown>).placeholder).toBe(true)
    )
  })

  test('falls back to #id label when no scalar label is known', () => {
    const out: ElementDefinition[] = []
    pushPlaceholderNodes(out, new Set([42]), new Map(), new Map())
    expect((out[0]?.data as Record<string, unknown>).label).toBe('#42')
  })

  test('omits labels[] entry when no MATCH-derived type label exists', () => {
    const out: ElementDefinition[] = []
    pushPlaceholderNodes(out, new Set([5]), new Map([[5, 'lbl']]), new Map())
    expect((out[0]?.data as Record<string, unknown>).labels).toEqual([])
  })
})

describe('pushRealEdges', () => {
  test('emits one element per edge with id, source, target, type, label, props', () => {
    const out: ElementDefinition[] = []
    pushRealEdges(out, [
      {
        id: 99,
        start_node: 1,
        end_node: 2,
        type: 'ACTED_IN',
        properties: { role: 'Lead' },
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      group: 'edges',
      data: {
        id: 'e99',
        source: '1',
        target: '2',
        type: 'ACTED_IN',
        label: 'ACTED_IN',
        // edgeType is the immutable color seed for edges — see
        // colorBinding.test for the contract.
        edgeType: 'ACTED_IN',
        props: { role: 'Lead' },
      },
    })
  })

  test('no-op when edges is undefined', () => {
    const out: ElementDefinition[] = []
    pushRealEdges(out, undefined)
    expect(out).toHaveLength(0)
  })
})

describe('pushRealEdges — property pass-through (regression for inspector "no props")', () => {
  it('preserves an edge with two custom properties on data.props', () => {
    const out: ElementDefinition[] = []
    pushRealEdges(out, [
      {
        id: 1,
        start_node: 1,
        end_node: 2,
        type: 'ACTED_IN',
        properties: { roles: ['Neo'], year: 1999 },
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.data?.props).toEqual({ roles: ['Neo'], year: 1999 })
  })

  it('defaults data.props to an empty object when properties is missing', () => {
    const out: ElementDefinition[] = []
    pushRealEdges(out, [
      {
        id: 2,
        start_node: 1,
        end_node: 2,
        type: 'DIRECTED',
        properties: undefined as unknown as Record<string, unknown>,
      },
    ])
    expect(out[0]?.data?.props).toEqual({})
  })
})
