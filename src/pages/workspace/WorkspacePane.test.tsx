/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
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
    handle.onMessage({
      kind: 'schema',
      columns: [{ name: 'n', type: 'NODE' }],
    })
    handle.onMessage({ kind: 'rowBatch', rows: [[1]] })
    handle.onMessage({ kind: 'summary', row_count: 1, elapsed_ms: 1 })
    handle.onMessage({ kind: 'end' })
    expect(
      await screen.findByRole('tab', { name: /table/i })
    ).toBeInTheDocument()
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
