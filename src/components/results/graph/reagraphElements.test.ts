import { toReagraphElements } from './reagraphElements'
import type { ElementDefinition } from 'cytoscape'

const variant = 'light' as const

describe('toReagraphElements', () => {
  it('returns empty arrays for empty input', () => {
    const { nodes, edges } = toReagraphElements([], variant)
    expect(nodes).toEqual([])
    expect(edges).toEqual([])
  })

  it('projects a simple two-node one-edge cytoscape shape', () => {
    const els: ElementDefinition[] = [
      { data: { id: 'a', label: 'Person', name: 'Alice' } },
      { data: { id: 'b', label: 'Person', name: 'Bob' } },
      { data: { id: 'a->b', source: 'a', target: 'b', type: 'KNOWS' } },
    ]
    const { nodes, edges } = toReagraphElements(els, variant)
    expect(nodes).toHaveLength(2)
    expect(edges).toHaveLength(1)
    expect(nodes[0]).toMatchObject({
      id: 'a',
      label: 'Person',
      data: { name: 'Alice' },
    })
    expect(nodes[0]!.fill).toMatch(/^#[0-9a-f]{6}$/i)
    expect(edges[0]).toMatchObject({
      id: 'a->b',
      source: 'a',
      target: 'b',
      label: 'KNOWS',
    })
  })

  it('coerces array-shaped labels to their first string', () => {
    const els: ElementDefinition[] = [
      { data: { id: 'x', label: ['Movie', 'Film'] } },
    ]
    const { nodes } = toReagraphElements(els, variant)
    expect(nodes[0]!.label).toBe('Movie')
  })

  it('drops elements with missing/empty id (defensive)', () => {
    const els: ElementDefinition[] = [
      { data: { id: '', label: 'X' } },
      { data: { source: 'a', target: 'b' } },
    ]
    const { nodes, edges } = toReagraphElements(els, variant)
    expect(nodes).toHaveLength(0)
    expect(edges).toHaveLength(0)
  })

  it('uses labelToColor so fills match the cytoscape palette exactly', async () => {
    const { labelToColor } = await import('../cytoscapeStyle')
    const els: ElementDefinition[] = [{ data: { id: 'a', label: 'Person' } }]
    const { nodes } = toReagraphElements(els, variant)
    expect(nodes[0]!.fill).toBe(labelToColor('Person', variant))
  })
})
