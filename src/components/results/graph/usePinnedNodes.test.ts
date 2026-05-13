import { act, renderHook } from '@testing-library/react'
import { usePinnedNodes } from './usePinnedNodes'

function makeCy() {
  type ElState = { locked: boolean }
  const els = new Map<string, ElState>()
  return {
    getElementById: (id: string) => {
      let el = els.get(id)
      if (!el) {
        el = { locked: false }
        els.set(id, el)
      }
      return {
        empty: () => false,
        lock: () => {
          el!.locked = true
        },
        unlock: () => {
          el!.locked = false
        },
        addClass: jest.fn(),
        removeClass: jest.fn(),
      }
    },
    testEls: els,
  }
}

describe('usePinnedNodes', () => {
  it('toggling a pin locks the node and adds .gv-pinned', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { result } = renderHook(() =>
      usePinnedNodes({ cyRef: cyRef as never })
    )
    act(() => result.current.togglePin('5'))
    expect(result.current.isPinned('5')).toBe(true)
    expect(cy.testEls.get('5')!.locked).toBe(true)
  })

  it('toggling twice unlocks the node', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { result } = renderHook(() =>
      usePinnedNodes({ cyRef: cyRef as never })
    )
    act(() => result.current.togglePin('5'))
    act(() => result.current.togglePin('5'))
    expect(result.current.isPinned('5')).toBe(false)
    expect(cy.testEls.get('5')!.locked).toBe(false)
  })

  it('reapplyAll re-locks every pinned id (used after a rebuild)', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { result } = renderHook(() =>
      usePinnedNodes({ cyRef: cyRef as never })
    )
    act(() => result.current.togglePin('3'))
    act(() => result.current.togglePin('4'))
    // Simulate a rebuild: swap cyRef.current to a fresh fake-cy.
    const cy2 = makeCy()
    cyRef.current = cy2 as never
    act(() => result.current.reapplyAll())
    expect(cy2.testEls.get('3')!.locked).toBe(true)
    expect(cy2.testEls.get('4')!.locked).toBe(true)
  })

  it('clear() releases all pins and unlocks them', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { result } = renderHook(() =>
      usePinnedNodes({ cyRef: cyRef as never })
    )
    act(() => result.current.togglePin('3'))
    act(() => result.current.clear())
    expect(result.current.isPinned('3')).toBe(false)
    expect(cy.testEls.get('3')!.locked).toBe(false)
  })
})
