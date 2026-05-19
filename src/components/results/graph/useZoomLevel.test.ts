import { act, renderHook } from '@testing-library/react'
import { useZoomLevel } from './useZoomLevel'

type Handler = () => void
function makeCy(initialZoom = 1) {
  let z = initialZoom
  const handlers = new Set<Handler>()
  return {
    zoom: jest.fn((opts?: { level: number }) => {
      if (opts) {
        z = opts.level
        handlers.forEach((h) => h())
      }
      return z
    }),
    on: jest.fn((event: string, h: Handler) => {
      if (event === 'zoom') handlers.add(h)
    }),
    off: jest.fn((event: string, h: Handler) => {
      handlers.delete(h)
    }),
    width: () => 800,
    height: () => 600,
  }
}

describe('useZoomLevel', () => {
  it('maps cy.zoom() to a 0..1 slider position (log scale)', () => {
    const cy = makeCy(1) // identity zoom → midpoint
    const cyRef = { current: cy as never }
    const { result } = renderHook(() => useZoomLevel(cyRef, 's1'))
    // log(1, [0.1..10]) → 0.5
    expect(result.current.level).toBeCloseTo(0.5, 2)
  })

  it('setZoomLevel(0.75) calls cy.zoom() with a level along the log curve', () => {
    const cy = makeCy(1)
    const cyRef = { current: cy as never }
    const { result } = renderHook(() => useZoomLevel(cyRef, 's1'))
    act(() => result.current.setZoomLevel(0.75))
    const call = (cy.zoom as jest.Mock).mock.calls.find((c) => c[0])
    // 10 ** (0.75 * 2 - 1) ≈ 10^0.5 ≈ 3.162
    expect(call?.[0].level).toBeCloseTo(3.162, 2)
  })

  it('unsubscribes from cy.on(zoom) on unmount', () => {
    const cy = makeCy(1)
    const cyRef = { current: cy as never }
    const { unmount } = renderHook(() => useZoomLevel(cyRef, 's1'))
    expect(cy.on).toHaveBeenCalledWith('zoom', expect.any(Function))
    unmount()
    expect(cy.off).toHaveBeenCalledWith('zoom', expect.any(Function))
  })
})
