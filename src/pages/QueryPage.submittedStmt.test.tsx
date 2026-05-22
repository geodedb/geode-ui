/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'
import { LocalizationProvider } from '../services/i18n'
import { testTheme as theme } from '../test-utils/theme'

// PERF / Bug #6: every keystroke in the Monaco editor used to flow through
// QueryPage's `<ResultPanel query={stmt} />`, which threaded it into
// GraphView's `sig` string — busting the debounced cytoscape rebuild,
// cxtmenu remount, lasso re-apply, tooltip rebind, dom-node remount, and
// the sig-keyed reset on every character typed. The fix tracks a separate
// `submittedStmt` that ONLY updates when Run actually fires, and forwards
// THAT to <ResultPanel>.
//
// This test pins the new contract: ResultPanel's `query` prop must NOT
// reflect the live editor buffer; it must reflect the SUBMITTED statement.
// Pre-fix the captured queries grow as the user types ('', 'M', 'MA',
// 'MAT'); post-fix they remain '' until Run is clicked.

// --- mock heavy lazy leaves so React.lazy() resolves in jest ----------
jest.mock('../monaco-bootstrap', () => ({}))

// Monaco mock — render a real <textarea> so we can fire change events and
// drive the GqlEditor's onChange path end-to-end through QueryPage.
jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
  }: {
    value?: string
    onChange?: (v: string | undefined) => void
  }) => (
    <textarea
      data-testid="monaco-editor-stub"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}))

// Capture every `query` prop ResultPanel receives, in render order. We
// stub the whole module so the heavy GraphView / TableView / cytoscape
// stack never mounts — we only care about what QueryPage forwards.
const capturedQueries: Array<string | undefined> = []
jest.mock('../components/results/ResultPanel', () => ({
  __esModule: true,
  ResultPanel: ({ query }: { query?: string }) => {
    capturedQueries.push(query)
    return <div data-testid="result-panel-stub">{query ?? ''}</div>
  },
}))

// QueryPage's sync run path goes through client.query — stub it so a
// Run click resolves a deterministic response (and ResultPanel mounts).
const queryMock = jest.fn()
jest.mock('../api/client', () => ({
  client: {
    query: (...args: unknown[]): Promise<unknown> => queryMock(...args),
  },
}))

import { QueryPage } from './QueryPage'
import { ConnectionsProvider } from '../api/connections'

const Wrappers: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter initialEntries={['/']}>
    <LocalizationProvider>
      <ThemeProvider theme={theme}>
        <ConnectionsProvider initialConnections={[]}>
          {children}
        </ConnectionsProvider>
      </ThemeProvider>
    </LocalizationProvider>
  </MemoryRouter>
)

describe('QueryPage forwards SUBMITTED statement, not live buffer, to ResultPanel', () => {
  beforeEach(() => {
    capturedQueries.length = 0
    queryMock.mockReset()
    queryMock.mockResolvedValue({
      columns: [{ name: 'n', type: 'STRING' }],
      rows: [['alice']],
      row_count: 1,
      elapsed_ms: 1,
    })
  })

  test('typing in the editor does NOT change ResultPanel.query', async () => {
    const view = render(
      <Wrappers>
        <QueryPage />
      </Wrappers>
    )
    // Wait for the lazy editor to mount so we can drive keystrokes.
    await waitFor(() =>
      expect(view.getByTestId('monaco-editor-stub')).toBeInTheDocument()
    )

    // Drive a sync run so ResultPanel mounts at all (it only renders when
    // there is an active response). After this, ResultPanel.query should
    // reflect the SUBMITTED statement — the editor's default.
    fireEvent.click(view.getByRole('button', { name: /run/i }))
    await waitFor(() =>
      expect(view.getByTestId('result-panel-stub')).toBeInTheDocument()
    )

    const submitted = view.getByTestId('result-panel-stub').textContent ?? ''
    expect(submitted).toBe('MATCH (n) RETURN n LIMIT 25')

    // Snapshot how many query prop values ResultPanel has seen so we can
    // assert that subsequent keystrokes do NOT add new distinct values.
    const distinctBefore = new Set(capturedQueries)
    expect(distinctBefore.size).toBe(1)
    expect([...distinctBefore][0]).toBe('MATCH (n) RETURN n LIMIT 25')

    // Now simulate the user typing in the editor. Each keystroke updates
    // the editor buffer (`stmt`). Pre-fix, QueryPage forwarded `stmt` to
    // ResultPanel and capturedQueries would grow with every keystroke.
    // Post-fix, ResultPanel.query stays pinned to the submitted value.
    const editor = view.getByTestId('monaco-editor-stub') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'M' } })
    fireEvent.change(editor, { target: { value: 'MA' } })
    fireEvent.change(editor, { target: { value: 'MAT' } })

    const distinctAfter = new Set(capturedQueries)
    // The ONLY value ResultPanel.query should ever see is the submitted
    // statement — keystrokes must not introduce new query identities.
    expect([...distinctAfter]).toEqual(['MATCH (n) RETURN n LIMIT 25'])
  })
})
