// Regression: large element sets must downgrade to a cheap layout
// (grid) REGARDLESS of which heavy layout the operator picked.
//
// Pre-fix the auto-downgrade only fired when the current layout was
// `cose` (DEFAULT_LAYOUT). If the operator had explicitly picked
// `fcose`, `dagre`, `breadthfirst`, `spread`, or `concentric` the
// guard didn't fire — and any of those running against ~7500
// cytoscape elements on the main thread froze the UI for tens of
// seconds. The fcose worker path is gated on `useWorkerLayout` AND
// `layoutName === 'fcose'`; with a non-fcose heavy layout (or worker
// pref off) the main-thread fallback ran and locked the tab.
//
// Operator report (2026-05-22): "executing the view update on a
// graph load of 2500 follows from the schema view causes the app
// to lock up completely and become unresponsive."

import { renderHook } from '@testing-library/react'
import { useGraphSigReset } from './useGraphSigReset'
import type { ElementDefinition } from 'cytoscape'
import { COSE_NODE_LIMIT } from './layouts'
import type { LayoutName } from '../useGraphPrefs'

function mkElements(count: number): ElementDefinition[] {
  // The hook only reads `.length` — the element shape is irrelevant
  // to the guard under test, so we cast empty objects.
  return new Array(count).fill({}) as ElementDefinition[]
}

function makeArgs(opts: { layout: LayoutName; n: number }) {
  const setLayout = jest.fn()
  const layoutRef = { current: opts.layout }
  const elementsRef = { current: mkElements(opts.n) }
  return {
    setLayout,
    args: {
      sig: 'sig-1',
      layoutRef,
      elementsRef,
      resetPath: jest.fn(),
      setHidden: jest.fn(),
      setCollapsed: jest.fn(),
      setExploringId: jest.fn(),
      pinningClear: jest.fn(),
      focusClear: jest.fn(),
      setSelected: jest.fn(),
      setLayout,
    },
  }
}

describe('useGraphSigReset — auto-downgrade large graphs to grid', () => {
  test('cose @ large N still downgrades to grid (existing behavior, regression guard)', () => {
    const { setLayout, args } = makeArgs({
      layout: 'cose',
      n: COSE_NODE_LIMIT + 1,
    })
    renderHook(() => useGraphSigReset(args))
    expect(setLayout).toHaveBeenCalledWith('grid')
  })

  // The four cases below are the operator-reported regression: any
  // heavy layout the operator picked should also downgrade when the
  // element count crosses the threshold. Pre-fix none of these
  // downgraded.
  const heavyLayouts: LayoutName[] = [
    'fcose',
    'dagre',
    'breadthfirst',
    'concentric',
    'spread',
  ]
  test.each(heavyLayouts)(
    'heavy layout %p @ N > limit downgrades to grid',
    (layout) => {
      const { setLayout, args } = makeArgs({
        layout,
        n: COSE_NODE_LIMIT + 1,
      })
      renderHook(() => useGraphSigReset(args))
      expect(setLayout).toHaveBeenCalledWith('grid')
    }
  )

  test('grid @ large N stays on grid (no-op — already a cheap layout)', () => {
    const { setLayout, args } = makeArgs({
      layout: 'grid',
      n: COSE_NODE_LIMIT + 1,
    })
    renderHook(() => useGraphSigReset(args))
    expect(setLayout).not.toHaveBeenCalled()
  })

  test('circle @ large N stays on circle (no-op — cheap layout, operator pick respected)', () => {
    const { setLayout, args } = makeArgs({
      layout: 'circle',
      n: COSE_NODE_LIMIT + 1,
    })
    renderHook(() => useGraphSigReset(args))
    expect(setLayout).not.toHaveBeenCalled()
  })

  test('heavy layout @ small N does NOT downgrade', () => {
    // 1 element is well under the threshold. Force-layout cost is
    // tiny; the operator's pick should win.
    const { setLayout, args } = makeArgs({ layout: 'cose', n: 1 })
    renderHook(() => useGraphSigReset(args))
    expect(setLayout).not.toHaveBeenCalled()
  })
})
