import { act, renderHook } from '@testing-library/react'
import { useFocusMode } from './useFocusMode'

function makeCy(adj: Record<string, string[]>) {
  const allClasses = new Map<string, Set<string>>()
  const wrap = (id: string) => ({
    id: () => id,
    addClass: (c: string) => {
      if (!allClasses.has(id)) allClasses.set(id, new Set())
      allClasses.get(id)!.add(c)
    },
    removeClass: (c: string) => allClasses.get(id)?.delete(c),
    neighborhood: () => {
      const ns = (adj[id] ?? []).map((n) => wrap(n))
      return {
        nodes: () => ns,
        forEach: (cb: (n: { id: () => string }) => void) => ns.forEach(cb),
      }
    },
    empty: () => false,
  })
  const all = Object.keys(adj).map((id) => wrap(id))
  return {
    getElementById: (id: string) => wrap(id),
    batch: (fn: () => void) => fn(),
    nodes: () => ({
      forEach: (
        cb: (n: { id: () => string; removeClass: (c: string) => void }) => void
      ) => all.forEach(cb),
    }),
    classes: allClasses,
  }
}

describe('useFocusMode', () => {
  it('marking focus adds .gv-out-of-focus to nodes outside the N-hop set', () => {
    const cy = makeCy({ a: ['b'], b: ['a', 'c'], c: ['b', 'd'], d: ['c'] })
    const cyRef = { current: cy as never }
    const { result } = renderHook(() => useFocusMode({ cyRef: cyRef as never }))
    act(() => result.current.focus({ id: 'a', hops: 1 }))
    expect(cy.classes.get('a')?.has('gv-out-of-focus')).toBeFalsy()
    expect(cy.classes.get('b')?.has('gv-out-of-focus')).toBeFalsy()
    expect(cy.classes.get('d')?.has('gv-out-of-focus')).toBe(true)
  })

  it('clear() removes the class from every node', () => {
    const cy = makeCy({ a: ['b'], b: ['a'] })
    const cyRef = { current: cy as never }
    const { result } = renderHook(() => useFocusMode({ cyRef: cyRef as never }))
    act(() => result.current.focus({ id: 'a', hops: 0 }))
    act(() => result.current.clear())
    expect(cy.classes.get('b')?.has('gv-out-of-focus')).toBeFalsy()
  })

  it('reapply re-runs the most recent focus on the current cy core', () => {
    const cy = makeCy({ a: ['b'], b: ['a', 'c'], c: ['b'] })
    const cyRef = { current: cy as never }
    const { result } = renderHook(() => useFocusMode({ cyRef: cyRef as never }))
    act(() => result.current.focus({ id: 'a', hops: 0 }))
    // Swap to a fresh fake cy and call reapply — the new cy gets the
    // class on every node outside the focal set.
    const cy2 = makeCy({ a: ['b'], b: ['a', 'c'], c: ['b'] })
    cyRef.current = cy2 as never
    act(() => result.current.reapply())
    expect(cy2.classes.get('b')?.has('gv-out-of-focus')).toBe(true)
  })
})
