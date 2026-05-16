/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { act, fireEvent, render } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

// QUALITY #164: lifecycle slice of the GraphView test suite — covers the
// debounced rebuild path, error/empty surfaces, the toolbar Find input,
// and the sidebar-collapse toggle. The cytoscape / api-client /
// useCxtMenu mocks are shared with the layout + interaction slices
// via __tests__/graphViewMocks.ts so the three files don't carry a
// duplicate ~350-line prologue.

import { graphViewHarness } from './test-helpers/graphViewMocks'

const { cyConstructorCalls, cyFactory, resetCalls } = graphViewHarness

jest.mock('cytoscape', () => {
  const fn = graphViewHarness.cyFactory as unknown as { use: jest.Mock }
  fn.use = graphViewHarness.useMock
  return { __esModule: true, default: fn }
})

jest.mock('../../api/client', () => ({
  client: {
    query: (...args: unknown[]): Promise<unknown> =>
      graphViewHarness.queryMock(...args),
  },
}))

jest.mock('./graph/useCxtMenu', () => ({
  useCxtMenu: jest.fn(),
  buildCommands: jest.requireActual('./graph/useCxtMenu').buildCommands,
}))

import { GraphView } from './GraphView'
import type { QueryRespLike } from '../../lib/graphResult'

import { testTheme as theme } from '../../test-utils/theme'

function makeResp(rowCount: number): {
  rows: unknown[][]
  graph_summary: {
    nodes: { id: number; labels: string[]; properties: Record<string, never> }[]
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
  resetCalls()
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

test('GraphView debounces rebuilds during streaming row_count growth', () => {
  const first = makeResp(1)
  const { rerender } = render(
    <ThemeProvider theme={theme}>
      <GraphView resp={first} />
    </ThemeProvider>
  )

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
// id, label, or property value. (The legacy Selection-by-id sidebar
// block was removed in Task 3.3 — the toolbar Find input supersedes it.)
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

  const toggle = view.getByTestId('graph-more-sidebar')
  expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(view.queryByTestId('graph-visibility-controls')).not.toBeNull()
  expect(view.queryByTestId('graph-display-controls')).not.toBeNull()

  fireEvent.click(toggle)
  expect(view.getByTestId('graph-more-sidebar')).toHaveAttribute(
    'aria-checked',
    'true'
  )
  expect(view.queryByTestId('graph-visibility-controls')).toBeNull()
  expect(view.queryByTestId('graph-display-controls')).toBeNull()
  expect(view.queryByTestId('graph-toolbar')).not.toBeNull()

  fireEvent.click(view.getByTestId('graph-more-sidebar'))
  expect(view.getByTestId('graph-more-sidebar')).toHaveAttribute(
    'aria-checked',
    'false'
  )
  expect(view.queryByTestId('graph-visibility-controls')).not.toBeNull()
  expect(view.queryByTestId('graph-display-controls')).not.toBeNull()
})
