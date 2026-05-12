/// <reference types="@testing-library/jest-dom" />
import fs from 'fs'
import path from 'path'
import React from 'react'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { LocalizationProvider } from '../services/i18n'
import { testTheme as theme } from '../test-utils/theme'

// F10 (#54) — Monaco + Cytoscape lazy code-split.
//
// QueryPage now imports the Monaco-backed GqlEditor and the
// Cytoscape-backed GraphView via React.lazy(() => import(...)) behind
// <Suspense> boundaries. These tests pin two things:
//   1. The editor renders behind a Suspense boundary — the
//      "Loading editor…" fallback shows synchronously on first render,
//      then the lazily-imported editor mounts.
//   2. The monaco-bootstrap side-effect (which wires the bundled
//      monaco instance) rides inside the lazy GqlEditor module, not the
//      entry chunk — so it must NOT be a static import of QueryPage.
//
// We mock the heavy leaf modules (@monaco-editor/react, cytoscape) and
// the monaco-bootstrap side-effect so jest doesn't have to load the
// real (multi-MiB) Monaco bundle. The lazy boundary itself is exercised
// for real: React.lazy resolves the dynamic import to the (mocked)
// editor component asynchronously, which is what makes the Suspense
// fallback observable.
jest.mock('../monaco-bootstrap', () => ({}))
jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: (props: { value?: string }) => (
    <div data-testid="monaco-editor-stub">{props.value}</div>
  ),
}))
jest.mock('cytoscape', () => {
  const coll = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      forEach: jest.fn(),
      remove: jest.fn(),
      length: 0,
      empty: () => true,
    }
    const chain = (): Record<string, unknown> => c
    c.removeClass = chain
    c.addClass = chain
    c.difference = chain
    return c
  }
  const factory = () => ({
    on: jest.fn(),
    destroy: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    batch: (fn: () => void) => fn(),
    elements: coll,
    layout: () => ({ run: jest.fn() }),
    nodes: () => ({ forEach: jest.fn(), length: 0 }),
    edges: () => ({ forEach: jest.fn(), length: 0 }),
    $id: () => ({ select: jest.fn() }),
    getElementById: () => coll(),
    fit: jest.fn(),
    zoom: jest.fn(() => 1),
    width: jest.fn(() => 400),
    height: jest.fn(() => 300),
    style: jest.fn(() => ({ update: jest.fn() })),
    userPanningEnabled: jest.fn(),
    boxSelectionEnabled: jest.fn(),
  })
  const withUse = factory as unknown as { use: jest.Mock }
  withUse.use = jest.fn()
  return { __esModule: true, default: factory }
})
// The generated client's constructor snapshots fetch at construction
// time; the polyfill provides a rejecting stub, which is fine here —
// the maximize/fullscreen tests below mock `client.query` directly so
// they can drive a real result panel without touching the network.
const queryMock = jest.fn()
jest.mock('../api/client', () => ({
  client: {
    query: (...args: unknown[]): Promise<unknown> => queryMock(...args),
  },
}))

import { QueryPage } from './QueryPage'

function renderPage(): void {
  render(
    <LocalizationProvider>
      <ThemeProvider theme={theme}>
        <QueryPage />
      </ThemeProvider>
    </LocalizationProvider>
  )
}

describe('F10: QueryPage lazy-loads Monaco behind a Suspense boundary', () => {
  test('shows the editor loading fallback, then mounts the lazy editor', async () => {
    renderPage()

    // First synchronous render: the lazy chunk has not resolved yet, so
    // the Suspense fallback is on screen.
    expect(screen.getByRole('status')).toHaveTextContent(/loading editor/i)
    expect(screen.queryByTestId('monaco-editor-stub')).not.toBeInTheDocument()

    // React.lazy resolves the dynamic import on a microtask; the real
    // (mocked) editor then replaces the fallback.
    await waitFor(() =>
      expect(screen.getByTestId('monaco-editor-stub')).toBeInTheDocument()
    )
    // The default statement flows through to the editor value.
    expect(screen.getByTestId('monaco-editor-stub')).toHaveTextContent(
      'MATCH (n) RETURN n LIMIT 25'
    )
  })
})

describe('F10: monaco-bootstrap is not a static import of QueryPage', () => {
  test('QueryPage module does not eagerly pull in monaco-bootstrap', () => {
    // The contract: monaco-editor / @monaco-editor/react are reachable
    // from QueryPage ONLY through the lazy import(). The QueryPage
    // source must not contain a top-level static import of the editor /
    // graph modules (those were replaced by React.lazy()).
    const src = fs.readFileSync(path.join(__dirname, 'QueryPage.tsx'), 'utf8')
    expect(src).not.toMatch(
      /^\s*import\s+\{\s*GqlEditor\s*\}\s+from\s+'\.\.\/components\/editor\/GqlEditor'/m
    )
    expect(src).not.toMatch(
      /^\s*import\s+\{\s*GraphView\s*\}\s+from\s+'\.\.\/components\/results\/GraphView'/m
    )
    // Both are React.lazy'd via a dynamic import().
    expect(src).toMatch(
      /React\.lazy\([\s\S]*import\(['"]\.\.\/components\/editor\/GqlEditor['"]\)/
    )
    expect(src).toMatch(
      /React\.lazy\([\s\S]*import\(['"]\.\.\/components\/results\/GraphView['"]\)/
    )
  })
})

describe('F10: src/index.tsx no longer eagerly imports monaco-bootstrap', () => {
  test('the entry module does not statically import monaco-bootstrap', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'index.tsx'), 'utf8')
    expect(src).not.toMatch(/^\s*import\s+'\.\/monaco-bootstrap'/m)
  })
})

// Reproduction tests for the "result panel can't fill the viewport / has
// no maximize affordance" gap.
//
// On the Query page the result panel (the table/json/graph tabs below
// the Monaco editor) is height-capped (TableView body ≈ min(60vh,720px),
// JsonView <pre> ≈ 480px, GraphView canvas+sidebar = fixed 480px) and
// there is no maximize/fullscreen toggle anywhere. The desired
// behaviour: a per-session "maximize results" toggle in the result-panel
// toolbar (the Tabs row) that expands the result panel into a
// `position: fixed; inset: 0` overlay over the whole viewport, working
// for whichever tab is active, dismissable via Escape AND the same
// toggle button.
//
// Stable contract the fix is expected to expose (asserted below):
//   result-fullscreen-toggle   the toggle button (aria-pressed reflects state)
//   result-fullscreen-overlay  the position:fixed; inset:0 overlay container
//
// On the CURRENT code both getByTestId('result-fullscreen-*') queries
// throw "Unable to find an element by: [data-testid=...]" — that is the
// expected pre-fix failure.
describe('result panel maximize / fullscreen', () => {
  beforeEach(() => {
    queryMock.mockReset()
    queryMock.mockResolvedValue({
      columns: [{ name: 'n', type: 'STRING' }],
      rows: [['alice'], ['bob']],
      row_count: 2,
      elapsed_ms: 3,
    })
  })

  // Render QueryPage, wait for the lazy editor to mount, click Run,
  // then wait for the result tabs to appear. Returns the rendered view.
  async function renderWithResults(): Promise<ReturnType<typeof render>> {
    const view = render(
      <LocalizationProvider>
        <ThemeProvider theme={theme}>
          <QueryPage />
        </ThemeProvider>
      </LocalizationProvider>
    )
    // Wait for the lazy Monaco stub so the "Run" button is interactive.
    await waitFor(() =>
      expect(view.getByTestId('monaco-editor-stub')).toBeInTheDocument()
    )
    fireEvent.click(view.getByRole('button', { name: /run/i }))
    // The result tablist only renders once a response resolves.
    await waitFor(() => expect(view.getByRole('tablist')).toBeInTheDocument())
    return view
  }

  test('not maximized by default; the toggle exists and aria-pressed is false', async () => {
    const view = await renderWithResults()
    const toggle = view.getByTestId('result-fullscreen-toggle')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(view.queryByTestId('result-fullscreen-overlay')).toBeNull()
  })

  test('toggle opens a position:fixed inset:0 overlay containing the active tabpanel; Escape closes it', async () => {
    const view = await renderWithResults()
    const toggle = view.getByTestId('result-fullscreen-toggle')

    // Maximize.
    fireEvent.click(toggle)
    const overlay = view.getByTestId('result-fullscreen-overlay')
    expect(overlay).toBeInTheDocument()
    expect(getComputedStyle(overlay).position).toBe('fixed')
    // aria-pressed flips on the toggle (the button itself stays in the
    // toolbar — query it fresh in case it re-renders inside the overlay).
    expect(view.getByTestId('result-fullscreen-toggle')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    // The active result tabpanel must live inside the overlay so it can
    // expand to fill it.
    const panel = view.getByRole('tabpanel')
    expect(panel.id).toBe('result-panel-table')
    expect(overlay.contains(panel)).toBe(true)

    // Escape closes the overlay.
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(view.queryByTestId('result-fullscreen-overlay')).toBeNull()
    )
    expect(view.getByTestId('result-fullscreen-toggle')).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  test('the toggle button closes the overlay too (toggles both ways)', async () => {
    const view = await renderWithResults()

    fireEvent.click(view.getByTestId('result-fullscreen-toggle'))
    expect(view.getByTestId('result-fullscreen-overlay')).toBeInTheDocument()

    fireEvent.click(view.getByTestId('result-fullscreen-toggle'))
    await waitFor(() =>
      expect(view.queryByTestId('result-fullscreen-overlay')).toBeNull()
    )

    // And once more — it must keep toggling.
    fireEvent.click(view.getByTestId('result-fullscreen-toggle'))
    expect(view.getByTestId('result-fullscreen-overlay')).toBeInTheDocument()
  })

  test('the overlay works for the graph tab too (toggle lives in the toolbar, not a single result component)', async () => {
    const view = await renderWithResults()
    // Switch to the graph tab first.
    fireEvent.click(view.getByRole('tab', { name: 'graph' }))
    await waitFor(() => {
      const panel = view.getByRole('tabpanel')
      expect(panel.id).toBe('result-panel-graph')
    })
    // Now maximize — the toggle must still be present and produce the
    // overlay around the graph tabpanel.
    fireEvent.click(view.getByTestId('result-fullscreen-toggle'))
    const overlay = view.getByTestId('result-fullscreen-overlay')
    expect(getComputedStyle(overlay).position).toBe('fixed')
    const panel = within(overlay).getByRole('tabpanel')
    expect(panel.id).toBe('result-panel-graph')
  })
})
