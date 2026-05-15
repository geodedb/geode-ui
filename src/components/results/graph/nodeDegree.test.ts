import type { ElementDefinition } from 'cytoscape'
import {
  computeDegrees,
  degreeToSize,
  MIN_NODE_SIZE,
  MAX_NODE_SIZE,
} from './nodeDegree'

const node = (id: string): ElementDefinition => ({ data: { id, label: 'X' } })
const edge = (
  id: string,
  source: string,
  target: string
): ElementDefinition => ({
  data: { id, source, target, type: 'R' },
})

describe('computeDegrees', () => {
  it('returns zero for isolated nodes', () => {
    const map = computeDegrees([node('a'), node('b')])
    expect(map.get('a')).toBe(0)
    expect(map.get('b')).toBe(0)
  })

  it('counts each adjacent edge once per endpoint', () => {
    const els = [
      node('a'),
      node('b'),
      node('c'),
      edge('e1', 'a', 'b'),
      edge('e2', 'a', 'c'),
    ]
    const map = computeDegrees(els)
    expect(map.get('a')).toBe(2)
    expect(map.get('b')).toBe(1)
    expect(map.get('c')).toBe(1)
  })

  it('ignores edges whose endpoints are unknown', () => {
    const map = computeDegrees([node('a'), edge('e', 'a', 'ghost')])
    expect(map.get('a')).toBe(1)
  })
})

describe('degreeToSize', () => {
  it('returns MIN_NODE_SIZE for degree 0', () => {
    expect(degreeToSize(0)).toBe(MIN_NODE_SIZE)
  })

  it('grows monotonically with degree', () => {
    expect(degreeToSize(10)).toBeGreaterThan(degreeToSize(1))
    expect(degreeToSize(100)).toBeGreaterThan(degreeToSize(10))
  })

  it('saturates at MAX_NODE_SIZE for very large degrees', () => {
    expect(degreeToSize(100000)).toBeLessThanOrEqual(MAX_NODE_SIZE)
  })

  it('uses log scaling — 10x degree adds a roughly constant size step', () => {
    const step1 = degreeToSize(10) - degreeToSize(1)
    const step2 = degreeToSize(100) - degreeToSize(10)
    expect(Math.abs(step1 - step2) / step1).toBeLessThan(0.2)
  })
})
