/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen } from '@testing-library/react'
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

describe('GraphToolbar grouped layout', () => {
  it('renders three labelled groups: View, Filters, Analysis', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphToolbar {...toolbarProps()} />
      </ThemeProvider>
    )
    expect(screen.getByTestId('graph-toolbar-group-view')).toBeInTheDocument()
    expect(
      screen.getByTestId('graph-toolbar-group-filters')
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('graph-toolbar-group-analysis')
    ).toBeInTheDocument()
  })

  it('hides rarely-used toggles from the main strip (they live in the More dropdown)', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphToolbar {...toolbarProps()} />
      </ThemeProvider>
    )
    // No inline buttons for these — they live in GraphToolbarMore.
    expect(screen.queryByTestId('graph-minimap-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('graph-lasso-toggle')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('graph-dom-nodes-toggle')
    ).not.toBeInTheDocument()
    // The renderer toggle is removed entirely (reagraph dispatch disabled).
    expect(
      screen.queryByTestId('graph-renderer-toggle')
    ).not.toBeInTheDocument()
    // The four overflow items DO exist via the More dropdown.
    expect(screen.getByTestId('graph-more-minimap')).toBeInTheDocument()
    expect(screen.getByTestId('graph-more-lasso')).toBeInTheDocument()
    expect(screen.getByTestId('graph-more-domnodes')).toBeInTheDocument()
    expect(screen.getByTestId('graph-more-sidebar')).toBeInTheDocument()
  })

  it('keeps the high-frequency view controls (zoom, fit, reset) as icon buttons', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphToolbar {...toolbarProps()} />
      </ThemeProvider>
    )
    expect(screen.getByTestId('graph-zoom-in')).toBeInTheDocument()
    expect(screen.getByTestId('graph-zoom-out')).toBeInTheDocument()
    expect(screen.getByTestId('graph-fit')).toBeInTheDocument()
    expect(screen.getByTestId('graph-reset-view')).toBeInTheDocument()
    // The layout picker is still visible.
    expect(screen.getByTestId('graph-layout-picker')).toBeInTheDocument()
  })
})
