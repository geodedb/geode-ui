/// <reference types="@testing-library/jest-dom" />
/* eslint-disable no-underscore-dangle */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

// QUALITY #164: layout slice of the GraphView test suite — covers Phase 1
// layout extension registrations (fcose/dagre), the layout picker, the
// box-selection mode toggle, group-by-label clustering, the degree
// sizing toggle, and path-mode highlighting. Shared cytoscape mocks
// live in __tests__/graphViewMocks.ts.

import { graphViewHarness } from './test-helpers/graphViewMocks'

const { resetCalls, lastCy, lastLayoutArg } = graphViewHarness

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
import cytoscape from 'cytoscape'
import type { ElementDefinition } from 'cytoscape'
import type { QueryRespLike } from '../../lib/graphResult'
import { useGraphPrefs } from './useGraphPrefs'

import { testTheme as theme } from '../../test-utils/theme'

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

beforeEach(() => {
  resetCalls()
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

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
    // The picker is now a Bootstrap dropdown (Bug C fix). The trigger
    // button carries the data-testid; each option is a dropdown-item
    // button keyed by translated label. Open the menu, then click the
    // option matching the desired layout.
    const trigger = screen.getByTestId('graph-layout-picker')
    expect(trigger.tagName.toUpperCase()).not.toBe('SELECT')
    act(() => {
      fireEvent.click(trigger)
    })
    // Every layout must surface a listbox option (the translated label
    // is rendered as the option's accessible name).
    const options = screen.getAllByRole('option')
    const optionTexts = options.map((o) => o.textContent?.toLowerCase() ?? '')
    expect(optionTexts.length).toBeGreaterThanOrEqual(7)
    expect(optionTexts.join('|')).toMatch(/cose/)
    expect(optionTexts.join('|')).toMatch(/fast/)
    expect(optionTexts.join('|')).toMatch(/dag/i)
    expect(optionTexts.join('|')).toMatch(/breadth-first/)
    expect(optionTexts.join('|')).toMatch(/circle/)
    expect(optionTexts.join('|')).toMatch(/concentric/)
    expect(optionTexts.join('|')).toMatch(/grid/)
    // Pick fcose ("Force (fast)").
    const fcose = screen.getByRole('option', { name: /Force \(fast\)/i })
    act(() => {
      fireEvent.click(fcose)
    })
    expect(lastLayoutArg()).toMatchObject({ name: 'fcose' })
    // Re-open the menu and pick dagre ("Layered (DAG)").
    act(() => {
      fireEvent.click(screen.getByTestId('graph-layout-picker'))
    })
    const dagre = screen.getByRole('option', { name: /Layered \(DAG\)/i })
    act(() => {
      fireEvent.click(dagre)
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
    const localClassesOf = cy.__classesOf as (id: string) => string[]
    expect(localClassesOf('2')).toContain('highlighted')
    expect(screen.getByTestId('graph-path-status')).toHaveTextContent(/path/i)
    act(() => {
      fireEvent.click(screen.getByTestId('graph-path-clear'))
    })
    expect(pathToggle).toHaveAttribute('aria-pressed', 'false')
  })
})
