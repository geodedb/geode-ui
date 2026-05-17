import { collectRealEndpoints } from './collectRealEndpoints'

describe('collectRealEndpoints', () => {
  test('realNodeIds includes every graph_summary node id', () => {
    const { realNodeIds } = collectRealEndpoints(
      [
        { id: 1, labels: ['Person'], properties: {} },
        { id: 2, labels: ['Movie'], properties: {} },
      ],
      undefined
    )
    expect(realNodeIds.has(1)).toBe(true)
    expect(realNodeIds.has(2)).toBe(true)
    expect(realNodeIds.size).toBe(2)
  })

  test('danglingIds collects edge endpoints not present in realNodeIds', () => {
    const { realNodeIds, danglingIds } = collectRealEndpoints(
      [{ id: 1, labels: ['Person'], properties: {} }],
      [
        {
          id: 100,
          start_node: 1,
          end_node: 2,
          type: 'ACTED_IN',
          properties: {},
        },
        {
          id: 101,
          start_node: 3,
          end_node: 4,
          type: 'DIRECTED',
          properties: {},
        },
      ]
    )
    expect(realNodeIds.has(1)).toBe(true)
    expect(danglingIds.has(1)).toBe(false)
    expect(danglingIds.has(2)).toBe(true)
    expect(danglingIds.has(3)).toBe(true)
    expect(danglingIds.has(4)).toBe(true)
  })

  test('both sets are empty when nodes and edges are undefined', () => {
    const { realNodeIds, danglingIds } = collectRealEndpoints(
      undefined,
      undefined
    )
    expect(realNodeIds.size).toBe(0)
    expect(danglingIds.size).toBe(0)
  })

  test('danglingIds is empty when every edge endpoint is in realNodeIds', () => {
    const { danglingIds } = collectRealEndpoints(
      [
        { id: 1, labels: ['A'], properties: {} },
        { id: 2, labels: ['B'], properties: {} },
      ],
      [{ id: 99, start_node: 1, end_node: 2, type: 'REL', properties: {} }]
    )
    expect(danglingIds.size).toBe(0)
  })
})
