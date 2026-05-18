/// <reference types="@testing-library/jest-dom" />
//
// Reproduction test for the buried sidebar-collapse toggle on mobile.
//
// Today the only way to collapse/expand the GraphView sidebar is via
// GraphToolbarMore.tsx -- a wa-dropdown that hides the sidebar item
// behind a "More" trigger. On a mobile viewport that two-tap path is
// not discoverable, especially with the sidebar stacking under the
// canvas at <= md (768 px).
//
// After the fix the GraphToolbar must render a first-class sidebar
// toggle button DIRECTLY in the toolbar (not inside any dropdown)
// when the viewport is at or below the `md` breakpoint. The button
// must expose an aria-label that contains either "sidebar" or "panel"
// so assistive tech announces it correctly.
//
// We assert against the rendered DOM tree: the button must be a child
// of the toolbar element, NOT a descendant of `[data-testid="graph-toolbar-more"]`.

import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { GraphToolbar, type GraphToolbarProps } from './GraphToolbar'

const t: GraphToolbarProps['t'] = (k: string) => k

const toolbarProps = (
  overrides: Partial<GraphToolbarProps> = {}
): GraphToolbarProps => ({
  t,
  sidebarCollapsed: false,
  onToggleSidebar: jest.fn(),
  layout: 'cose',
  onChangeLayout: jest.fn(),
  layouts: ['cose'] as const,
  layoutLabel: (k) => k,
  onZoomIn: jest.fn(),
  onZoomOut: jest.fn(),
  onFit: jest.fn(),
  onResetView: jest.fn(),
  selectionMode: 'pan',
  onToggleSelectionMode: jest.fn(),
  clusterByLabel: false,
  onToggleClusterByLabel: jest.fn(),
  degreeSizing: false,
  onToggleDegreeSizing: jest.fn(),
  pathActive: false,
  onTogglePathMode: jest.fn(),
  onPathClear: jest.fn(),
  miniMap: false,
  onToggleMiniMap: jest.fn(),
  lasso: false,
  onToggleLasso: jest.fn(),
  domNodes: false,
  onToggleDomNodes: jest.fn(),
  findNodes: [],
  onFindPick: jest.fn(),
  counts: { nodes: 0, edges: 0 },
  renderer: 'cytoscape',
  onToggleRenderer: jest.fn(),
  ...overrides,
})

// matchMedia mock: report `matches: true` for any query whose
// max-width covers the supplied viewport width.
function installMatchMediaMock(viewportPx: number): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => {
      const m = query.match(/max-width:\s*([0-9.]+)px/)
      const limit = m && m[1] ? parseFloat(m[1]) : Infinity
      return {
        matches: viewportPx <= limit,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }
    },
  })
}

describe('GraphToolbar mobile responsive (first-class sidebar toggle)', () => {
  it('renders a first-class sidebar toggle directly in the toolbar on mobile widths', () => {
    // Mobile-class viewport (375 px) is well below the md breakpoint
    // (768 px), so the responsive code path should trigger.
    installMatchMediaMock(375)

    render(
      <ThemeProvider theme={theme}>
        <GraphToolbar {...toolbarProps()} />
      </ThemeProvider>
    )

    const toolbar = screen.getByTestId('graph-toolbar')
    // Look inside the toolbar for a button whose aria-label includes
    // "sidebar" or "panel". The button MUST NOT be a descendant of the
    // graph-toolbar-more dropdown -- it must be a direct toolbar
    // affordance the user can tap without opening a menu.
    const toggle = within(toolbar).queryByRole('button', {
      name: /sidebar|panel/i,
    })
    expect(toggle).not.toBeNull()
    if (toggle) {
      const moreDropdown = toolbar.querySelector(
        '[data-testid="graph-toolbar-more"]'
      )
      // The toggle must NOT live inside the More dropdown.
      expect(moreDropdown?.contains(toggle) ?? false).toBe(false)
    }
  })

  it('exposes the toggle with an aria-pressed reflecting collapse state', () => {
    // The first-class button must be a toggle button, i.e. expose
    // aria-pressed so assistive tech and Playwright can read it.
    installMatchMediaMock(375)

    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <GraphToolbar {...toolbarProps({ sidebarCollapsed: false })} />
      </ThemeProvider>
    )

    const toolbar = screen.getByTestId('graph-toolbar')
    const toggle = within(toolbar).queryByRole('button', {
      name: /sidebar|panel/i,
    })
    expect(toggle).not.toBeNull()
    // The button starts un-pressed when sidebar is open.
    expect(toggle?.getAttribute('aria-pressed')).toBe('false')

    // Flip the prop -> aria-pressed should flip to "true".
    rerender(
      <ThemeProvider theme={theme}>
        <GraphToolbar {...toolbarProps({ sidebarCollapsed: true })} />
      </ThemeProvider>
    )
    const toggleAfter = within(screen.getByTestId('graph-toolbar')).queryByRole(
      'button',
      { name: /sidebar|panel/i }
    )
    expect(toggleAfter?.getAttribute('aria-pressed')).toBe('true')
  })
})
