import { nHopNeighborhood } from './focus'

function makeFakeCy(adj: Record<string, string[]>) {
  const wrap = (
    id: string
  ): {
    id: () => string
    neighborhood: () => {
      nodes: () => Array<{ id: () => string }>
      forEach: (cb: (n: { id: () => string }) => void) => void
    }
    empty: () => boolean
  } => ({
    id: () => id,
    neighborhood: () => {
      const ns = (adj[id] ?? []).map((n) => wrap(n))
      return {
        nodes: () => ns,
        forEach: (cb: (n: { id: () => string }) => void) => ns.forEach(cb),
      }
    },
    empty: () => false,
  })
  return {
    getElementById: (id: string) => wrap(id),
  }
}

describe('nHopNeighborhood', () => {
  it('returns the node itself for n=0', () => {
    const cy = makeFakeCy({ a: ['b'], b: ['a'] })
    expect(nHopNeighborhood(cy as never, 'a', 0)).toEqual(new Set(['a']))
  })

  it('returns 1-hop for n=1', () => {
    const cy = makeFakeCy({ a: ['b', 'c'], b: ['a'], c: ['a', 'd'], d: ['c'] })
    expect(nHopNeighborhood(cy as never, 'a', 1)).toEqual(
      new Set(['a', 'b', 'c'])
    )
  })

  it('returns 2-hop for n=2', () => {
    const cy = makeFakeCy({
      a: ['b'],
      b: ['a', 'c'],
      c: ['b', 'd'],
      d: ['c'],
    })
    expect(nHopNeighborhood(cy as never, 'a', 2)).toEqual(
      new Set(['a', 'b', 'c'])
    )
  })

  it('returns empty Set when the start node is missing', () => {
    const cy = {
      getElementById: () => ({
        empty: () => true,
        neighborhood: () => ({
          nodes: () => [],
          forEach: () => {},
        }),
        id: () => '',
      }),
    }
    expect(nHopNeighborhood(cy as never, 'ghost', 1)).toEqual(new Set())
  })

  it('handles a negative hop count as 0', () => {
    const cy = makeFakeCy({ a: ['b'], b: ['a'] })
    expect(nHopNeighborhood(cy as never, 'a', -3)).toEqual(new Set(['a']))
  })
})
