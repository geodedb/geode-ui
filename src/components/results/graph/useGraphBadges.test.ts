import { renderHook } from '@testing-library/react'
import { useGraphBadges } from './useGraphBadges'

function makeCy(positions: Record<string, { x: number; y: number }>) {
  const wrap = (id: string) => ({
    empty: () => !(id in positions),
    renderedPosition: () => positions[id] ?? { x: 0, y: 0 },
    renderedWidth: () => 40,
    renderedHeight: () => 40,
  })
  return {
    getElementById: (id: string) => wrap(id),
    on: jest.fn(),
    off: jest.fn(),
  }
}

describe('useGraphBadges', () => {
  it('returns one badge per pinned id and one per collapsed group', () => {
    const cy = makeCy({ 1: { x: 100, y: 200 }, 3: { x: 50, y: 60 } })
    const cyRef = { current: cy as never }
    const { result } = renderHook(() =>
      useGraphBadges({
        cyRef: cyRef as never,
        pinned: new Set(['1']),
        collapsed: new Map([['3', ['a', 'b', 'c']]]),
        sig: 's1',
      })
    )
    expect(result.current).toHaveLength(2)
    const pin = result.current.find((b) => b.kind === 'pin')
    expect(pin?.nodeId).toBe('1')
    expect(pin?.x).toBe(100)
    const col = result.current.find((b) => b.kind === 'collapsed')
    expect(col?.nodeId).toBe('3')
    expect(col?.count).toBe(3)
  })

  it('ignores ids that are no longer in the graph', () => {
    const cy = makeCy({})
    const cyRef = { current: cy as never }
    const { result } = renderHook(() =>
      useGraphBadges({
        cyRef: cyRef as never,
        pinned: new Set(['ghost']),
        collapsed: new Map(),
        sig: 's1',
      })
    )
    expect(result.current).toEqual([])
  })

  it('returns [] when cy is null', () => {
    const cyRef = { current: null }
    const { result } = renderHook(() =>
      useGraphBadges({
        cyRef: cyRef as never,
        pinned: new Set(['1']),
        collapsed: new Map(),
        sig: 's1',
      })
    )
    expect(result.current).toEqual([])
  })
})
