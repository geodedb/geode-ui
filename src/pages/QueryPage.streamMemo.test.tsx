/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'
import { LocalizationProvider } from '../services/i18n'
import { testTheme as theme } from '../test-utils/theme'

// PERF-2026-05-11-02 (#130) reproduction: in stream mode `activeResp`
// used to be `streamStateToResp(stream)` called inline on every render,
// so its identity changed on EVERY QueryPage render — even ones that
// have nothing to do with the streamed data (toggling the fullscreen
// maximize button, typing in the editor, etc). That busted
// TableView's `useMemo(() => projectColumns(resp), [resp, expand])`
// and JsonView's React.memo, so projectColumns re-ran per render and
// JsonView re-stringified per render.
//
// We mock the result components with render-counting stubs so we can
// observe how often a *new* `resp`/`data` reference reaches them, and
// drive a real streamQuery via a mock WebSocket.

// --- mock the heavy lazy leaves so QueryPage's React.lazy resolves ---
jest.mock('../monaco-bootstrap', () => ({}))
jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: (props: { value?: string }) => (
    <div data-testid="monaco-editor-stub">{props.value}</div>
  ),
}))
jest.mock('cytoscape', () => ({
  __esModule: true,
  default: () => ({
    on: jest.fn(),
    destroy: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    batch: (fn: () => void) => fn(),
    elements: () => ({ remove: jest.fn() }),
    layout: () => ({ run: jest.fn() }),
    nodes: () => ({ forEach: jest.fn() }),
    edges: () => ({ forEach: jest.fn() }),
    $id: () => ({ select: jest.fn() }),
  }),
}))
jest.mock('../api/client', () => ({
  client: { query: jest.fn() },
}))

// Render-counting stubs. Each records the sequence of distinct `resp` /
// `data` references it has been handed (by reference identity).
const tableViewRefs: unknown[] = []
const jsonViewRefs: unknown[] = []
jest.mock('../components/results/TableView', () => ({
  __esModule: true,
  TableView: ({ resp }: { resp: unknown }) => {
    if (
      tableViewRefs.length === 0 ||
      tableViewRefs[tableViewRefs.length - 1] !== resp
    ) {
      tableViewRefs.push(resp)
    }
    return <div data-testid="table-stub" />
  },
}))
jest.mock('../components/results/JsonView', () => ({
  __esModule: true,
  JsonView: ({ data }: { data: unknown }) => {
    if (
      jsonViewRefs.length === 0 ||
      jsonViewRefs[jsonViewRefs.length - 1] !== data
    ) {
      jsonViewRefs.push(data)
    }
    return <div data-testid="json-stub" />
  },
}))

// --- mock WebSocket so the real streamQuery() runs end-to-end --------
type Listener = (arg?: unknown) => void
interface MockWS {
  listeners: Record<string, Listener[]>
  send: jest.Mock
  close: jest.Mock
  fire: (type: string, data?: unknown) => void
}
let lastWS: MockWS | null = null
class MockWebSocket implements MockWS {
  listeners: Record<string, Listener[]> = {}

  send = jest.fn()

  close = jest.fn()

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastWS = this
  }

  addEventListener(type: string, cb: Listener): void {
    const list = this.listeners[type] || []
    list.push(cb)
    this.listeners[type] = list
  }

  fire(type: string, data?: unknown): void {
    const list = this.listeners[type] || []
    list.forEach((cb) => cb(data ?? {}))
  }
}

import { QueryPage } from './QueryPage'
import { useQueryPageStore } from '../lib/queryPageStore'
import { ConnectionsProvider } from '../api/connections'

beforeEach(() => {
  tableViewRefs.length = 0
  jsonViewRefs.length = 0
  lastWS = null
  // eslint-disable-next-line semi-style -- prettier emits the leading-semicolon protector
  ;(window as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket
  localStorage.removeItem('geode-ui.legacy-auth')
  // Reset the cross-route editor + result store so prior tests don't
  // leak state across cases (see QueryPage.test.tsx for the rationale).
  useQueryPageStore.getState().reset()
})

async function renderStreamingPage(): Promise<void> {
  render(
    <MemoryRouter>
      <LocalizationProvider>
        <ThemeProvider theme={theme}>
          <ConnectionsProvider initialConnections={[]}>
            <QueryPage />
          </ConnectionsProvider>
        </ThemeProvider>
      </LocalizationProvider>
    </MemoryRouter>
  )
  await waitFor(() =>
    expect(screen.getByTestId('monaco-editor-stub')).toBeInTheDocument()
  )
  // Flip stream mode on via the Options dropdown item, then Run.
  fireEvent.click(screen.getByTestId('query-options-stream'))
  fireEvent.click(screen.getByRole('button', { name: /run/i }))
  // Feed a schema + one batched-rows frame so the result panel mounts.
  const ws = lastWS!
  act(() => {
    ws.fire('open')
    ws.fire('message', {
      data: JSON.stringify({
        kind: 'schema',
        columns: [{ name: 'n', type: 'STRING' }],
      }),
    })
    ws.fire('message', {
      data: JSON.stringify({
        kind: 'rows',
        rows: [['alice'], ['bob']],
      }),
    })
    ws.fire('message', { data: JSON.stringify({ kind: 'end' }) })
  })
  await waitFor(() => expect(screen.getByRole('tablist')).toBeInTheDocument())
}

describe('PERF-2026-05-17-02 (#239): consecutive WS batches inside one animation frame coalesce into a single resp identity change', () => {
  // rAF queue under test: scripts capture pending rAF callbacks so the
  // test can fire multiple batches between frames, then flush exactly
  // one frame and observe one (not N) resp identity changes.
  let rafQueue: FrameRequestCallback[] = []
  let rafSpy: jest.SpyInstance | undefined
  let cancelSpy: jest.SpyInstance | undefined
  beforeEach(() => {
    rafQueue = []
    rafSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        rafQueue.push(cb)
        return rafQueue.length
      })
    cancelSpy = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation()
  })
  afterEach(() => {
    rafSpy?.mockRestore()
    cancelSpy?.mockRestore()
  })

  async function renderAndStartStream(): Promise<MockWS> {
    render(
      <MemoryRouter>
        <LocalizationProvider>
          <ThemeProvider theme={theme}>
            <ConnectionsProvider initialConnections={[]}>
              <QueryPage />
            </ConnectionsProvider>
          </ThemeProvider>
        </LocalizationProvider>
      </MemoryRouter>
    )
    await waitFor(() =>
      expect(screen.getByTestId('monaco-editor-stub')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByTestId('query-options-stream'))
    fireEvent.click(screen.getByRole('button', { name: /run/i }))
    const ws = lastWS!
    act(() => {
      ws.fire('open')
      ws.fire('message', {
        data: JSON.stringify({
          kind: 'schema',
          columns: [{ name: 'n', type: 'STRING' }],
        }),
      })
    })
    await waitFor(() => expect(screen.getByRole('tablist')).toBeInTheDocument())
    return ws
  }

  test('four batches in one frame produce a single coalesced resp identity change', async () => {
    const ws = await renderAndStartStream()
    const refsAfterSchema = tableViewRefs.length
    // Fire FOUR batches WITHOUT flushing the rAF in between. Each batch
    // bumps stream.rowsVersion synchronously but, with the rAF throttle,
    // only the pending frame can advance throttledVersion.
    act(() => {
      for (let i = 0; i < 4; i += 1) {
        ws.fire('message', {
          data: JSON.stringify({
            kind: 'rows',
            rows: [[`row-${i}`]],
          }),
        })
      }
    })
    // Pre-flush: throttledVersion has not advanced, so the memo deps
    // are still those from the schema render — no new resp identity.
    expect(tableViewRefs.length).toBe(refsAfterSchema)
    // Flush exactly one animation frame. The single rAF callback bumps
    // throttledVersion to the latest rowsVersion (which is 4), and the
    // memo recomputes ONCE — one new resp identity, not four.
    act(() => {
      const cbs = rafQueue.splice(0)
      cbs.forEach((cb) => cb(performance.now()))
    })
    expect(tableViewRefs.length).toBe(refsAfterSchema + 1)
    // Cleanup: end the stream so the unmount cleanup path is exercised
    // without the act-warning gate firing on a late rAF callback.
    act(() => {
      ws.fire('message', { data: JSON.stringify({ kind: 'end' }) })
    })
  })
})

describe('PERF-2026-05-11-02 (#130): streamStateToResp identity is stable across unrelated re-renders', () => {
  test('toggling the fullscreen maximize button does NOT hand TableView a new resp reference', async () => {
    await renderStreamingPage()
    const refsAfterStream = tableViewRefs.length
    expect(refsAfterStream).toBeGreaterThan(0)

    // Toggle the fullscreen overlay a few times — these re-render
    // QueryPage but change nothing about the streamed data.
    const toggle = screen.getByTestId('result-fullscreen-toggle')
    fireEvent.click(toggle)
    fireEvent.click(screen.getByTestId('result-fullscreen-toggle'))
    fireEvent.click(screen.getByTestId('result-fullscreen-toggle'))

    // No new `resp` identity reached TableView — the useMemo held.
    expect(tableViewRefs.length).toBe(refsAfterStream)
  })

  test('switching to the JSON tab and toggling fullscreen does NOT re-hand JsonView a new data reference', async () => {
    await renderStreamingPage()
    fireEvent.click(screen.getByRole('tab', { name: /json/i }))
    await waitFor(() =>
      expect(screen.getByTestId('json-stub')).toBeInTheDocument()
    )
    const refsAfterTabSwitch = jsonViewRefs.length
    expect(refsAfterTabSwitch).toBeGreaterThan(0)

    fireEvent.click(screen.getByTestId('result-fullscreen-toggle'))
    fireEvent.click(screen.getByTestId('result-fullscreen-toggle'))

    expect(jsonViewRefs.length).toBe(refsAfterTabSwitch)
  })
})
