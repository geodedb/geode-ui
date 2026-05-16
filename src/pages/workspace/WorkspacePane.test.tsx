/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../test-utils/theme'

jest.mock('../../components/editor/GqlEditor', () => ({
  __esModule: true,
  GqlEditor: ({
    value,
    onChange,
    onRun,
  }: {
    value: string
    onChange: (v: string) => void
    onRun: () => void
  }) => (
    <div>
      <textarea
        data-testid="pane-editor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button data-testid="pane-editor-run" onClick={onRun}>
        run
      </button>
    </div>
  ),
}))
jest.mock('../../components/results/GraphView', () => ({
  __esModule: true,
  GraphView: () => <div />,
}))
const streamHandles: Array<{
  statement: string
  onMessage: (m: unknown) => void
}> = []
jest.mock('../../lib/queryStream', () => ({
  streamQuery: (
    statement: string,
    _g: unknown,
    onMessage: (m: unknown) => void
  ) => {
    streamHandles.push({ statement, onMessage })
    return { cancel: jest.fn(), done: Promise.resolve() }
  },
}))
import { WorkspacePane } from './WorkspacePane'

describe('WorkspacePane', () => {
  beforeEach(() => {
    streamHandles.length = 0
  })

  it('runs the pane statement and shows results', async () => {
    render(
      <ThemeProvider theme={theme}>
        <WorkspacePane paneId="pane-1" canClose={false} onClose={jest.fn()} />
      </ThemeProvider>
    )
    fireEvent.change(await screen.findByTestId('pane-editor'), {
      target: { value: 'MATCH (n) RETURN n LIMIT 1' },
    })
    fireEvent.click(screen.getByTestId('pane-run-btn'))
    const handle = streamHandles[0]
    if (!handle) throw new Error('streamQuery was not called')
    expect(handle.statement).toBe('MATCH (n) RETURN n LIMIT 1')
    // QUALITY #227: wrap the synthetic WS message deliveries in act()
    // so React knows the dispatches that follow are part of the test's
    // update boundary. Without this each `handle.onMessage(...)` call
    // schedules a reducer dispatch outside any act() block and fires
    // the "An update to WorkspacePane inside a test was not wrapped
    // in act(...)" warning.
    act(() => {
      handle.onMessage({
        kind: 'schema',
        columns: [{ name: 'n', type: 'NODE' }],
      })
      handle.onMessage({ kind: 'rowBatch', rows: [[1]] })
      handle.onMessage({ kind: 'summary', row_count: 1, elapsed_ms: 1 })
      handle.onMessage({ kind: 'end' })
    })
    expect(
      await screen.findByRole('tab', { name: /table/i })
    ).toBeInTheDocument()
  })

  it('suspends the Monaco editor when the pane scrolls out of view (PERF #213)', () => {
    // Capture IntersectionObserver callbacks via a factory-style shim
    // so the test can flip visibility. WorkspacePane defaults to
    // visible-on-first-render, so the editor renders initially.
    type IoCb = (entries: Array<{ isIntersecting: boolean }>) => void
    type FakeInstance = {
      observe: () => void
      disconnect: () => void
      unobserve: () => void
      takeRecords: () => IntersectionObserverEntry[]
    }
    const ioCallbacks: IoCb[] = []
    const originalIO = (
      globalThis as { IntersectionObserver?: typeof IntersectionObserver }
    ).IntersectionObserver
    const fake = function FakeIO(cb: IoCb): FakeInstance {
      ioCallbacks.push(cb)
      return {
        observe: () => undefined,
        disconnect: () => undefined,
        unobserve: () => undefined,
        takeRecords: () => [],
      }
    } as unknown
    const ioGlobal = globalThis as { IntersectionObserver?: unknown }
    ioGlobal.IntersectionObserver = fake as typeof IntersectionObserver
    try {
      render(
        <ThemeProvider theme={theme}>
          <WorkspacePane paneId="pane-1" canClose={false} onClose={jest.fn()} />
        </ThemeProvider>
      )
      // Editor mounts initially (visible-by-default), and the suspended
      // placeholder is not in the DOM yet.
      expect(screen.getByTestId('pane-editor')).toBeInTheDocument()
      expect(screen.queryByTestId('pane-editor-suspended')).toBeNull()
      // Simulate the pane scrolling off-screen.
      const cb = ioCallbacks[0]
      if (!cb) throw new Error('expected an IntersectionObserver callback')
      act(() => {
        cb([{ isIntersecting: false }])
      })
      // Editor unmounted; suspended placeholder takes its slot.
      expect(screen.queryByTestId('pane-editor')).toBeNull()
      expect(screen.getByTestId('pane-editor-suspended')).toBeInTheDocument()
      // The Run / Close controls stay visible — the stream state lives
      // on, only the editor is dropped.
      expect(screen.getByTestId('pane-run-btn')).toBeInTheDocument()
      expect(screen.getByTestId('pane-close-btn')).toBeInTheDocument()
      // Scrolling back into view re-mounts the editor.
      act(() => {
        cb([{ isIntersecting: true }])
      })
      expect(screen.getByTestId('pane-editor')).toBeInTheDocument()
      expect(screen.queryByTestId('pane-editor-suspended')).toBeNull()
    } finally {
      if (originalIO) {
        ioGlobal.IntersectionObserver = originalIO
      } else {
        delete ioGlobal.IntersectionObserver
      }
    }
  })

  it('close button calls onClose and is disabled when canClose is false', () => {
    const onClose = jest.fn()
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <WorkspacePane paneId="pane-1" canClose={false} onClose={onClose} />
      </ThemeProvider>
    )
    expect(screen.getByTestId('pane-close-btn')).toBeDisabled()
    rerender(
      <ThemeProvider theme={theme}>
        <WorkspacePane paneId="pane-1" canClose onClose={onClose} />
      </ThemeProvider>
    )
    fireEvent.click(screen.getByTestId('pane-close-btn'))
    expect(onClose).toHaveBeenCalledWith('pane-1')
  })
})
