/// <reference types="@testing-library/jest-dom" />
import { act, renderHook } from '@testing-library/react'

// Reproduction test for the "graph display options reset on re-run" bug.
//
// The layout-algorithm picker, the node-label visibility toggles
// (hiddenLabels), the node label-field selection (nodeLabelPrefs) and
// the edge type-field selection (edgeLabelPrefs) currently live in
// component-local useState inside GraphView. QueryPage.resetRunState()
// (fired on every "Run") sets activeResp to null, which unmounts
// GraphView, so on remount all those selections re-initialise to their
// defaults — the user loses their display configuration on every re-run.
//
// The intended fix lifts those four pieces of state into a small
// localStorage-backed hook (useGraphPrefs) that outlives the GraphView
// mount. This test pins that contract: a value written through the hook
// must be readable back from a *fresh* renderHook (which simulates the
// GraphView remount). On the current code the module does not exist, so
// the import fails — that is the expected pre-fix failure.
//
// NOTE: this test is intentionally decoupled from the GraphView render
// tree. The authoritative behavioural regression lives in
// GraphView.test.tsx ("graph display options survive a re-run remount").
// If the fixer names the hook / its API differently, this file is the
// one to adjust — GraphView.test.tsx asserts the user-visible behaviour
// and must keep passing as-is.
//
import { useGraphPrefs } from './useGraphPrefs'

beforeEach(() => {
  // Each test starts from a clean slate so the persisted value under
  // test is the one this test wrote, not a leftover from another test.
  window.localStorage.clear()
})

test('useGraphPrefs persists the layout choice across a fresh mount', () => {
  const first = renderHook(() => useGraphPrefs())
  expect(first.result.current.layout).toBe('cose') // default

  act(() => {
    first.result.current.setLayout('grid')
  })
  expect(first.result.current.layout).toBe('grid')

  // Simulate the GraphView remount: throw away the old hook instance
  // and render a brand new one. It must read back the persisted value
  // instead of re-initialising to the default.
  first.unmount()
  const second = renderHook(() => useGraphPrefs())
  expect(second.result.current.layout).toBe('grid')
})

test('useGraphPrefs persists a node label-field preference across a fresh mount', () => {
  const first = renderHook(() => useGraphPrefs())
  expect(first.result.current.nodeLabelPrefs).toEqual({})

  act(() => {
    first.result.current.setNodePref('Movie', 'title')
  })
  expect(first.result.current.nodeLabelPrefs).toEqual({ Movie: 'title' })

  first.unmount()
  const second = renderHook(() => useGraphPrefs())
  expect(second.result.current.nodeLabelPrefs).toEqual({ Movie: 'title' })
})

test('useGraphPrefs persists hidden-label toggles across a fresh mount', () => {
  const first = renderHook(() => useGraphPrefs())
  expect(first.result.current.hiddenLabels.has('Person')).toBe(false)

  act(() => {
    first.result.current.toggleHiddenLabel('Person')
  })
  expect(first.result.current.hiddenLabels.has('Person')).toBe(true)

  first.unmount()
  const second = renderHook(() => useGraphPrefs())
  expect(second.result.current.hiddenLabels.has('Person')).toBe(true)
})

// Reproduction test for the "graph inspector renders raw JSON only" UX gap.
//
// The intended fix makes the inspector default to a structured property
// view with a toggle to the raw-JSON view, and makes that choice sticky
// by adding an `inspectorView: 'props' | 'json'` field (default 'props')
// plus a `setInspectorView` setter to this store — included in its
// partialize/merge so it survives a remount and a page reload.
//
// On the current code neither `inspectorView` nor `setInspectorView`
// exists on the store, so these assertions fail (the field reads back
// `undefined` and the setter is not a function) — the expected pre-fix
// failure.
test('useGraphPrefs.inspectorView defaults to "props"', () => {
  const { result } = renderHook(() => useGraphPrefs())
  expect(result.current.inspectorView).toBe('props')
})

test('useGraphPrefs persists the inspector view choice across a fresh mount', () => {
  const first = renderHook(() => useGraphPrefs())
  expect(first.result.current.inspectorView).toBe('props')

  act(() => {
    first.result.current.setInspectorView('json')
  })
  expect(first.result.current.inspectorView).toBe('json')

  // Simulate the GraphView remount: a brand-new hook instance must read
  // the persisted 'json' back from localStorage.
  first.unmount()
  const second = renderHook(() => useGraphPrefs())
  expect(second.result.current.inspectorView).toBe('json')
})

// Phase-1 / Task 1.3: the box-selection mode toggle ('pan' | 'box',
// default 'pan'). Sticky like every other display pref.
test('useGraphPrefs.selectionMode defaults to "pan" and persists changes', () => {
  const first = renderHook(() => useGraphPrefs())
  expect(first.result.current.selectionMode).toBe('pan')

  act(() => {
    first.result.current.setSelectionMode('box')
  })
  expect(first.result.current.selectionMode).toBe('box')
  expect(window.localStorage.getItem('geode-ui.graph-prefs')).toMatch(
    /"selectionMode":"box"/
  )

  first.unmount()
  const second = renderHook(() => useGraphPrefs())
  expect(second.result.current.selectionMode).toBe('box')
})

// Phase-1 / Task 1.4: the group-by-label clustering toggle (default
// false). Sticky like every other display pref.
test('useGraphPrefs.clusterByLabel defaults to false and persists changes', () => {
  const first = renderHook(() => useGraphPrefs())
  expect(first.result.current.clusterByLabel).toBe(false)

  act(() => {
    first.result.current.setClusterByLabel(true)
  })
  expect(first.result.current.clusterByLabel).toBe(true)
  expect(window.localStorage.getItem('geode-ui.graph-prefs')).toMatch(
    /"clusterByLabel":true/
  )

  first.unmount()
  const second = renderHook(() => useGraphPrefs())
  expect(second.result.current.clusterByLabel).toBe(true)
})
