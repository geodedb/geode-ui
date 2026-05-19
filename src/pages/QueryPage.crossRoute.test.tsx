/// <reference types="@testing-library/jest-dom" />
//
// Cross-route persistence contract for QueryPage.
//
// Symptom: clicking Schema or Admin while a query was loaded blew
// away the editor text + result panel. On returning to /, the user
// had to re-enter the query and re-run.
//
// Fix (queryPageStore.ts): hoist editor + result state into a
// module-level zustand singleton. The singleton survives the
// QueryPage component being unmounted, so a re-mount picks up the
// last state. AuthProvider.signOut / switchActive call reset() so
// new sessions / new connections start fresh.
//
// This file pins the contract by simulating route navigation
// (unmount + re-render) and asserting the editor and tab choice
// survive.

import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'
import { LocalizationProvider } from '../services/i18n'
import { testTheme as theme } from '../test-utils/theme'

jest.mock('../monaco-bootstrap', () => ({}))
jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: (props: { value?: string }) => (
    <div data-testid="monaco-editor-stub">{props.value}</div>
  ),
}))
jest.mock('cytoscape', () => {
  const factory = (): Record<string, unknown> => ({
    on: jest.fn(),
    destroy: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    batch: (fn: () => void) => fn(),
    elements: () => ({ length: 0, empty: () => true }),
    layout: () => ({ run: jest.fn() }),
    nodes: () => ({ forEach: jest.fn(), length: 0 }),
    edges: () => ({ forEach: jest.fn(), length: 0 }),
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

import { QueryPage } from './QueryPage'
import { useQueryPageStore } from '../lib/queryPageStore'

const Wrappers: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter initialEntries={['/']}>
    <LocalizationProvider>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </LocalizationProvider>
  </MemoryRouter>
)

beforeEach(() => {
  useQueryPageStore.getState().reset()
})

describe('QueryPage cross-route persistence (queryPageStore)', () => {
  it('preserves editor text across an unmount/remount (route navigation)', async () => {
    // First mount — user types a query.
    const first = render(
      <Wrappers>
        <QueryPage />
      </Wrappers>
    )
    await waitFor(() =>
      expect(screen.getByTestId('monaco-editor-stub')).toBeInTheDocument()
    )
    act(() => {
      useQueryPageStore
        .getState()
        .setStmt('USE GRAPH movies; MATCH (m:Movie) RETURN m LIMIT 5')
    })

    // Simulate route navigation away from QueryPage (user clicks Schema).
    first.unmount()

    // ... and back to QueryPage.
    render(
      <Wrappers>
        <QueryPage />
      </Wrappers>
    )
    await waitFor(() =>
      expect(screen.getByTestId('monaco-editor-stub')).toBeInTheDocument()
    )

    // Editor text survived the route round-trip.
    expect(screen.getByTestId('monaco-editor-stub')).toHaveTextContent(
      'USE GRAPH movies; MATCH (m:Movie) RETURN m LIMIT 5'
    )
  })

  it('preserves the active result tab across an unmount/remount', async () => {
    // Pre-load store with non-default tab + a result so the tab strip
    // mounts (it only renders when activeResp is non-null).
    useQueryPageStore.getState().setTab('graph')
    useQueryPageStore.getState().setResp({
      columns: [{ name: 'n', type: 'NODE' }] as never,
      rows: [] as never,
      row_count: 0,
      elapsed_ms: 1,
    })
    useQueryPageStore.getState().setSubmittedStmt('RETURN 1')

    const first = render(
      <Wrappers>
        <QueryPage />
      </Wrappers>
    )
    await waitFor(() =>
      expect(screen.getByTestId('monaco-editor-stub')).toBeInTheDocument()
    )
    first.unmount()

    // Re-mount — tab choice persisted via the store, so the same tab
    // is active on the rebuilt component instance.
    render(
      <Wrappers>
        <QueryPage />
      </Wrappers>
    )
    await waitFor(() =>
      expect(screen.getByTestId('monaco-editor-stub')).toBeInTheDocument()
    )
    expect(useQueryPageStore.getState().tab).toBe('graph')
  })

  it('reset() wipes state — covers the AuthProvider.signOut / switchActive path', () => {
    useQueryPageStore.getState().setStmt('MATCH (m:Movie) RETURN m')
    useQueryPageStore.getState().setStreamMode(true)
    useQueryPageStore.getState().setExpand(false)
    useQueryPageStore.getState().setErr('something failed')

    useQueryPageStore.getState().reset()

    const s = useQueryPageStore.getState()
    expect(s.stmt).toMatch(/MATCH \(n\) RETURN n LIMIT 25/)
    expect(s.streamMode).toBe(false)
    expect(s.expand).toBe(true)
    expect(s.err).toBeNull()
  })
})
