/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../test-utils/theme'
import { ResultTabErrorBoundary } from './ResultTabErrorBoundary'

// A render-time thrower. The boundary's contract is "render-time
// throws from a child must NOT propagate past the boundary"; throwing
// from a `useEffect` would never reach a boundary anyway, so we throw
// during render to exercise the actual code path the audit flagged
// (Cytoscape extension crash, malformed plugin state).
function ThrowOnRender({ msg }: { msg: string }): React.ReactElement {
  throw new Error(msg)
}

// Silence the React-rendered error logs for the boundary tests so the
// jest output doesn't drown in noise. The boundary's own
// componentDidCatch still logs once via console.error — that's a
// separate concern asserted by the existing top-level boundary test.
let consoleErrorSpy: jest.SpyInstance
beforeEach(() => {
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('ResultTabErrorBoundary', () => {
  it('renders children when no error is thrown', () => {
    const { getByTestId } = render(
      <ThemeProvider theme={theme}>
        <ResultTabErrorBoundary resetKey="x" tabLabel="Table">
          <div data-testid="child">happy</div>
        </ResultTabErrorBoundary>
      </ThemeProvider>
    )
    expect(getByTestId('child')).toBeInTheDocument()
  })

  it('renders the tab-scoped fallback when a child throws (no whitescreen)', () => {
    // BUG #314: pre-fix a Cytoscape extension crash inside
    // <GraphView> bubbled past <ResultPanel> and only the App-level
    // ErrorBoundary caught it — that boundary replaces the WHOLE
    // page with the "Something went wrong" card, taking out the table
    // + json + matrix tabs too. The tab-scoped boundary contains the
    // failure to a single TabPanel and leaves the rest of the page
    // (header, editor, other tabs) interactive.
    const { getByTestId, queryByTestId } = render(
      <ThemeProvider theme={theme}>
        <ResultTabErrorBoundary resetKey="x" tabLabel="Graph">
          <ThrowOnRender msg="cytoscape extension exploded" />
        </ResultTabErrorBoundary>
      </ThemeProvider>
    )
    expect(getByTestId('result-tab-error-boundary')).toBeInTheDocument()
    expect(getByTestId('result-tab-error-boundary').textContent).toMatch(
      /cytoscape extension exploded/
    )
    expect(queryByTestId('child')).toBeNull()
  })

  it('resets when resetKey changes (e.g. tab switch or new query)', () => {
    // Simulate: graph tab crashes → user switches to table tab. The
    // boundary's resetKey changes from 'graph|q1' to 'table|q1'; React
    // unmounts/remounts the boundary subtree, the new tab's children
    // render fresh, and the old crash does not stick to the new tab.
    const { getByTestId, rerender, queryByTestId } = render(
      <ThemeProvider theme={theme}>
        <ResultTabErrorBoundary resetKey="graph|q1" tabLabel="Graph">
          <ThrowOnRender msg="initial crash" />
        </ResultTabErrorBoundary>
      </ThemeProvider>
    )
    expect(getByTestId('result-tab-error-boundary')).toBeInTheDocument()
    rerender(
      <ThemeProvider theme={theme}>
        <ResultTabErrorBoundary resetKey="table|q1" tabLabel="Table">
          <div data-testid="happy-table">table view content</div>
        </ResultTabErrorBoundary>
      </ThemeProvider>
    )
    // Fallback gone, fresh content rendered.
    expect(queryByTestId('result-tab-error-boundary')).toBeNull()
    expect(getByTestId('happy-table')).toBeInTheDocument()
  })
})
