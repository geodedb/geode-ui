/// <reference types="@testing-library/jest-dom" />
import fs from 'fs'
import path from 'path'
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
import { MemoryRouter } from 'react-router-dom'
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
import { useQueryHistory, entriesFor } from '../lib/useQueryHistory'
import { ConnectionsProvider } from '../api/connections'
import { useQueryPageStore } from '../lib/queryPageStore'

// The QueryPage editor + result state lives in a module-level zustand
// store so it can survive route navigation. The store therefore also
// survives ACROSS Jest tests inside the same worker — reset before
// every test so a previous case's `setStmt('MATCH (x) RETURN x')`
// doesn't leak into the next case that expects the default
// `MATCH (n) RETURN n LIMIT 25`.
beforeEach(() => {
  useQueryPageStore.getState().reset()
})

// QueryPage reads `?statement=` via react-router's useSearchParams, so it
// must be rendered inside a router. Wrap it in a MemoryRouter (default
// entry `/`) plus the i18n + theme providers.
const Wrappers: React.FC<{
  children: React.ReactNode
  initialEntries?: string[]
}> = ({ children, initialEntries = ['/'] }) => (
  <MemoryRouter initialEntries={initialEntries}>
    <LocalizationProvider>
      <ThemeProvider theme={theme}>
        {/* 2026-05-22 bug-fix: QueryPage now reads useActiveConnection
            so the per-profile query-history record(...) calls land in
            the right bucket. Empty provider so the hook returns null
            (history records under the '' profile slot). */}
        <ConnectionsProvider initialConnections={[]}>
          {children}
        </ConnectionsProvider>
      </ThemeProvider>
    </LocalizationProvider>
  </MemoryRouter>
)

function renderPage(initialEntries?: string[]): ReturnType<typeof render> {
  return render(
    <Wrappers initialEntries={initialEntries}>
      <QueryPage />
    </Wrappers>
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

// B4 — the dashboard's recent-queries card deep-links here with
// `?statement=<query>`. On mount QueryPage must copy that into the editor
// (then strip the param so a refresh / later edit isn't affected).
describe('B4: QueryPage prefills the editor from ?statement=', () => {
  test('the ?statement= query param becomes the editor value', async () => {
    renderPage(['/?statement=MATCH%20(x)%20RETURN%20x'])
    await waitFor(() =>
      expect(screen.getByTestId('monaco-editor-stub')).toHaveTextContent(
        'MATCH (x) RETURN x'
      )
    )
  })
})

// GAP-049: navigating from the schema explorer to QueryPage with a
// freshly staged query must NOT carry over the previous run's resp /
// err / submittedStmt. Pre-fix the result table from the prior query
// stayed rendered under the new statement, which a hurried operator
// could mis-read as the answer to the new question.
describe('GAP-049: schema-staged navigation resets per-run state', () => {
  test('staging a new statement clears resp / err / submittedStmt', async () => {
    // Arrange: seed the page store as if a query had just run.
    /* eslint-disable global-require */
    const { useQueryStore } = require('../lib/queryStore') as {
      useQueryStore: typeof import('../lib/queryStore').useQueryStore
    }
    /* eslint-enable global-require */
    useQueryPageStore.setState({
      resp: {
        rows: [['stale-row']],
        columns: ['c'],
      } as unknown as import('../lib/queryPageStore').QueryPageState['resp'],
      err: 'stale-error',
      submittedStmt: 'MATCH (old) RETURN old',
    })

    // Act: mount the page, then stage a new statement (simulating the
    // schema explorer's click → setStaged → navigate flow). The
    // setStaged call propagates through the zustand subscription into a
    // re-render → useEffect → setStmt/setResp chain, so wrap it in
    // act() to keep React's update batching observable.
    renderPage()
    act(() => {
      useQueryStore.getState().setStaged('MATCH (n:NewLabel) RETURN n')
    })

    // Assert: the staged effect copied the statement AND cleared the
    // stale per-run fields. Use waitFor because the effect runs after
    // mount; the assertion races the React effect queue.
    await waitFor(() => {
      const s = useQueryPageStore.getState()
      expect(s.resp).toBeNull()
      expect(s.err).toBeNull()
      expect(s.submittedStmt).toBe('')
      expect(s.stmt).toBe('MATCH (n:NewLabel) RETURN n')
    })
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
    // The editor is React.lazy'd via a dynamic import() from QueryPage.
    // The optional `/* webpackPrefetch ... */` magic-comment chunk added
    // in PERF #256 may sit between import( and the path literal — the
    // regex tolerates either form so the contract survives the perf
    // hint.
    expect(src).toMatch(
      /React\.lazy\([\s\S]*import\(\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]\.\.\/components\/editor\/GqlEditor['"]/
    )
    // The Cytoscape-backed GraphView now lives behind ResultPanel (the
    // shared tab switcher extracted in A0); it must be React.lazy'd
    // there, and ResultPanel must not statically import it.
    const panelSrc = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'results', 'ResultPanel.tsx'),
      'utf8'
    )
    expect(panelSrc).not.toMatch(
      /^\s*import\s+\{\s*GraphView\s*\}\s+from\s+'\.\/GraphView'/m
    )
    expect(panelSrc).toMatch(
      /React\.lazy\([\s\S]*import\(\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]\.\/GraphView['"]/
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
      <Wrappers>
        <QueryPage />
      </Wrappers>
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

// B1 — running a query records it into useQueryHistory. The sync path
// (client.query resolves) is exercised here; the store is reset between
// tests so the assertion isn't polluted by other runs in this file.
// 2026-05-22 operator-reported UX gap: "when querying the query box
// should become read-only and support a cancel option". Pre-fix the
// cancel button was gated on `streamMode && busy` — sync runs left
// the operator stuck with a busy spinner and no way to bail. The
// fix shows the cancel affordance whenever a query is in flight,
// stream OR sync.
describe('UX: cancel + readOnly during a sync run', () => {
  beforeEach(() => {
    queryMock.mockReset()
  })

  test('cancel button is visible while a sync run is in flight, even with streamMode=off', async () => {
    // Hold the sync query open with a never-resolving promise so the
    // busy state stays true for the assertion window.
    queryMock.mockImplementation(() => {
      // Never-resolving promise so the busy state stays true for the
      // assertion window.
      return new Promise<unknown>(() => {})
    })

    const view = render(
      <Wrappers>
        <QueryPage />
      </Wrappers>
    )
    await waitFor(() =>
      expect(view.getByTestId('monaco-editor-stub')).toBeInTheDocument()
    )
    // Default state is streamMode=off (sync). Click Run.
    fireEvent.click(view.getByRole('button', { name: /run/i }))
    // Cancel button must appear despite streamMode=off.
    await waitFor(() =>
      expect(view.getByTestId('query-cancel-btn')).toBeInTheDocument()
    )
  })

  test('clicking cancel during a sync run clears the busy state (spinner goes off)', async () => {
    queryMock.mockImplementation(() => {
      // Never-resolving promise so the busy state stays true for the
      // assertion window.
      return new Promise<unknown>(() => {})
    })

    const view = render(
      <Wrappers>
        <QueryPage />
      </Wrappers>
    )
    await waitFor(() =>
      expect(view.getByTestId('monaco-editor-stub')).toBeInTheDocument()
    )
    fireEvent.click(view.getByRole('button', { name: /run/i }))
    const cancelBtn = await waitFor(() => view.getByTestId('query-cancel-btn'))
    fireEvent.click(cancelBtn)
    // Post-cancel the cancel button itself disappears (busy=false →
    // ternary stops rendering it) — the most observable signal that
    // busy was cleared.
    await waitFor(() =>
      expect(view.queryByTestId('query-cancel-btn')).toBeNull()
    )
  })
})

describe('B1: running a query records it into the query history', () => {
  beforeEach(() => {
    localStorage.clear()
    useQueryHistory.setState({ byProfile: {} })
    queryMock.mockReset()
    queryMock.mockResolvedValue({
      columns: [{ name: 'n', type: 'STRING' }],
      rows: [['alice'], ['bob']],
      row_count: 2,
      elapsed_ms: 3,
    })
  })

  test('a successful sync run prepends a history entry with the run statement', async () => {
    const view = render(
      <Wrappers>
        <QueryPage />
      </Wrappers>
    )
    await waitFor(() =>
      expect(view.getByTestId('monaco-editor-stub')).toBeInTheDocument()
    )
    fireEvent.click(view.getByRole('button', { name: /run/i }))
    await waitFor(() => expect(view.getByRole('tablist')).toBeInTheDocument())
    // 2026-05-22 bug-fix: history is per-profile. Test mount has no
    // ConnectionsProvider entry, so the active profile resolves to
    // '' and the recorded entry lands in that bucket.
    await waitFor(() =>
      expect(entriesFor(useQueryHistory.getState(), '')).toHaveLength(1)
    )
    const entry = entriesFor(useQueryHistory.getState(), '')[0]
    expect(entry?.statement).toContain('MATCH (n) RETURN n LIMIT 25')
    expect(entry?.ok).toBe(true)
    expect(entry?.rowCount).toBe(2)
  })
})

// QUAL #289: rapid double-Run race regression. Pre-fix `runSync` had
// no AbortController + no generation guard, so if the user clicked Run
// twice in quick succession and the FIRST request resolved AFTER the
// SECOND, the stale response would clobber the freshly-rendered one
// (setResp(r1) ran after setResp(r2)). This test pins the fix's
// generation-counter contract: the slow first response is dropped on
// the floor and the fast second response stays visible.
describe('QUAL #289: rapid double-Run race', () => {
  beforeEach(() => {
    localStorage.clear()
    useQueryHistory.setState({ byProfile: {} })
    queryMock.mockReset()
  })

  test('a stale first response does not overwrite a fresh second response', async () => {
    // Stage two responses on independent promises so the test can
    // resolve them out of order: r2 first (fresh), then r1 (stale).
    let resolveR1: (v: unknown) => void = () => {}
    const firstPromise = new Promise((res) => {
      resolveR1 = res as (v: unknown) => void
    })
    const fresh = {
      columns: [{ name: 'fresh', type: 'STRING' }],
      rows: [['second-result']],
      row_count: 1,
      elapsed_ms: 1,
    }
    const stale = {
      columns: [{ name: 'stale', type: 'STRING' }],
      rows: [['first-result']],
      row_count: 1,
      elapsed_ms: 9,
    }
    queryMock
      .mockImplementationOnce(() => firstPromise)
      .mockResolvedValueOnce(fresh)

    const view = render(
      <Wrappers>
        <QueryPage />
      </Wrappers>
    )
    await waitFor(() =>
      expect(view.getByTestId('monaco-editor-stub')).toBeInTheDocument()
    )

    // First click — kicks off the slow first request.
    fireEvent.click(view.getByRole('button', { name: /run/i }))
    // Second click — kicks off the fast second request; its resolve
    // wins the visible result first.
    fireEvent.click(view.getByRole('button', { name: /run/i }))
    await waitFor(() =>
      expect(view.queryByText('second-result')).toBeInTheDocument()
    )

    // Now resolve the slow first request. Pre-fix this would call
    // setResp(stale) and overwrite the fresh render. Post-fix the
    // generation guard short-circuits the resolve and the visible
    // result stays at the second response.
    resolveR1(stale)
    // Give React a tick to process the (would-be) stale write.
    await new Promise((r) => {
      setTimeout(r, 10)
    })
    expect(view.queryByText('first-result')).toBeNull()
    expect(view.queryByText('second-result')).toBeInTheDocument()
  })
})

// Phase 3 — the Matrix result tab. It sits next to table/json/graph and
// renders <MatrixView resp={activeResp}> (the adjacency heatmap). For a
// result that carries a graph_summary with edges, switching to the tab
// must surface the MatrixView's `role="table"` heatmap.
describe('Matrix result tab', () => {
  beforeEach(() => {
    queryMock.mockReset()
    queryMock.mockResolvedValue({
      columns: [{ name: 'p', type: 'NODE' }],
      rows: [],
      row_count: 1,
      elapsed_ms: 2,
      graph_summary: {
        nodes: [
          { id: 1, labels: ['Person'], properties: {} },
          { id: 2, labels: ['Movie'], properties: {} },
        ],
        edges: [
          {
            id: 12,
            start_node: 1,
            end_node: 2,
            type: 'ACTED_IN',
            properties: {},
          },
        ],
      },
    })
  })

  async function renderWithResults(): Promise<ReturnType<typeof render>> {
    const view = render(
      <Wrappers>
        <QueryPage />
      </Wrappers>
    )
    await waitFor(() =>
      expect(view.getByTestId('monaco-editor-stub')).toBeInTheDocument()
    )
    fireEvent.click(view.getByRole('button', { name: /run/i }))
    await waitFor(() => expect(view.getByRole('tablist')).toBeInTheDocument())
    return view
  }

  test('renders a Matrix tab in the result panel; clicking it shows the MatrixView', async () => {
    const view = await renderWithResults()
    const matrixTab = view.getByRole('tab', { name: /matrix/i })
    expect(matrixTab).toBeInTheDocument()
    fireEvent.click(matrixTab)
    await waitFor(() => {
      const panel = view.getByRole('tabpanel')
      expect(panel.id).toBe('result-panel-matrix')
    })
    expect(view.getByRole('table')).toBeInTheDocument()
    expect(
      view.getByRole('columnheader', { name: /Movie/ })
    ).toBeInTheDocument()
  })
})

describe('QueryPage outer layout', () => {
  it('the page root is a flex column that lets the result region grow', () => {
    const { container } = renderPage()
    const root = container.firstChild as HTMLElement
    const cs = getComputedStyle(root)
    expect(cs.display).toBe('flex')
    expect(cs.flexDirection).toBe('column')
    expect(cs.flex).toMatch(/1 1 (0|auto)/)
    // jsdom normalises `min-height: 0` to either "0px" or "0" depending
    // on the version; accept both so the assertion doesn't track the
    // jsdom implementation detail.
    expect(cs.minHeight).toMatch(/^0(px)?$/)
  })
})

describe('QueryPage options dropdown', () => {
  it('moves stream + expand toggles into the Options dropdown', () => {
    renderPage()
    // The previous inline checkboxes are gone.
    expect(
      screen.queryByRole('checkbox', { name: /^Stream$/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: /^Expand graph cells$/ })
    ).not.toBeInTheDocument()
    // They live inside the new dropdown.
    expect(screen.getByTestId('query-options-stream')).toBeInTheDocument()
    expect(screen.getByTestId('query-options-expand')).toBeInTheDocument()
    expect(screen.getByTestId('query-options-dropdown')).toBeInTheDocument()
  })

  it('clicking the stream item toggles streamMode', () => {
    renderPage()
    const streamItem = screen.getByTestId('query-options-stream')
    // jsdom doesn't reliably forward Lit's wa-select; the DropdownItem
    // is also wired with a direct onClick handler that toggles state.
    fireEvent.click(streamItem)
    // After the click, aria-checked flips to 'true'.
    expect(streamItem).toHaveAttribute('aria-checked', 'true')
  })
})

describe('QueryPage v0.5.18 LSP formatting affordances', () => {
  it('renders a first-class Format button in the toolbar', () => {
    renderPage()
    const btn = screen.getByTestId('query-format-btn')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveAttribute('aria-label', expect.stringMatching(/format/i))
  })

  it('renders the Auto-format inserted queries option (default on)', () => {
    renderPage()
    const item = screen.getByTestId('query-options-auto-format')
    expect(item).toBeInTheDocument()
    // Default state: enabled (the persisted store seeds with true).
    expect(item).toHaveAttribute('aria-checked', 'true')
  })

  it('clicking the auto-format item flips its aria-checked state', () => {
    renderPage()
    const item = screen.getByTestId('query-options-auto-format')
    fireEvent.click(item)
    expect(item).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(item)
    expect(item).toHaveAttribute('aria-checked', 'true')
  })
})
