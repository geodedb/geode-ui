/**
 * Q rank 19 / #184: regression tests for the useTableBodySize hook
 * extracted from TableView.tsx. The hook owns ResizeObserver setup,
 * floors the body height, and falls back gracefully when
 * ResizeObserver is unavailable. These tests pin all three.
 */
import { act, renderHook } from '@testing-library/react'
import { useTableBodySize } from './useTableBodySize'

type ResizeObserverInstanceMock = {
  observe: jest.Mock
  unobserve: jest.Mock
  disconnect: jest.Mock
  trigger: (
    entries: { contentRect: { width: number; height: number } }[]
  ) => void
}

interface ResizeObserverCtorMock extends jest.Mock {
  instances: ResizeObserverInstanceMock[]
}

type GlobalWithRO = typeof globalThis & {
  ResizeObserver?: ResizeObserverCtorMock
}

function installResizeObserverMock(): ResizeObserverCtorMock {
  const instances: ResizeObserverInstanceMock[] = []
  const ctor = jest.fn((cb: ResizeObserverCallback) => {
    const inst: ResizeObserverInstanceMock = {
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
      trigger: (entries) => {
        // cast to ResizeObserverEntry[] -- the hook only reads
        // contentRect.{width,height} so the partial shape is fine.
        cb(
          entries as unknown as ResizeObserverEntry[],
          inst as unknown as ResizeObserver
        )
      },
    }
    instances.push(inst)
    return inst as unknown as ResizeObserver
  }) as unknown as ResizeObserverCtorMock
  ctor.instances = instances
  const g = globalThis as GlobalWithRO
  g.ResizeObserver = ctor
  return ctor
}

function uninstallResizeObserver(): void {
  const g = globalThis as GlobalWithRO
  // `delete` on a non-optional property is a TS2790; coerce to a
  // record so the runtime delete still hits the global. The runtime
  // behavior is unchanged.
  delete (g as Record<string, unknown>).ResizeObserver
}

describe('useTableBodySize', () => {
  afterEach(() => {
    uninstallResizeObserver()
    jest.restoreAllMocks()
  })

  it('returns the minBodyHeight floor before any ResizeObserver tick', () => {
    installResizeObserverMock()
    const { result } = renderHook(() =>
      useTableBodySize({ minBodyHeight: 240, headerBudgetPx: 40 })
    )
    // wrap ref not attached -> hook short-circuits and the seeded
    // floor stands.
    expect(result.current.containerWidth).toBeUndefined()
    expect(result.current.bodyHeight).toBe(240)
  })

  it('updates containerWidth and bodyHeight on observer ticks', () => {
    const ctor = installResizeObserverMock()
    const wrap = document.createElement('div')
    // Stub getBoundingClientRect so the synchronous seed pass returns
    // zero (we only care about the observer-driven path here).
    wrap.getBoundingClientRect = () =>
      ({
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        x: 0,
        y: 0,
        toJSON() {
          return this
        },
      }) as DOMRect

    const { result } = renderHook(() =>
      useTableBodySize({ minBodyHeight: 240, headerBudgetPx: 40 })
    )
    act(() => {
      result.current.wrapRef.current = wrap
    })
    // Re-mount the effect by re-rendering — we have to do this
    // explicitly because useEffect reads wrapRef.current on its first
    // pass and we set it after the initial render above. The simplest
    // way is to call observe directly via the constructor call.
    // Instead, mount a fresh hook with the ref already attached via a
    // factory pattern.
    const factory = (initRef: HTMLDivElement) => {
      const hook = useTableBodySize({ minBodyHeight: 240, headerBudgetPx: 40 })
      // attach synchronously so the layoutEffect sees the ref.
      hook.wrapRef.current = initRef
      return hook
    }
    const { result: r2 } = renderHook(() => factory(wrap))
    expect(ctor.instances.length).toBeGreaterThanOrEqual(1)
    const inst = ctor.instances[ctor.instances.length - 1]
    if (!inst) throw new Error('expected at least one ResizeObserver instance')
    act(() => {
      inst.trigger([{ contentRect: { width: 800, height: 600 } }])
    })
    expect(r2.current.containerWidth).toBe(800)
    // bodyHeight = max(minBodyHeight=240, h - headerBudgetPx=40) = 560.
    expect(r2.current.bodyHeight).toBe(560)
  })

  it('floors body height at minBodyHeight when the wrap is tiny', () => {
    const ctor = installResizeObserverMock()
    const wrap = document.createElement('div')
    wrap.getBoundingClientRect = () =>
      ({
        width: 100,
        height: 100,
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        x: 0,
        y: 0,
        toJSON() {
          return this
        },
      }) as DOMRect

    const factory = (initRef: HTMLDivElement) => {
      const hook = useTableBodySize({ minBodyHeight: 240, headerBudgetPx: 40 })
      hook.wrapRef.current = initRef
      return hook
    }
    const { result } = renderHook(() => factory(wrap))
    // The synchronous seed observed h=100; bodyHeight = max(240, 60) = 240.
    expect(result.current.bodyHeight).toBe(240)
    // A subsequent observer tick with another tiny height keeps the floor.
    const inst = ctor.instances[ctor.instances.length - 1]
    if (!inst) throw new Error('expected at least one ResizeObserver instance')
    act(() => {
      inst.trigger([{ contentRect: { width: 200, height: 50 } }])
    })
    expect(result.current.bodyHeight).toBe(240)
  })

  it('falls back to minBodyHeight when ResizeObserver is unavailable', () => {
    // Do NOT install ResizeObserver -- this matches the SSR / old jsdom
    // path the hook guards against. The component must still render
    // with the floor values.
    uninstallResizeObserver()
    const { result } = renderHook(() =>
      useTableBodySize({ minBodyHeight: 240, headerBudgetPx: 40 })
    )
    expect(result.current.containerWidth).toBeUndefined()
    expect(result.current.bodyHeight).toBe(240)
  })
})
