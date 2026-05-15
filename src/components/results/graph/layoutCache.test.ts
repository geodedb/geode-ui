import { createLayoutCache } from './layoutCache'

describe('layoutCache', () => {
  it('get(miss) returns { hit: "miss" }', () => {
    const c = createLayoutCache(4)
    expect(c.get('A').hit).toBe('miss')
  })

  it('set + get(hit) round-trips a position map', () => {
    const c = createLayoutCache(4)
    const pos = new Map([
      ['a', { x: 1, y: 2 }],
      ['b', { x: 3, y: 4 }],
    ])
    c.set('A', pos)
    const got = c.get('A')
    expect(got.hit).toBe('full')
    expect(got.positions?.size).toBe(2)
    expect(got.positions?.get('a')).toEqual({ x: 1, y: 2 })
  })

  it('LRU eviction at capacity', () => {
    const c = createLayoutCache(2)
    c.set('A', new Map([['a', { x: 0, y: 0 }]]))
    c.set('B', new Map([['b', { x: 0, y: 0 }]]))
    c.set('C', new Map([['c', { x: 0, y: 0 }]])) // evicts A
    expect(c.get('A').hit).toBe('miss')
    expect(c.get('B').hit).toBe('full')
    expect(c.get('C').hit).toBe('full')
  })

  it('get(hit) refreshes LRU position', () => {
    const c = createLayoutCache(2)
    c.set('A', new Map([['a', { x: 0, y: 0 }]]))
    c.set('B', new Map([['b', { x: 0, y: 0 }]]))
    c.get('A') // refreshes A
    c.set('C', new Map([['c', { x: 0, y: 0 }]])) // evicts B, not A
    expect(c.get('A').hit).toBe('full')
    expect(c.get('B').hit).toBe('miss')
  })

  it('partialMatch returns matched + missing ids and the positions for matched', () => {
    const c = createLayoutCache(4)
    c.set(
      'sig1',
      new Map([
        ['a', { x: 1, y: 1 }],
        ['b', { x: 2, y: 2 }],
        ['c', { x: 3, y: 3 }],
      ])
    )
    const result = c.partialMatch('sig1', ['a', 'b', 'd'])
    expect(new Set(result.matched)).toEqual(new Set(['a', 'b']))
    expect(result.missing).toEqual(['d'])
    expect(result.positions.size).toBe(2)
    expect(result.positions.get('a')).toEqual({ x: 1, y: 1 })
  })

  it('partialMatch returns matched=[] for a fully-missing sig', () => {
    const c = createLayoutCache(4)
    expect(c.partialMatch('nope', ['x']).matched).toEqual([])
  })
})
