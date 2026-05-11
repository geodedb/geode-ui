/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { act, fireEvent, render, within } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

// Capture the constructor calls from cytoscape so we can assert that
// repeated streaming `resp` updates do NOT tear down + rebuild the
// Cytoscape Core on every render. The mock returns a thin stub that
// honors the methods GraphView touches.
const cyConstructorCalls: unknown[] = []
const destroyMock = jest.fn()
const onMock = jest.fn()

// A no-op chainable collection: every method returns the collection so
// `.removeClass(...).removeClass(...)` and friends don't blow up. forEach
// is a real no-op so per-element callbacks (which touch methods this stub
// doesn't model) are never invoked.
const makeColl = (): Record<string, unknown> => {
  const coll: Record<string, unknown> = {
    forEach: jest.fn(),
    remove: jest.fn(),
    length: 0,
    empty: () => true,
  }
  const chain = (): Record<string, unknown> => coll
  coll.addClass = chain
  coll.removeClass = chain
  coll.difference = chain
  coll.union = chain
  coll.connectedNodes = chain
  coll.closedNeighborhood = chain
  coll.select = chain
  return coll
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
  return {
    on: onMock,
    destroy: destroyMock,
    add: jest.fn(),
    remove: jest.fn(),
    batch: (fn: () => void) => fn(),
    elements: () => makeColl(),
    layout: () => ({ run: jest.fn() }),
    nodes: () => makeColl(),
    edges: () => makeColl(),
    $id: () => makeColl(),
    fit: jest.fn(),
    zoom: jest.fn(() => 1),
    width: jest.fn(() => 400),
    height: jest.fn(() => 300),
    style: jest.fn(() => style),
  }
})

jest.mock('cytoscape', () => ({ __esModule: true, default: cyFactory }))

// Import after the mock is in place.
import { GraphView } from './GraphView'
import type { QueryRespLike } from '../../lib/graphResult'

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
  destroyMock.mockClear()
  onMock.mockClear()
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

// GAP-03: the canvas itself isn't keyboard-interactive, but the
// Display panel exposes a "Select node by id" combobox / button so a
// keyboard-only user can still pick a node. Edge selection is
// available via id input as well.
test('GraphView exposes a keyboard-accessible node id picker', () => {
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
  const picker = container.querySelector('[data-testid="graph-node-id-picker"]')
  expect(picker).not.toBeNull()
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
