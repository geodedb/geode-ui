/// <reference types="@testing-library/jest-dom" />
import { act, renderHook } from '@testing-library/react'
import { usePaneVisibility } from './usePaneVisibility'

type ObserverCb = (entries: Array<{ isIntersecting: boolean }>) => void
type IoSlot = { IntersectionObserver?: typeof IntersectionObserver }
type FakeObserverInstance = {
  observe: () => void
  disconnect: () => void
  unobserve: () => void
  takeRecords: () => IntersectionObserverEntry[]
}
type CapturingIO = { callbacks: ObserverCb[]; restore: () => void }

// Module-level helpers (factory functions, not classes) so eslint's
// class-method rules stay out of the way and prettier doesn't insert
// leading semicolons on object-mutation lines.
function setIO(impl: unknown): void {
  const slot = globalThis as { IntersectionObserver?: unknown }
  slot.IntersectionObserver = impl as typeof IntersectionObserver
}

function clearIO(): void {
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
}

function getOriginalIO(): typeof IntersectionObserver | undefined {
  return (globalThis as IoSlot).IntersectionObserver
}

function restoreIO(original: typeof IntersectionObserver | undefined): void {
  if (original) {
    setIO(original)
  } else {
    clearIO()
  }
}

function installCapturingIO(): CapturingIO {
  const callbacks: ObserverCb[] = []
  const original = getOriginalIO()
  const fake = function FakeIO(cb: ObserverCb): FakeObserverInstance {
    callbacks.push(cb)
    return {
      observe: () => undefined,
      disconnect: () => undefined,
      unobserve: () => undefined,
      takeRecords: () => [],
    }
  } as unknown
  setIO(fake)
  return { callbacks, restore: () => restoreIO(original) }
}

describe('usePaneVisibility', () => {
  it('defaults to visible when no DOM node is attached yet', () => {
    const { callbacks, restore } = installCapturingIO()
    try {
      const { result } = renderHook(() => usePaneVisibility())
      expect(result.current.visible).toBe(true)
      // No node attached → effect short-circuits before observing.
      expect(callbacks).toHaveLength(0)
    } finally {
      restore()
    }
  })

  it('flips visibility based on IntersectionObserver entries when a node is attached', () => {
    const { callbacks, restore } = installCapturingIO()
    try {
      const node = document.createElement('div')
      document.body.appendChild(node)
      // Bind the node via the ref before the effect runs.
      const { result } = renderHook(() => {
        const r = usePaneVisibility()
        const mutRef = r.ref as { current: HTMLElement | null }
        mutRef.current = node
        return r
      })
      expect(result.current.visible).toBe(true)
      const cb = callbacks[callbacks.length - 1]
      if (!cb) throw new Error('expected an IntersectionObserver callback')
      act(() => {
        cb([{ isIntersecting: false }])
      })
      expect(result.current.visible).toBe(false)
      act(() => {
        cb([{ isIntersecting: true }])
      })
      expect(result.current.visible).toBe(true)
      document.body.removeChild(node)
    } finally {
      restore()
    }
  })

  it('falls back to visible-by-default when IntersectionObserver is unavailable', () => {
    const original = getOriginalIO()
    clearIO()
    try {
      const { result } = renderHook(() => usePaneVisibility())
      expect(result.current.visible).toBe(true)
    } finally {
      restoreIO(original)
    }
  })

  it('disconnects the observer on unmount', () => {
    // Track disconnect calls via a closure flag.
    let disconnected = 0
    const original = getOriginalIO()
    const fake = function FakeIO(): FakeObserverInstance {
      return {
        observe: () => undefined,
        disconnect: () => {
          disconnected += 1
        },
        unobserve: () => undefined,
        takeRecords: () => [],
      }
    } as unknown
    setIO(fake)
    try {
      const node = document.createElement('div')
      document.body.appendChild(node)
      const hook = renderHook(() => {
        const r = usePaneVisibility()
        const mutRef = r.ref as { current: HTMLElement | null }
        mutRef.current = node
        return r
      })
      hook.unmount()
      expect(disconnected).toBeGreaterThanOrEqual(1)
      document.body.removeChild(node)
    } finally {
      restoreIO(original)
    }
  })
})
