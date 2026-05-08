/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { act, render } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

// Capture the constructor calls from cytoscape so we can assert that
// repeated streaming `resp` updates do NOT tear down + rebuild the
// Cytoscape Core on every render. The mock returns a thin stub that
// honors the methods GraphView touches.
const cyConstructorCalls: unknown[] = []
const destroyMock = jest.fn()
const onMock = jest.fn()

// jest.fn-backed factory so individual tests can override behavior
// (e.g. force a throw) via mockImplementationOnce.
const cyFactory = jest.fn((opts: unknown) => {
  cyConstructorCalls.push(opts)
  return {
    on: onMock,
    destroy: destroyMock,
    add: jest.fn(),
    remove: jest.fn(),
    batch: (fn: () => void) => fn(),
    elements: () => ({ remove: jest.fn() }),
    layout: () => ({ run: jest.fn() }),
    nodes: () => ({ forEach: jest.fn() }),
    edges: () => ({ forEach: jest.fn() }),
    $id: () => ({ select: jest.fn() }),
  }
})

jest.mock('cytoscape', () => ({ __esModule: true, default: cyFactory }))

// Import after the mock is in place.
import { GraphView } from './GraphView'

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
