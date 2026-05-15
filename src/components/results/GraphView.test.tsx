/// <reference types="@testing-library/jest-dom" />
/* eslint-disable no-underscore-dangle */
import React from 'react'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

// Capture the constructor calls from cytoscape so we can assert that
// repeated streaming `resp` updates do NOT tear down + rebuild the
// Cytoscape Core on every render. The mock returns a thin stub that
// honors the methods GraphView touches.
const cyConstructorCalls: unknown[] = []
const destroyMock = jest.fn()
const onMock = jest.fn()
// Records cytoscape.use(...) registrations (Task 1.1 — fcose, dagre).
const useMock = jest.fn()
// Records every layout() arg passed to *any* mock core (Task 1.2).
const layoutCalls: unknown[] = []
// The last-constructed mock core, so tests can poke its jest.fn-backed
// methods (Tasks 1.3/1.4/1.5).
let lastCyInstance:
  | (Record<string, unknown> & { __lastElements?: unknown })
  | null = null

// A no-op chainable collection: every method returns the collection so
// `.removeClass(...).removeClass(...)` and friends don't blow up. forEach
// is a real no-op so per-element callbacks (which touch methods this stub
// doesn't model) are never invoked. The collection also models the
// graph-algorithm shape GraphView's path mode reaches (dijkstra → pathTo)
// well enough to drive a deterministic highlight in tests.
// Per-core graph context the collection stubs read for the Phase-2
// collapse logic: undirected adjacency (node id → neighbour ids) and a
// node-id → data-bag map. Built from the constructed element list and
// extended on cy.add(...). When absent (older call sites) neighborhood/
// degree/data degrade to "no neighbours / empty data".
type GraphCtx = {
  adj: Map<string, Set<string>>
  dataById: Map<string, Record<string, unknown>>
}

const makeColl = (
  members: string[] = [],
  classed: Map<string, Set<string>> | null = null,
  ctx: GraphCtx | null = null
): Record<string, unknown> => {
  const classes = classed ?? new Map<string, Set<string>>()
  const coll: Record<string, unknown> = {
    forEach: jest.fn((fn: (el: unknown) => void) => {
      members.forEach((m) => fn(makeColl([m], classes, ctx)))
    }),
    remove: jest.fn(),
    length: members.length,
    empty: () => members.length === 0,
    id: () => members[0] ?? '',
    edges: () => makeColl([], classes, ctx),
    nodes: () => makeColl(members.slice(), classes, ctx),
    // data() → the first member's data bag; data(key) → that key.
    data: (key?: string) => {
      const d = ctx?.dataById.get(members[0] ?? '') ?? { id: members[0] }
      return key === undefined ? d : (d as Record<string, unknown>)[key]
    },
    // degree(_includeLoops) → undirected degree from the adjacency map.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    degree: (_includeLoops?: boolean) =>
      ctx?.adj.get(members[0] ?? '')?.size ?? 0,
    // hasClass — reads the first member's class set.
    hasClass: (cls: string) => classes.get(members[0] ?? '')?.has(cls) ?? false,
    // neighborhood() — the adjacency set of the first member.
    neighborhood: () =>
      makeColl(Array.from(ctx?.adj.get(members[0] ?? '') ?? []), classes, ctx),
    // Cytoscape's Collection.renderedPosition() / .renderedHeight() —
    // consumed by useGraphBadges (Task 7) to anchor DOM overlays in
    // canvas pixel space. jsdom has no real layout engine, so the mock
    // returns deterministic zeros; tests assert state transitions
    // (badge presence / count), not pixel coordinates.
    renderedPosition: () => ({ x: 0, y: 0 }),
    renderedHeight: () => 0,
  }
  const chain = (): Record<string, unknown> => coll
  // addClass / removeClass record the class on each member id so
  // __classesOf(id) can be asserted.
  coll.addClass = jest.fn((cls: string) => {
    members.forEach((m) => {
      const set = classes.get(m) ?? new Set<string>()
      set.add(cls)
      classes.set(m, set)
    })
    return coll
  })
  coll.removeClass = jest.fn((cls: string) => {
    members.forEach((m) => {
      const set = classes.get(m)
      if (set) set.delete(cls)
    })
    return coll
  })
  // filter(predicate) — element-by-element filter that yields a new
  // collection. useFocusMode uses this to narrow elements() down to
  // the keep-set before fit().
  coll.filter = jest.fn((predicate: (el: { id: () => string }) => boolean) => {
    const kept = members.filter((m) =>
      predicate(makeColl([m], classes, ctx) as { id: () => string })
    )
    return makeColl(kept, classes, ctx)
  })
  coll.difference = jest.fn((other: { __members?: string[] }) => {
    const omit = new Set(other?.__members ?? [])
    return makeColl(
      members.filter((m) => !omit.has(m)),
      classes,
      ctx
    )
  })
  coll.union = chain
  coll.connectedNodes = chain
  coll.closedNeighborhood = chain
  coll.connectedEdges = () => makeColl([], classes, ctx)
  coll.select = chain
  // Cytoscape's Collection.lock()/unlock() — used by usePinnedNodes to
  // pin/unpin nodes against layout reflows. No-op in the mock since
  // there are no positions to freeze; chainable to match the real API.
  coll.lock = jest.fn(() => coll)
  coll.unlock = jest.fn(() => coll)
  coll.dijkstra = jest.fn(() => ({
    // pathTo(target): the mock can't run a real shortest-path search
    // (no node positions in jsdom), so it returns a collection of every
    // member id — deterministic enough to pin the highlight wiring.
    pathTo: jest.fn(() => makeColl(members.slice(), classes, ctx)),
  }))
  coll.__members = members
  coll.__classes = classes
  return coll
}

type ElLike = {
  data?: { id?: unknown; source?: unknown; target?: unknown } & Record<
    string,
    unknown
  >
}

function idsFromElements(opts: unknown): string[] {
  const els = (opts as { elements?: ElLike[] })?.elements
  if (!Array.isArray(els)) return []
  const ids: string[] = []
  els.forEach((e) => {
    const id = e.data?.id
    if (id != null && String(id) !== '') ids.push(String(id))
  })
  return ids
}

// Build (or extend) a GraphCtx from an element list — records every
// node's data bag and wires undirected adjacency from the edge entries.
function addElsToCtx(ctx: GraphCtx, els: ElLike[] | unknown): void {
  if (!Array.isArray(els)) return
  const ensure = (id: string): Set<string> => {
    let s = ctx.adj.get(id)
    if (!s) {
      s = new Set<string>()
      ctx.adj.set(id, s)
    }
    return s
  }
  els.forEach((e) => {
    const data = (e as ElLike).data
    if (!data) return
    const id = data.id != null ? String(data.id) : ''
    if (!id) return
    const src = data.source != null ? String(data.source) : ''
    const tgt = data.target != null ? String(data.target) : ''
    if (src && tgt) {
      ensure(src).add(tgt)
      ensure(tgt).add(src)
    } else {
      ctx.dataById.set(id, data as Record<string, unknown>)
      ensure(id) // make sure isolated nodes have an (empty) adjacency entry
    }
  })
}

// jest.fn-backed factory so individual tests can override behavior
// (e.g. force a throw) via mockImplementationOnce. The stub honours
// every Core method GraphView reaches — including the ones the
// layout-change / visibility / fit effects call (fit, zoom, width,
// height, style().update()) — so changing a display option after the
// debounced build doesn't crash the (mocked) render tree.
const cyFactory = jest.fn((opts: unknown) => {
  cyConstructorCalls.push(opts)
  const style = { update: jest.fn() }
  // Per-core shared class registry so addClass/removeClass on any
  // collection derived from this core are observable via __classesOf.
  const classes = new Map<string, Set<string>>()
  const elementIds: string[] = idsFromElements(opts)
  // Per-core graph context (adjacency + node data) so the Phase-2
  // collapse logic — getElementById(id).neighborhood().nodes().forEach
  // with a degree(false)===1 leaf filter — has a real graph to read.
  const ctx: GraphCtx = { adj: new Map(), dataById: new Map() }
  addElsToCtx(ctx, (opts as { elements?: unknown })?.elements)
  // Recorder for cy.add(...) so mergeSubgraph tests can assert what was
  // added; also extends the ctx so a subsequent neighborhood() sees the
  // merged-in elements.
  const addCalls: unknown[] = []
  // Tap-handler registry: cy.on('tap', 'node', fn) records fn so a test
  // can fire it via cy.__emitTap('node', id).
  const tapHandlers: Record<string, ((ev: unknown) => void)[]> = {}
  const pushHandler = (key: string, fn: (e: unknown) => void): void => {
    const list = tapHandlers[key] ?? []
    list.push(fn)
    tapHandlers[key] = list
  }
  const recordOn = (...args: unknown[]): void => {
    onMock(...args)
    // (event, selectorOrHandler, maybeHandler)
    const ev = args[0]
    if (ev !== 'tap') return
    if (typeof args[1] === 'function') {
      pushHandler('__bg', args[1] as (e: unknown) => void)
    } else if (typeof args[1] === 'string' && typeof args[2] === 'function') {
      pushHandler(args[1] as string, args[2] as (e: unknown) => void)
    }
  }
  const addImpl = jest.fn((els: unknown) => {
    addCalls.push(els)
    addElsToCtx(ctx, els)
    const arr = Array.isArray(els) ? els : [els]
    arr.forEach((e) => {
      const id = (e as ElLike)?.data?.id
      if (id != null && String(id) !== '') elementIds.push(String(id))
    })
    return makeColl([], classes, ctx)
  })
  const core: Record<string, unknown> & { __lastElements?: unknown } = {
    on: recordOn,
    // cy.off — consumed by useGraphBadges (Task 7) to unsubscribe its
    // viewport / pan / zoom / render listeners on unmount. The test
    // doesn't replay these events, so a no-op is fine.
    off: jest.fn(),
    destroy: destroyMock,
    add: addImpl,
    remove: jest.fn(),
    batch: (fn: () => void) => fn(),
    elements: () => makeColl(elementIds.slice(), classes, ctx),
    getElementById: (id: string) =>
      makeColl(elementIds.includes(id) ? [id] : [], classes, ctx),
    layout: jest.fn((arg: unknown) => {
      layoutCalls.push(arg)
      return { run: jest.fn() }
    }),
    nodes: () => makeColl([], classes, ctx),
    edges: () => makeColl([], classes, ctx),
    $id: (id: string) =>
      makeColl(elementIds.includes(id) ? [id] : [], classes, ctx),
    fit: jest.fn(),
    // cy.center(node) — consumed by onFindPick (toolbar Find input) to
    // pan the viewport to the picked node. No-op in the mock.
    center: jest.fn(),
    animate: jest.fn(),
    pan: jest.fn(() => ({ x: 0, y: 0 })),
    zoom: jest.fn(() => 1),
    width: jest.fn(() => 400),
    height: jest.fn(() => 300),
    style: jest.fn(() => style),
    userPanningEnabled: jest.fn(),
    boxSelectionEnabled: jest.fn(),
    __lastElements: (opts as { elements?: unknown })?.elements,
    __classesOf: (id: string): string[] => Array.from(classes.get(id) ?? []),
    __addCalls: addCalls,
    __emitTap: (kind: string, id: string): void => {
      const handlers = tapHandlers[kind] ?? []
      const target = makeColl([id], classes, ctx)
      target.id = () => id
      handlers.forEach((h) => h({ target }))
    },
  }
  lastCyInstance = core
  return core
})

jest.mock('cytoscape', () => {
  const fn = cyFactory as unknown as { use: jest.Mock }
  fn.use = useMock
  return { __esModule: true, default: fn }
})

// GraphView's "Explore neighbours" action (Phase 2 / Task 2.4) runs a
// one-shot GQL via `client.query`. The component isn't normally rendered
// with a live client, so we stub the module — the queryMock lets a test
// inspect the statement that was sent and feed back a synthetic result.
const queryMock = jest.fn()
jest.mock('../../api/client', () => ({
  client: {
    query: (...args: unknown[]): Promise<unknown> => queryMock(...args),
  },
}))

// Helpers used by the new Phase-1 tests.
function lastLayoutArg(): unknown {
  return layoutCalls[layoutCalls.length - 1]
}
function lastCy(): Record<string, unknown> & { __lastElements?: unknown } {
  if (!lastCyInstance) throw new Error('no cytoscape core constructed yet')
  return lastCyInstance
}
// The class set recorded for `id` on the last-constructed mock core.
function classesOf(id: string): string[] {
  return (lastCy().__classesOf as (i: string) => string[])(id)
}

// Mock the radial context-menu hook BEFORE importing GraphView so the
// orchestrator picks up the stub. The cxtmenu extension expects a real
// Cytoscape Core (which the jsdom mock doesn't model), so the hook is
// no-op'd here and tests assert the mounting arguments instead of DOM
// effects. buildCommands is re-exported from the actual module so any
// upstream consumer that still imports it continues to work.
jest.mock('./graph/useCxtMenu', () => ({
  useCxtMenu: jest.fn(),
  buildCommands: jest.requireActual('./graph/useCxtMenu').buildCommands,
}))

// Import after the mock is in place.
import { GraphView } from './GraphView'
import cytoscape from 'cytoscape'
import type { ElementDefinition } from 'cytoscape'
import type { QueryRespLike } from '../../lib/graphResult'
import { useGraphPrefs } from './useGraphPrefs'
import { useCxtMenu } from './graph/useCxtMenu'

import { testTheme as theme } from '../../test-utils/theme'

function makeResp(rowCount: number): {
  rows: unknown[][]
  graph_summary: {
    nodes: {
      id: number
      labels: string[]
      properties: Record<string, never>
    }[]
  }
  row_count: number
} {
  const nodes: {
    id: number
    labels: string[]
    properties: Record<string, never>
  }[] = []
  for (let i = 0; i < rowCount; i += 1) {
    nodes.push({ id: i, labels: ['N'], properties: {} })
  }
  return {
    rows: nodes.map((n) => [n]),
    graph_summary: { nodes },
    row_count: rowCount,
  }
}

beforeEach(() => {
  cyConstructorCalls.length = 0
  layoutCalls.length = 0
  lastCyInstance = null
  destroyMock.mockClear()
  onMock.mockClear()
  queryMock.mockReset()
  // NB: useMock is intentionally NOT cleared — cytoscape.use(fcose)/
  // cytoscape.use(dagre) run once at GraphView module load, before any
  // test's beforeEach, so the registration assertions read the
  // cumulative call list.
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

test('GraphView debounces rebuilds during streaming row_count growth', () => {
  // First render: no rebuild yet (debounce gate has not fired).
  const first = makeResp(1)
  const { rerender } = render(
    <ThemeProvider theme={theme}>
      <GraphView resp={first} />
    </ThemeProvider>
  )

  // Five rapid streaming updates (row_count grows each time).
  for (let i = 2; i <= 6; i += 1) {
    rerender(
      <ThemeProvider theme={theme}>
        <GraphView resp={makeResp(i)} />
      </ThemeProvider>
    )
  }

  // Before the debounce fires there should be at most one rebuild
  // (the leading initial mount). The previous behavior would have
  // produced 6 cytoscape() calls, one per update.
  expect(cyConstructorCalls.length).toBeLessThanOrEqual(1)

  // After the debounce window elapses we should converge to a single
  // rebuild for the final settled state.
  act(() => {
    jest.advanceTimersByTime(300)
  })
  expect(cyConstructorCalls.length).toBe(1)
})

test('GraphView rebuilds once on the final settled resp (single-shot)', () => {
  render(
    <ThemeProvider theme={theme}>
      <GraphView resp={makeResp(3)} />
    </ThemeProvider>
  )
  act(() => {
    jest.advanceTimersByTime(300)
  })
  expect(cyConstructorCalls.length).toBe(1)
})

test('GraphView rebuilds when row_count changes meaningfully (after debounce)', () => {
  const { rerender } = render(
    <ThemeProvider theme={theme}>
      <GraphView resp={makeResp(2)} />
    </ThemeProvider>
  )
  act(() => {
    jest.advanceTimersByTime(300)
  })
  expect(cyConstructorCalls.length).toBe(1)

  // Simulate a second, settled query result with a different row_count.
  rerender(
    <ThemeProvider theme={theme}>
      <GraphView resp={makeResp(5)} />
    </ThemeProvider>
  )
  act(() => {
    jest.advanceTimersByTime(300)
  })
  expect(cyConstructorCalls.length).toBe(2)
})

// GAP-01 / GAP-07: a query change that produces the SAME row_count as
// the previous query must still trigger a rebuild. The pre-fix
// behavior keyed the build effect on `respSignature(resp)` alone — a
// row_count that happened to match the previous run silently kept the
// old graph on screen.
test('GraphView rebuilds when query text changes (same row_count)', () => {
  const resp = makeResp(3)
  const { rerender } = render(
    <ThemeProvider theme={theme}>
      <GraphView resp={resp} query="MATCH (n:Person) RETURN n" />
    </ThemeProvider>
  )
  act(() => {
    jest.advanceTimersByTime(300)
  })
  expect(cyConstructorCalls.length).toBe(1)

  rerender(
    <ThemeProvider theme={theme}>
      <GraphView resp={resp} query="MATCH (n:Movie) RETURN n" />
    </ThemeProvider>
  )
  act(() => {
    jest.advanceTimersByTime(300)
  })
  expect(cyConstructorCalls.length).toBe(2)
})

// GAP-04: extractElements / cytoscape() can throw at build time. The
// pre-fix code had no try/catch around the build callback, so the
// throw propagated synchronously through setTimeout and surfaced as
// an unhandled promise rejection in the renderer with no visible
// feedback. After the fix the component renders an alert role with
// the error text.
test('GraphView surfaces build errors via an alert', () => {
  // Make cytoscape itself throw on the next instantiation; the factory
  // restores its default behavior automatically after one call.
  cyFactory.mockImplementationOnce(() => {
    throw new Error('boom: layout init failed')
  })

  const { container } = render(
    <ThemeProvider theme={theme}>
      <GraphView resp={makeResp(1)} />
    </ThemeProvider>
  )
  act(() => {
    jest.advanceTimersByTime(300)
  })
  const alert = container.querySelector('[role="alert"]')
  expect(alert).not.toBeNull()
  expect(alert?.textContent).toMatch(/boom: layout init failed/)
})

// GAP-05: when the response has rows but extractElements yields zero
// nodes/edges (e.g. a scalar projection), the canvas is blank. After
// the fix an empty-graph overlay is rendered.
test('GraphView shows an empty-graph overlay when there are no elements', () => {
  const empty = {
    rows: [],
    graph_summary: { nodes: [] },
    row_count: 0,
  }
  const { container } = render(
    <ThemeProvider theme={theme}>
      <GraphView resp={empty} />
    </ThemeProvider>
  )
  act(() => {
    jest.advanceTimersByTime(300)
  })
  const overlay = container.querySelector('[data-testid="graph-empty-state"]')
  expect(overlay).not.toBeNull()
})

// GAP-03: the canvas itself isn't keyboard-interactive, but the toolbar
// exposes a Find input so a keyboard-only user can search for nodes by
// id, label, or property value. (The legacy Selection-by-id sidebar block
// was removed in Task 3.3 — the toolbar Find input supersedes it.)
test('GraphView exposes a keyboard-accessible find input in the toolbar', () => {
  const resp = {
    rows: [],
    graph_summary: {
      nodes: [
        { id: 'n1', labels: ['Person'], properties: { name: 'Alice' } },
        { id: 'n2', labels: ['Person'], properties: { name: 'Bob' } },
      ],
    },
    row_count: 2,
  }
  const { container } = render(
    <ThemeProvider theme={theme}>
      <GraphView resp={resp} />
    </ThemeProvider>
  )
  act(() => {
    jest.advanceTimersByTime(300)
  })
  const findInput = container.querySelector('[data-testid="graph-find-input"]')
  expect(findInput).not.toBeNull()
})

// The sidebar (inspector + controls) can be collapsed via a toolbar
// toggle so the canvas claims the full width — most useful in the
// maximized result overlay but available in the inline view too. When
// collapsed the <Side> (and therefore every control block inside it) is
// removed from the DOM; toggling again brings it back.
test('GraphView sidebar-collapse toggle hides and restores the sidebar', () => {
  window.localStorage.clear()
  // Two distinct node-label buckets so the visibility-controls block
  // (gated on nodeLabelBuckets.size > 1) renders inside the sidebar.
  const resp = {
    rows: [],
    graph_summary: {
      nodes: [
        { id: 'n1', labels: ['Person'], properties: { name: 'Alice' } },
        { id: 'n2', labels: ['Movie'], properties: { title: 'The Matrix' } },
      ],
    },
    row_count: 2,
  } as unknown as QueryRespLike & { row_count?: number }
  const view = render(
    <ThemeProvider theme={theme}>
      <GraphView resp={resp} query="MATCH (n) RETURN n" />
    </ThemeProvider>
  )
  act(() => {
    jest.advanceTimersByTime(300)
  })

  // Sidebar is expanded by default — the control blocks are present.
  // graph-more-sidebar is a DropdownItem type="checkbox" so it carries
  // aria-checked (not aria-pressed). sidebarCollapsed=false → checked=false.
  const toggle = view.getByTestId('graph-more-sidebar')
  expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(view.queryByTestId('graph-visibility-controls')).not.toBeNull()
  expect(view.queryByTestId('graph-display-controls')).not.toBeNull()

  // Collapse — the whole sidebar (and its control blocks) is gone.
  fireEvent.click(toggle)
  expect(view.getByTestId('graph-more-sidebar')).toHaveAttribute(
    'aria-checked',
    'true'
  )
  expect(view.queryByTestId('graph-visibility-controls')).toBeNull()
  expect(view.queryByTestId('graph-display-controls')).toBeNull()
  // The toolbar (which hosts the toggle) is still there.
  expect(view.queryByTestId('graph-toolbar')).not.toBeNull()

  // Expand again — the sidebar and its blocks come back.
  fireEvent.click(view.getByTestId('graph-more-sidebar'))
  expect(view.getByTestId('graph-more-sidebar')).toHaveAttribute(
    'aria-checked',
    'false'
  )
  expect(view.queryByTestId('graph-visibility-controls')).not.toBeNull()
  expect(view.queryByTestId('graph-display-controls')).not.toBeNull()
})

// Reproduction tests for the "graph display options reset on re-run" bug.
//
// When the user clicks "Run" on the Query page, QueryPage.resetRunState()
// sets activeResp to null, which collapses the {activeResp && <GraphView/>}
// subtree and *unmounts* GraphView. When the new response arrives GraphView
// remounts fresh, so every component-local useState (layout, hiddenLabels,
// nodeLabelPrefs, edgeLabelPrefs) re-initialises to its default — the user
// loses their display configuration on every re-run, even when the re-run
// returns the same or similar data.
//
// These tests simulate that exact sequence: render GraphView with a resp,
// change a display option, unmount GraphView, then mount it again with a
// fresh-but-equivalent resp (a new object, same shape/data — what
// resetRunState + the new response produce). The expected post-fix
// behaviour is that the display option is still applied after the remount.
// On the current code (state owned by GraphView's useState) these
// assertions FAIL because the remount resets everything to defaults.
// Build a graph response with two distinct node-label buckets so the
// visibility-controls block (gated on nodeLabelBuckets.size > 1) and the
// per-label display selects both render. Each call returns a brand-new
// object — mirroring what QueryPage produces when a re-run resolves.
function makeGraphResp(): Record<string, unknown> {
  return {
    rows: [],
    graph_summary: {
      nodes: [
        { id: 1, labels: ['Person'], properties: { name: 'Alice' } },
        { id: 2, labels: ['Movie'], properties: { title: 'The Matrix' } },
      ],
      edges: [
        { id: 1, start_node: 1, end_node: 2, type: 'ACTED_IN', properties: {} },
      ],
    },
    row_count: 2,
  }
}

describe('graph display options survive a re-run remount', () => {
  function renderGraph(resp: unknown): ReturnType<typeof render> {
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView
          resp={resp as QueryRespLike & { row_count?: number }}
          query="MATCH (a:Person)-[r:ACTED_IN]->(m:Movie) RETURN a, r, m"
        />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })
    return view
  }

  beforeEach(() => {
    // Display prefs are expected to be persisted (the intended fix uses a
    // localStorage-backed store); clear it so each test starts clean.
    window.localStorage.clear()
  })

  test('layout-algorithm choice persists across an unmount/remount', () => {
    const first = renderGraph(makeGraphResp())
    const picker = first.getByTestId('graph-layout-picker') as HTMLSelectElement
    expect(picker.value).toBe('cose') // default

    fireEvent.change(picker, { target: { value: 'grid' } })
    expect(
      (first.getByTestId('graph-layout-picker') as HTMLSelectElement).value
    ).toBe('grid')

    // Simulate resetRunState() + the new response: unmount, then mount
    // a fresh GraphView with a brand-new (equivalent) resp object.
    first.unmount()
    const second = renderGraph(makeGraphResp())
    expect(
      (second.getByTestId('graph-layout-picker') as HTMLSelectElement).value
    ).toBe('grid')
  })

  test('node-label visibility toggle persists across an unmount/remount', () => {
    const first = renderGraph(makeGraphResp())
    const controls = first.getByTestId('graph-visibility-controls')
    // The "Person" bucket checkbox is checked (= visible) by default.
    const personToggle = within(controls).getByLabelText(
      /Person/
    ) as HTMLInputElement
    expect(personToggle.checked).toBe(true)

    // Hide the Person bucket.
    fireEvent.click(personToggle)
    expect(
      (
        within(first.getByTestId('graph-visibility-controls')).getByLabelText(
          /Person/
        ) as HTMLInputElement
      ).checked
    ).toBe(false)

    first.unmount()
    const second = renderGraph(makeGraphResp())
    const personToggleAfter = within(
      second.getByTestId('graph-visibility-controls')
    ).getByLabelText(/Person/) as HTMLInputElement
    expect(personToggleAfter.checked).toBe(false)
  })

  test('node label-field preference persists across an unmount/remount', () => {
    const first = renderGraph(makeGraphResp())
    const display = first.getByTestId('graph-display-controls')
    // First combobox in the display block is the per-label field picker
    // for the first node bucket ("Person"). Pick its non-default option.
    const selects = within(display).getAllByRole(
      'combobox'
    ) as HTMLSelectElement[]
    const personSelect = selects[0]!
    // Options: ['__default__', 'name'] — the first non-default key is the
    // property key 'name'.
    const nonDefault = Array.from(personSelect.options)
      .map((o) => o.value)
      .find((v) => v && v !== personSelect.value)
    expect(nonDefault).toBeTruthy()
    fireEvent.change(personSelect, { target: { value: nonDefault } })
    expect(
      (
        within(first.getByTestId('graph-display-controls')).getAllByRole(
          'combobox'
        )[0] as HTMLSelectElement
      ).value
    ).toBe(nonDefault)

    first.unmount()
    const second = renderGraph(makeGraphResp())
    expect(
      (
        within(second.getByTestId('graph-display-controls')).getAllByRole(
          'combobox'
        )[0] as HTMLSelectElement
      ).value
    ).toBe(nonDefault)
  })
})

// Reproduction tests for the "graph inspector renders raw JSON only" UX gap.
//
// Selecting a node/edge on the graph tab populates the right-hand inspector
// panel. Today the panel renders the element's data bag as a raw
// `<pre>{JSON.stringify(selected.data, null, 2)}</pre>` block with no
// data-testid and no structured view. The desired behaviour:
//
//   • The inspector defaults to a STRUCTURED property view — a key/value
//     <dl>/table of `selected.data.props`, with an identity header showing
//     `id` plus `labels` (node) / `type` + `source`/`target` (edge).
//   • A toggle (segmented control, with aria-pressed) switches to a "Raw
//     JSON" view — the current `<pre>` output — kept as an option, not the
//     default.
//   • The chosen view is sticky (persisted via useGraphPrefs.inspectorView).
//
// Stable testids the fix is expected to expose (asserted below):
//   graph-inspector            wrapper of the selected-element block
//   graph-inspector-view-props "Properties" toggle button (aria-pressed)
//   graph-inspector-view-json  "Raw JSON" toggle button (aria-pressed)
//   graph-inspector-props      the property <dl>/table
//   graph-inspector-json       the raw-JSON <pre>
//
// Node selection is driven through the existing keyboard id-picker
// (`graph-node-id-picker`) — the canvas itself isn't interactive in
// jsdom, and the picker resolves the typed id back to the element data via
// GraphView's nodeDataById map (built from extractElements), so this gives
// a deterministic node selection without poking the cytoscape mock.
//
// On the CURRENT code every getByTestId('graph-inspector*') query throws
// "Unable to find an element by: [data-testid=...]" — that is the expected
// pre-fix failure.
describe('graph inspector property view', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  // One node carrying a representative spread of property value types so
  // the structured view's per-type formatting is exercised: string,
  // number, boolean, null, array.
  function makeInspectableResp(): QueryRespLike & { row_count?: number } {
    return {
      rows: [],
      graph_summary: {
        nodes: [
          {
            id: 'n1',
            labels: ['Person'],
            properties: {
              name: 'Alice',
              age: 30,
              active: true,
              nickname: null,
              tags: ['a', 'b'],
            },
          },
        ],
      },
      row_count: 1,
    } as unknown as QueryRespLike & { row_count?: number }
  }

  function renderInspectable(): ReturnType<typeof render> {
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView
          resp={makeInspectableResp()}
          query="MATCH (n:Person) RETURN n"
        />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })
    return view
  }

  // Drive a deterministic node selection via the toolbar Find input.
  // fireEvent.change sets the internal `q` state; keyDown Enter picks the
  // first match (which is the node whose id contains the search string).
  function selectNode(view: ReturnType<typeof render>, id: string): void {
    const findInput = view.getByTestId('graph-find-input')
    fireEvent.change(findInput, { target: { value: id } })
    fireEvent.keyDown(findInput, { key: 'Enter' })
  }

  test('inspector defaults to the structured property view (not raw JSON)', () => {
    const view = renderInspectable()
    selectNode(view, 'n1')

    expect(view.getByTestId('graph-inspector')).toBeInTheDocument()
    // Structured view is the default …
    expect(view.getByTestId('graph-inspector-props')).toBeInTheDocument()
    // … and the raw-JSON block is not rendered.
    expect(view.queryByTestId('graph-inspector-json')).toBeNull()
  })

  test('property view lists prop keys/values and the identity header', () => {
    const view = renderInspectable()
    selectNode(view, 'n1')

    const props = view.getByTestId('graph-inspector-props')
    // Prop keys + values, with per-type formatting.
    expect(props).toHaveTextContent('name')
    expect(props).toHaveTextContent('Alice')
    expect(props).toHaveTextContent('age')
    expect(props).toHaveTextContent('30')
    expect(props).toHaveTextContent('active')
    expect(props).toHaveTextContent('true')
    expect(props).toHaveTextContent('nickname')
    expect(props).toHaveTextContent('null')
    expect(props).toHaveTextContent('tags')
    // Array rendering — the elements show up somewhere in the view.
    expect(props.textContent ?? '').toMatch(/a[\s\S]*b/)

    // Identity header: node id + label.
    const inspector = view.getByTestId('graph-inspector')
    expect(inspector).toHaveTextContent('n1')
    expect(inspector).toHaveTextContent('Person')
  })

  // Follow-up to the inspector fix: the structured property view must
  // present `props` keys in the SAME order TableView's data table would
  // order columns — `projectColumns` uses first-seen / insertion order
  // of the underlying object, NOT alphabetical. The current code does
  // `Object.keys(props).sort()`, so a node whose props are built in a
  // non-alphabetical key order shows them alphabetised in the inspector
  // while the table shows them in insertion order — an inconsistency.
  //
  // Here the node's `props` object is `{ zebra, apple, mango }` in that
  // key order: alphabetical would be `apple, mango, zebra` but
  // insertion order — what projectColumns emits — is `zebra, apple,
  // mango`. The inspector <dt> list must read `zebra, apple, mango`.
  test('property keys follow insertion order (matches projectColumns), not alphabetical', () => {
    const resp = {
      rows: [],
      graph_summary: {
        nodes: [
          {
            id: 'n1',
            labels: ['Person'],
            properties: { zebra: 1, apple: 2, mango: 3 },
          },
        ],
      },
      row_count: 1,
    } as unknown as QueryRespLike & { row_count?: number }
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView resp={resp} query="MATCH (n:Person) RETURN n" />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })
    selectNode(view, 'n1')

    const props = view.getByTestId('graph-inspector-props')
    const dtKeys = within(props)
      .getAllByRole('term')
      .map((dt) => dt.textContent)
    expect(dtKeys).toEqual(['zebra', 'apple', 'mango'])
  })

  test('toggling to "Raw JSON" swaps to the <pre> view and back', () => {
    const view = renderInspectable()
    selectNode(view, 'n1')

    const propsBtn = view.getByTestId('graph-inspector-view-props')
    const jsonBtn = view.getByTestId('graph-inspector-view-json')
    // Props is the active view to begin with.
    expect(propsBtn).toHaveAttribute('aria-pressed', 'true')
    expect(jsonBtn).toHaveAttribute('aria-pressed', 'false')

    // Switch to raw JSON.
    fireEvent.click(jsonBtn)
    const json = view.getByTestId('graph-inspector-json')
    expect(json).toBeInTheDocument()
    // The <pre> carries the JSON.stringify(selected.data, null, 2) output.
    expect(json.textContent ?? '').toContain('"id": "n1"')
    expect(view.queryByTestId('graph-inspector-props')).toBeNull()
    expect(view.getByTestId('graph-inspector-view-json')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(view.getByTestId('graph-inspector-view-props')).toHaveAttribute(
      'aria-pressed',
      'false'
    )

    // Switch back to the structured view.
    fireEvent.click(view.getByTestId('graph-inspector-view-props'))
    expect(view.getByTestId('graph-inspector-props')).toBeInTheDocument()
    expect(view.queryByTestId('graph-inspector-json')).toBeNull()
  })
})

// ------------------------------------------------------------------
// Phase 1 — graph-viz feature ports (fcose/dagre layouts, box select,
// group-by-label clustering, path mode).
// ------------------------------------------------------------------

// Minimal graph response: two nodes (distinct labels) + one edge.
const twoNodeOneEdgeResp: QueryRespLike & { row_count?: number } = {
  rows: [],
  graph_summary: {
    nodes: [
      { id: 1, labels: ['A'], properties: {} },
      { id: 2, labels: ['B'], properties: {} },
    ],
    edges: [{ id: 10, start_node: 1, end_node: 2, type: 'R', properties: {} }],
  },
  row_count: 2,
} as unknown as QueryRespLike & { row_count?: number }

function renderGV(
  resp: QueryRespLike & { row_count?: number }
): ReturnType<typeof render> {
  const view = render(
    <ThemeProvider theme={theme}>
      <GraphView resp={resp} />
    </ThemeProvider>
  )
  act(() => {
    jest.advanceTimersByTime(300)
  })
  return view
}

describe('Phase 1: layout extensions', () => {
  it('registers the fcose and dagre layout extensions at module load', () => {
    // GraphView.tsx must call cytoscape.use(fcose) and cytoscape.use(dagre)
    // at module scope. The mock records calls.
    const use = (cytoscape as unknown as { use: jest.Mock }).use
    expect(use).toHaveBeenCalled()
    expect(use.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

describe('Phase 1: fcose + dagre in the layout picker', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('offers fcose and dagre in the layout picker and applies them', () => {
    renderGV(twoNodeOneEdgeResp)
    const picker = screen.getByTestId(
      'graph-layout-picker'
    ) as HTMLSelectElement
    expect([...picker.options].map((o) => o.value)).toEqual(
      expect.arrayContaining([
        'cose',
        'fcose',
        'dagre',
        'breadthfirst',
        'circle',
        'concentric',
        'grid',
      ])
    )
    act(() => {
      fireEvent.change(picker, { target: { value: 'fcose' } })
    })
    expect(lastLayoutArg()).toMatchObject({ name: 'fcose' })
    act(() => {
      fireEvent.change(picker, { target: { value: 'dagre' } })
    })
    expect(lastLayoutArg()).toMatchObject({ name: 'dagre', rankDir: 'TB' })
  })
})

describe('Phase 1: box-selection mode toggle', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('toggles box-selection mode and reflects it on the cy instance', () => {
    renderGV(twoNodeOneEdgeResp)
    const toggle = screen.getByTestId('graph-selection-mode')
    // initial: pan mode → userPanningEnabled(true), boxSelectionEnabled(false)
    expect(lastCy().userPanningEnabled).toHaveBeenLastCalledWith(true)
    expect(lastCy().boxSelectionEnabled).toHaveBeenLastCalledWith(false)
    act(() => {
      fireEvent.click(toggle)
    })
    expect(lastCy().userPanningEnabled).toHaveBeenLastCalledWith(false)
    expect(lastCy().boxSelectionEnabled).toHaveBeenLastCalledWith(true)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Phase 1: group-by-label clustering', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('toggling group-by-label feeds compound elements to cytoscape', () => {
    renderGV(twoNodeOneEdgeResp)
    const toggle = screen.getByTestId('graph-cluster-toggle')
    act(() => {
      fireEvent.click(toggle)
    })
    // The build is debounced — let it run.
    act(() => {
      jest.advanceTimersByTime(300)
    })
    const els = lastCy().__lastElements as ElementDefinition[]
    expect(
      els.some(
        (e) =>
          (e.data as { isClusterParent?: boolean } | undefined)?.isClusterParent
      )
    ).toBe(true)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('GraphView — degree sizing toggle', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useGraphPrefs.setState({ degreeSizing: true })
  })

  it('exposes a graph-size-toggle that flips the sticky pref', () => {
    renderGV(twoNodeOneEdgeResp)
    const toggle = screen.getByTestId('graph-size-toggle')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    act(() => {
      fireEvent.click(toggle)
    })
    expect(useGraphPrefs.getState().degreeSizing).toBe(false)
    expect(
      screen.getByTestId('graph-size-toggle').getAttribute('aria-pressed')
    ).toBe('false')
  })
})

describe('Phase 1: path mode', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  // The cytoscape mock models the dijkstra→pathTo wiring (it cannot run a
  // real shortest-path search since there are no node positions in jsdom),
  // so this test pins the *wiring + class application*: entering path mode,
  // tapping a source then a target, calls cy.elements().dijkstra(...) and
  // applies the .highlighted / .dimmed classes, and the status line reports
  // a hop count; Clear-path tears it back down. See the plan's accepted
  // simpler alternative for Task 1.5.
  it('path mode highlights a path between two tapped nodes and clears it', () => {
    const resp = {
      rows: [],
      graph_summary: {
        nodes: [1, 2, 3, 4].map((id) => ({
          id,
          labels: ['N'],
          properties: {},
        })),
        edges: [
          { id: 12, start_node: 1, end_node: 2, type: 'R', properties: {} },
          { id: 23, start_node: 2, end_node: 3, type: 'R', properties: {} },
          { id: 14, start_node: 1, end_node: 4, type: 'R', properties: {} },
        ],
      },
      row_count: 4,
    } as unknown as QueryRespLike & { row_count?: number }
    renderGV(resp)
    const pathToggle = screen.getByTestId('graph-path-mode')
    act(() => {
      fireEvent.click(pathToggle)
    })
    expect(pathToggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/click the start node/i)).toBeInTheDocument()
    const cy = lastCy()
    const emitTap = cy.__emitTap as (k: string, id: string) => void
    act(() => {
      emitTap('node', '1')
    })
    expect(screen.getByText(/click the end node/i)).toBeInTheDocument()
    act(() => {
      emitTap('node', '3')
    })
    // n2 is on the synthesised mock path → highlighted; n4 is off it →
    // dimmed (the mock's difference() drops the path members).
    const classesOf = cy.__classesOf as (id: string) => string[]
    expect(classesOf('2')).toContain('highlighted')
    // Status line shows the hop count.
    expect(screen.getByTestId('graph-path-status')).toHaveTextContent(/path/i)
    // Clear path.
    act(() => {
      fireEvent.click(screen.getByTestId('graph-path-clear'))
    })
    expect(pathToggle).toHaveAttribute('aria-pressed', 'false')
  })
})

// ------------------------------------------------------------------
// Phase 2 — richer node inspector + hide/collapse workflow.
// ------------------------------------------------------------------

// A small graph with a hub node ('1') and two leaf neighbours ('2','3')
// plus a non-leaf neighbour ('4') that itself links to '5'. Used to
// exercise Collapse (only '2'/'3' get hidden) and Hide.
const hubGraphResp: QueryRespLike & { row_count?: number } = {
  rows: [],
  graph_summary: {
    nodes: [1, 2, 3, 4, 5].map((id) => ({
      id,
      labels: ['N'],
      properties: { name: `n${id}` },
    })),
    edges: [
      { id: 12, start_node: 1, end_node: 2, type: 'R', properties: {} },
      { id: 13, start_node: 1, end_node: 3, type: 'R', properties: {} },
      { id: 14, start_node: 1, end_node: 4, type: 'R', properties: {} },
      { id: 45, start_node: 4, end_node: 5, type: 'R', properties: {} },
    ],
  },
  row_count: 5,
} as unknown as QueryRespLike & { row_count?: number }

function renderHub(): ReturnType<typeof render> {
  window.localStorage.clear()
  const view = render(
    <ThemeProvider theme={theme}>
      <GraphView resp={hubGraphResp} query="MATCH (n) RETURN n" />
    </ThemeProvider>
  )
  act(() => {
    jest.advanceTimersByTime(300)
  })
  return view
}

// Select a node via the toolbar Find input (deterministic — the canvas
// isn't interactive in jsdom). fireEvent.change sets the internal `q`
// state; keyDown Enter picks the first match.
function pickNode(view: ReturnType<typeof render>, id: string): void {
  const findInput = view.getByTestId('graph-find-input')
  fireEvent.change(findInput, { target: { value: id } })
  fireEvent.keyDown(findInput, { key: 'Enter' })
}

describe('Phase 2: inspector Hide / Collapse actions', () => {
  it('Hide adds .hidden-node to the node and closes the inspector', () => {
    const view = renderHub()
    pickNode(view, '2')
    expect(view.getByTestId('graph-inspector')).toBeInTheDocument()
    const hideBtn = view.getByTestId('graph-action-hide')
    act(() => {
      fireEvent.click(hideBtn)
    })
    // The node gained the per-node hide class on the cy core.
    expect(classesOf('2')).toContain('hidden-node')
    // The inspector closed (the hidden node is gone from view).
    expect(view.queryByTestId('graph-inspector')).toBeNull()
  })

  it('Collapse hides the degree-1 leaf neighbours and keeps the node selected', () => {
    const view = renderHub()
    pickNode(view, '1')
    const collapseBtn = view.getByTestId('graph-action-collapse')
    act(() => {
      fireEvent.click(collapseBtn)
    })
    // '2' and '3' are leaves of '1' → hidden. '4' (degree 2) is not.
    expect(classesOf('2')).toContain('hidden-node')
    expect(classesOf('3')).toContain('hidden-node')
    expect(classesOf('4')).not.toContain('hidden-node')
    expect(classesOf('1')).not.toContain('hidden-node')
    // The node stays selected and a "2 neighbours collapsed" hint shows.
    expect(view.getByTestId('graph-inspector')).toBeInTheDocument()
    expect(view.getByTestId('graph-inspector')).toHaveTextContent(
      /2 neighbours collapsed/i
    )
  })

  // NOTE: the "edge selected → no Hide/Collapse actions" assertion was
  // previously driven through graph-edge-id-picker, which was removed in
  // Task 3.3 (the toolbar Find input only searches nodes). Edge selection
  // is covered by the E2E suite (20-node-inspector.spec.ts) via real
  // canvas interaction. Deferred to E2E post graph-edge-id-picker removal.
})

describe('Phase 2: Hidden / Collapsed restore lists', () => {
  it('lists hidden nodes and restores one from the list', () => {
    const view = renderHub()
    // Hide '2' then '3'.
    pickNode(view, '2')
    act(() => {
      fireEvent.click(view.getByTestId('graph-action-hide'))
    })
    pickNode(view, '3')
    act(() => {
      fireEvent.click(view.getByTestId('graph-action-hide'))
    })
    const list = view.getByTestId('graph-hidden-list')
    // Both ids show up in the list (the row text carries the id).
    expect(list).toHaveTextContent('2')
    expect(list).toHaveTextContent('3')
    // The heading shows the count.
    expect(view.getByText(/hidden \(2\)/i)).toBeInTheDocument()

    // Restore '3' via its row's button.
    const row3 = within(list)
      .getAllByRole('listitem')
      .find((li) => /(^|\D)3(\D|$)/.test(li.textContent ?? ''))
    expect(row3).toBeDefined()
    act(() => {
      fireEvent.click(within(row3!).getByRole('button', { name: /restore/i }))
    })
    // '3' un-hidden on the core, gone from the list; '2' still there.
    expect(classesOf('3')).not.toContain('hidden-node')
    expect(view.getByTestId('graph-hidden-list')).toHaveTextContent('2')
    expect(view.getByTestId('graph-hidden-list')).not.toHaveTextContent(
      /(^|\D)3(\D|$)/
    )
    expect(view.getByText(/hidden \(1\)/i)).toBeInTheDocument()
  })

  it('lists collapsed nodes and expands one — restoring its leaves', () => {
    const view = renderHub()
    pickNode(view, '1')
    act(() => {
      fireEvent.click(view.getByTestId('graph-action-collapse'))
    })
    // '1' is now in the Collapsed list.
    const collapsedList = view.getByTestId('graph-collapsed-list')
    expect(collapsedList).toHaveTextContent('1')
    expect(view.getByText(/collapsed \(1\)/i)).toBeInTheDocument()
    // Its leaves '2' and '3' are hidden, and (by design) also show in
    // the Hidden list.
    expect(view.getByTestId('graph-hidden-list')).toHaveTextContent('2')
    expect(view.getByTestId('graph-hidden-list')).toHaveTextContent('3')

    // Expand '1'.
    const row1 = within(collapsedList)
      .getAllByRole('listitem')
      .find((li) => /(^|\D)1(\D|$)/.test(li.textContent ?? ''))
    expect(row1).toBeDefined()
    act(() => {
      fireEvent.click(within(row1!).getByRole('button', { name: /expand/i }))
    })
    // Leaves un-hidden; '1' gone from the Collapsed list; the Hidden
    // list no longer carries the leaves.
    expect(classesOf('2')).not.toContain('hidden-node')
    expect(classesOf('3')).not.toContain('hidden-node')
    // After expanding, the Collapsed section is entirely hidden (no
    // collapsed entries remain) — the old "Collapsed (0)" heading is
    // gone; assert the section testid itself is absent instead.
    expect(view.queryByText(/collapsed \(1\)/i)).toBeNull()
    expect(view.queryByTestId('graph-section-collapsed')).toBeNull()
  })

  it('hides the Hidden and Collapsed sections when nothing is hidden or collapsed', () => {
    // Task 3.3: empty Hidden / Collapsed sections are omitted from the
    // render tree entirely (previously they rendered with an empty-state
    // "No hidden nodes." paragraph). Assert the section wrappers are absent.
    const view = renderHub()
    expect(view.queryByTestId('graph-section-hidden')).toBeNull()
    expect(view.queryByTestId('graph-section-collapsed')).toBeNull()
  })
})

describe('Phase 2: Explore neighbours', () => {
  // A real-node graph (numeric ids) so the explore action is enabled —
  // the statement-building uses Geode GQL's `id(n) = <id>` predicate
  // (supported by the connected build; see the geode docs / shell tests),
  // which only makes sense for nodes with a real numeric id.
  const realResp: QueryRespLike & { row_count?: number } = {
    rows: [],
    graph_summary: {
      nodes: [
        { id: 1, labels: ['Person'], properties: { name: 'Alice' } },
        { id: 2, labels: ['Movie'], properties: { title: 'M' } },
      ],
      edges: [
        { id: 9, start_node: 1, end_node: 2, type: 'ACTED_IN', properties: {} },
      ],
    },
    row_count: 2,
  } as unknown as QueryRespLike & { row_count?: number }

  function renderReal(query?: string): ReturnType<typeof render> {
    window.localStorage.clear()
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView resp={realResp} query={query ?? 'MATCH (n) RETURN n'} />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })
    return view
  }

  it('fetches the node 1-hop subgraph and merges the new elements', async () => {
    queryMock.mockResolvedValue({
      rows: [],
      graph_summary: {
        // node 1 (already present) plus a brand-new node 3 and an edge.
        nodes: [
          { id: 1, labels: ['Person'], properties: { name: 'Alice' } },
          { id: 3, labels: ['Movie'], properties: { title: 'NewMovie' } },
        ],
        edges: [
          {
            id: 13,
            start_node: 1,
            end_node: 3,
            type: 'ACTED_IN',
            properties: {},
          },
        ],
      },
      row_count: 2,
    })
    const view = renderReal()
    pickNode(view, '1')
    const exploreBtn = view.getByTestId('graph-action-explore')
    expect(exploreBtn).not.toBeDisabled()
    await act(async () => {
      fireEvent.click(exploreBtn)
    })
    // client.query was called with a statement carrying the node's id.
    expect(queryMock).toHaveBeenCalledTimes(1)
    const arg = queryMock.mock.calls[0][0] as {
      statement: string
      page_size?: number
      timeout_ms?: number
    }
    expect(arg.statement).toMatch(/id\([^)]*\)\s*=\s*1\b/)
    expect(arg.statement).toMatch(/RETURN/i)
    expect(arg.page_size).toBe(200)
    expect(arg.timeout_ms).toBe(30000)
    // The new element (node 3 + edge e13) was added to the core; node 1
    // and edge e9 were already present so they are NOT re-added.
    const addedIds = ((lastCy().__addCalls as unknown[]) ?? [])
      .flatMap((c) => (Array.isArray(c) ? c : [c]))
      .map((e) => (e as { data?: { id?: unknown } })?.data?.id)
      .map((x) => String(x))
    expect(addedIds).toEqual(expect.arrayContaining(['3', 'e13']))
    expect(addedIds).not.toContain('1')
    // A relayout was kicked after the merge.
    expect(lastCy().layout).toHaveBeenCalled()
  })

  it('disables the action for a synthesised / non-numeric node id', () => {
    // A scalar-only RETURN → synthesised nodes (ids like `p:Alice`),
    // which aren't real Geode node ids — the explore predicate can't be
    // built, so the button is disabled with an explanatory title.
    const synthResp = {
      rows: [['Alice', 'M']],
      columns: [{ name: 'name' }, { name: 'title' }],
      graph_summary: {},
      row_count: 1,
    } as unknown as QueryRespLike & { row_count?: number }
    window.localStorage.clear()
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView
          resp={synthResp}
          query="MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p.name, m.title"
        />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })
    // The synthesised node id for `p` is `p:Alice`.
    pickNode(view, 'p:Alice')
    const exploreBtn = view.getByTestId('graph-action-explore')
    expect(exploreBtn).toBeDisabled()
    expect(exploreBtn).toHaveAttribute('title')
  })

  it('surfaces a fetch failure via the graph error banner', async () => {
    queryMock.mockRejectedValue(new Error('explore boom'))
    const view = renderReal()
    pickNode(view, '1')
    await act(async () => {
      fireEvent.click(view.getByTestId('graph-action-explore'))
    })
    await waitFor(() => {
      expect(view.container.querySelector('[role="alert"]')).not.toBeNull()
    })
    const bannerText =
      view.container.querySelector('[role="alert"]')?.textContent ?? ''
    // The explore failure uses its own framing ("Could not load
    // neighbours: …") and is NOT wrapped again in the generic
    // "Failed to render graph: …" prefix.
    expect(bannerText).toMatch(/could not load neighbours: explore boom/i)
    expect(bannerText).not.toMatch(/failed to render graph/i)
  })
})

describe('GraphView — inspector neighbors', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('lists 1-hop neighbors of the selected node and jumps when clicked', () => {
    // Use the hub graph (node 1 connects to 2/3/4) so node "1" has
    // multiple real neighbours.
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView resp={hubGraphResp} query="MATCH (n) RETURN n" />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })

    // Pick node "1" via the toolbar Find input.
    fireEvent.change(view.getByTestId('graph-find-input'), {
      target: { value: '1' },
    })
    fireEvent.keyDown(view.getByTestId('graph-find-input'), { key: 'Enter' })

    // Neighbors panel should appear with at least one chip.
    const panel = view.getByTestId('graph-neighbors')
    expect(panel).toBeInTheDocument()

    // Click neighbor chip for node 2.
    const chip = view.getByTestId('graph-neighbor-chip-2')
    fireEvent.click(chip)

    // After clicking the neighbor, the inspector should describe node 2.
    expect(view.getByTestId('graph-inspector')).toHaveTextContent(/Node 2/i)
  })
})

describe('GraphView — pin action', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('Pin button toggles aria-pressed and locks the underlying node', () => {
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView resp={hubGraphResp} query="MATCH (n) RETURN n" />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })

    // Select node "1" via the toolbar Find input.
    fireEvent.change(view.getByTestId('graph-find-input'), {
      target: { value: '1' },
    })
    fireEvent.keyDown(view.getByTestId('graph-find-input'), { key: 'Enter' })
    const pin = view.getByTestId('graph-action-pin')
    expect(pin).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(pin)
    expect(pin).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(pin)
    expect(pin).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('GraphView — focus action', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('Focus action dims nodes more than N hops from the selection', () => {
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView resp={hubGraphResp} query="MATCH (n) RETURN n" />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })
    // Select node "1" via the toolbar Find input.
    fireEvent.change(view.getByTestId('graph-find-input'), {
      target: { value: '1' },
    })
    fireEvent.keyDown(view.getByTestId('graph-find-input'), { key: 'Enter' })
    const focusBtn = view.getByTestId('graph-action-focus')
    expect(focusBtn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(focusBtn)
    expect(focusBtn).toHaveAttribute('aria-pressed', 'true')
    // The slider/label is visible when focus is active.
    expect(view.getByTestId('graph-focus-hops')).toBeInTheDocument()
    // The canvas reflects the active state for e2e/visual assertions.
    expect(view.getByTestId('graph-canvas')).toHaveAttribute(
      'data-focus-active',
      'true'
    )
    // Clicking again clears.
    fireEvent.click(focusBtn)
    expect(focusBtn).toHaveAttribute('aria-pressed', 'false')
    expect(view.getByTestId('graph-canvas')).toHaveAttribute(
      'data-focus-active',
      'false'
    )
  })

  it('Focus action shows the persistent Clear chip; clicking it clears focus', () => {
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView resp={hubGraphResp} query="MATCH (n) RETURN n" />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })
    // Select node "1" via the toolbar Find input.
    fireEvent.change(view.getByTestId('graph-find-input'), {
      target: { value: '1' },
    })
    fireEvent.keyDown(view.getByTestId('graph-find-input'), { key: 'Enter' })
    fireEvent.click(view.getByTestId('graph-action-focus'))
    // The persistent chip is rendered.
    const chip = view.getByTestId('graph-focus-clear-chip')
    expect(chip).toBeInTheDocument()
    // Clicking the chip clears focus — chip vanishes and the canvas
    // attribute flips back to false.
    fireEvent.click(chip)
    expect(view.queryByTestId('graph-focus-clear-chip')).toBeNull()
    expect(view.getByTestId('graph-canvas')).toHaveAttribute(
      'data-focus-active',
      'false'
    )
  })
})

// ------------------------------------------------------------------
// Task 3 — radial context menu wiring. The hook itself can't be
// exercised end-to-end in jsdom (the cxtmenu extension expects a real
// Cytoscape Core with a canvas), so the test asserts that GraphView
// mounts useCxtMenu with the right arguments: a cyRef, a CxtMenuHandlers
// bag whose seven fields are all functions, a Theme, and a rebuild sig.
// ------------------------------------------------------------------
describe('GraphView — radial context menu', () => {
  afterEach(() => jest.clearAllMocks())

  it('mounts useCxtMenu with the orchestrator handlers, theme, and sig', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphView resp={hubGraphResp} query="MATCH (n) RETURN n" />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })
    expect(useCxtMenu).toHaveBeenCalled()
    const call = (useCxtMenu as jest.Mock).mock.calls[0][0]
    expect(call.cyRef).toBeDefined()
    expect(call.handlers.onZoomTo).toBeInstanceOf(Function)
    expect(call.handlers.onExpand).toBeInstanceOf(Function)
    expect(call.handlers.onHide).toBeInstanceOf(Function)
    expect(call.handlers.onCollapse).toBeInstanceOf(Function)
    expect(call.handlers.onFocus).toBeInstanceOf(Function)
    expect(call.handlers.onPin).toBeInstanceOf(Function)
    expect(call.handlers.onCopyId).toBeInstanceOf(Function)
    expect(call.theme).toBeDefined()
    expect(call.sig).toEqual(expect.any(String))
  })
})
