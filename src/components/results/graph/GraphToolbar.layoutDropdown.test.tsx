/// <reference types="@testing-library/jest-dom" />
//
// Reproduction test for Bug C — the "View" layout selector in
// GraphToolbar is rendered as a raw native `<select>` element, so the
// browser paints the default OS dropdown control which doesn't match
// the rest of the WA-styled toolbar.
//
// After the fix the layout picker must NOT be a native `<select>` —
// it should be either a Web Awesome `<wa-select>` (preferred, matches
// surrounding controls) or a Bootstrap `<button class="dropdown-toggle">`
// + `<ul class="dropdown-menu">` pair. Either way, the tagName must not
// be 'SELECT'.

import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { GraphToolbar, type GraphToolbarProps } from './GraphToolbar'

const t: GraphToolbarProps['t'] = (k: string) => k

function toolbarProps(
  overrides: Partial<GraphToolbarProps> = {}
): GraphToolbarProps {
  return {
    t,
    sidebarCollapsed: false,
    onToggleSidebar: jest.fn(),
    layout: 'cose',
    onChangeLayout: jest.fn(),
    layouts: ['cose', 'grid', 'breadthfirst', 'concentric', 'circle'] as const,
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
  }
}

describe('Bug C — layout picker is a styled dropdown, not a native <select>', () => {
  it('renders the layout picker as a non-native element', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphToolbar {...toolbarProps()} />
      </ThemeProvider>
    )
    const picker = screen.getByTestId('graph-layout-picker')
    expect(picker).toBeInTheDocument()
    // Bug: the current implementation renders a native <select> here.
    // Fix: must be a Web Awesome <wa-select> or a Bootstrap dropdown
    // trigger (<button class="dropdown-toggle">). Either way the
    // tagName must not be SELECT.
    expect(picker.tagName.toUpperCase()).not.toBe('SELECT')
  })

  it('exposes each available layout option as a selectable item', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphToolbar {...toolbarProps()} />
      </ThemeProvider>
    )
    // The selectable options must be discoverable in the DOM regardless
    // of which dropdown abstraction the fix lands on. Web Awesome
    // exposes them as <wa-option>; a Bootstrap dropdown uses anchor
    // items with the dropdown-item class. We accept either by looking
    // for elements whose text matches one of the supplied layouts.
    const expected = ['cose', 'grid', 'breadthfirst', 'concentric', 'circle']
    expected.forEach((name) => {
      // The label callback returns the same string the test passes in.
      const matches = screen.queryAllByText(name)
      expect(matches.length).toBeGreaterThan(0)
    })
  })
})
