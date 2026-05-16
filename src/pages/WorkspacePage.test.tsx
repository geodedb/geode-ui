/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'
import { testTheme as theme } from '../test-utils/theme'

jest.mock('../components/editor/GqlEditor', () => ({
  __esModule: true,
  GqlEditor: ({ value }: { value: string }) => (
    <textarea data-testid="pane-editor" defaultValue={value} />
  ),
}))
jest.mock('../components/results/GraphView', () => ({
  __esModule: true,
  GraphView: () => <div />,
}))
jest.mock('../lib/queryStream', () => ({
  streamQuery: () => ({ cancel: jest.fn(), done: Promise.resolve() }),
}))
import { WorkspacePage } from './WorkspacePage'

function renderPage() {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('WorkspacePage', () => {
  // QUALITY #227: WorkspacePane lazy-imports GqlEditor, so a synchronous
  // `render() → getAllByTestId(...)` returns before the Suspense
  // boundary resolves. Await `findByTestId('pane-editor')` first so the
  // lazy module's resolution lands inside RTL's act() and no
  // "suspended resource finished loading" warning fires.
  it('starts with one pane and can add a second', async () => {
    renderPage()
    await screen.findByTestId('pane-editor')
    expect(screen.getAllByTestId('workspace-pane')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('workspace-add-pane'))
    // The second pane mounts another lazy GqlEditor — wait for both.
    await waitFor(() =>
      expect(screen.getAllByTestId('pane-editor')).toHaveLength(2)
    )
    expect(screen.getAllByTestId('workspace-pane')).toHaveLength(2)
  })
  it('disables Add pane at 4 panes and removes a pane via its close button', async () => {
    renderPage()
    await screen.findByTestId('pane-editor')
    const add = screen.getByTestId('workspace-add-pane')
    fireEvent.click(add)
    fireEvent.click(add)
    fireEvent.click(add) // → 4
    await waitFor(() =>
      expect(screen.getAllByTestId('workspace-pane')).toHaveLength(4)
    )
    await waitFor(() =>
      expect(screen.getAllByTestId('pane-editor')).toHaveLength(4)
    )
    expect(add).toBeDisabled()
    fireEvent.click(
      within(screen.getAllByTestId('workspace-pane')[0]!).getByTestId(
        'pane-close-btn'
      )
    )
    expect(screen.getAllByTestId('workspace-pane')).toHaveLength(3)
    expect(add).not.toBeDisabled()
  })
})
