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

// Migration-safety tests for the three sticky pref fields added in
// Tasks 3 (degreeSizing), 18 (miniMap) and 15 (focusHops). Each test
// seeds localStorage with an intentionally-bad persisted shape, asks
// the persist middleware to rehydrate from that seed, mounts the hook,
// and asserts the merge coerces back to a safe default. This pins the
// contract so a future refactor of the persist `merge` clause cannot
// silently regress migration behaviour for stale persisted shapes
// (e.g. a user on an older build whose localStorage predates these
// fields).
//
// NOTE on test isolation: `useGraphPrefs` is a module-level singleton
// store whose in-memory state survives across tests. Clearing
// localStorage does not by itself reset the in-memory state, and a
// fresh `renderHook` reads from that same singleton — it does not
// re-run the persist `merge`. To actually exercise the migration path
// each test seeds the localStorage envelope first, then calls
// `useGraphPrefs.persist.rehydrate()` to force the persist middleware
// to re-read storage and re-apply `merge`.

// Must mirror the private `STORAGE_KEY` constant in useGraphPrefs.ts
// (the zustand persist `name`). Kept in sync by hand because the
// constant isn't exported from the module under test.
const STORAGE_KEY = 'geode-ui.graph-prefs'

function writePersisted(state: Record<string, unknown>): void {
  // zustand's persist middleware writes a JSON envelope of the shape
  // { state, version } to localStorage; version 0 matches the current
  // (unversioned) store config.
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ state, version: 0 })
  )
}

async function rehydrate(): Promise<void> {
  // Force the persist middleware to re-read the seeded localStorage
  // envelope and re-run `merge`. Without this the in-memory singleton
  // store still carries whatever state earlier tests left behind.
  await useGraphPrefs.persist.rehydrate()
}

test('degreeSizing coerces a missing persisted value to true', async () => {
  writePersisted({})
  await rehydrate()
  const { result } = renderHook(() => useGraphPrefs())
  expect(result.current.degreeSizing).toBe(true)
})

test('degreeSizing only opts out when persisted value is literal false', async () => {
  writePersisted({ degreeSizing: false })
  await rehydrate()
  const { result } = renderHook(() => useGraphPrefs())
  expect(result.current.degreeSizing).toBe(false)
})

test('miniMap defaults to false when persisted value is missing', async () => {
  writePersisted({})
  await rehydrate()
  const { result } = renderHook(() => useGraphPrefs())
  expect(result.current.miniMap).toBe(false)
})

test('miniMap only opts in when persisted value is literal true', async () => {
  writePersisted({ miniMap: 'yes' as unknown as boolean })
  await rehydrate()
  const { result } = renderHook(() => useGraphPrefs())
  // Non-boolean garbage stays at the default (off).
  expect(result.current.miniMap).toBe(false)
})

test('focusHops clamps to [0, 3]', async () => {
  writePersisted({ focusHops: -5 })
  await rehydrate()
  const { result, unmount } = renderHook(() => useGraphPrefs())
  expect(result.current.focusHops).toBe(0)
  unmount()

  writePersisted({ focusHops: 99 })
  await rehydrate()
  const second = renderHook(() => useGraphPrefs())
  expect(second.result.current.focusHops).toBe(3)
})

test('focusHops defaults to 1 for non-finite persisted values', async () => {
  writePersisted({ focusHops: 'three' as unknown as number })
  await rehydrate()
  const { result } = renderHook(() => useGraphPrefs())
  expect(result.current.focusHops).toBe(1)
})

// Phase-0 / Task 1: the renderer pref ('cytoscape' | 'reagraph',
// default 'cytoscape'). Sticky so switching survives a re-run remount
// and a page reload — the toggle lives in the graph toolbar and lets
// the user (and the perf harness) flip between renderers without
// changing code. Pre-flip the canvas keeps rendering cytoscape; the
// dispatch step (rendering different components based on renderer)
// happens in a later task. This task only pins the pref + persistence
// contract.
describe('useGraphPrefs renderer pref', () => {
  beforeEach(() => {
    window.localStorage.clear()
    // Reset the in-memory singleton so a leftover renderer value from
    // an earlier test doesn't contaminate this one.
    useGraphPrefs.getState().setRenderer('cytoscape')
  })

  it('defaults to cytoscape', () => {
    expect(useGraphPrefs.getState().renderer).toBe('cytoscape')
  })

  it('switches to reagraph and persists', () => {
    useGraphPrefs.getState().setRenderer('reagraph')
    expect(useGraphPrefs.getState().renderer).toBe('reagraph')
    const raw = window.localStorage.getItem('geode-ui.graph-prefs')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string)
    expect(parsed.state.renderer).toBe('reagraph')
  })

  it('coerces garbage values back to cytoscape on rehydrate', async () => {
    // Simulate a stale persisted shape with a bogus renderer string.
    writePersisted({ renderer: 'totally-not-a-renderer' })
    await rehydrate()
    expect(useGraphPrefs.getState().renderer).toBe('cytoscape')
  })
})
