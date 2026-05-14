/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { GraphToolbar, type GraphToolbarProps } from './GraphToolbar'

// Minimal i18n stub — the toolbar passes the key through unchanged so
// assertions can match on raw keys without pulling i18next into the
// unit test surface.
const t: GraphToolbarProps['t'] = (k: string) => k

// Build a fully-populated GraphToolbarProps with the renderer toggle
// pre-wired. Tests pass `overrides` for the field(s) under exercise so
// the rest of the toolbar's contract is held constant.
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

describe('GraphToolbar renderer toggle', () => {
  it('renders a toggle showing the current renderer (cytoscape)', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphToolbar {...toolbarProps()} />
      </ThemeProvider>
    )
    const btn = screen.getByTestId('graph-renderer-toggle')
    // aria-pressed is the canonical signal that this is a toggle; it
    // must reflect the *current* renderer, not the post-click one.
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(btn).toHaveAccessibleName(/renderer.*cytoscape/i)
  })

  it('reflects pressed state when renderer is reagraph', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphToolbar {...toolbarProps({ renderer: 'reagraph' })} />
      </ThemeProvider>
    )
    const btn = screen.getByTestId('graph-renderer-toggle')
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toHaveAccessibleName(/renderer.*reagraph/i)
  })

  it('fires onToggleRenderer when clicked', () => {
    const onToggleRenderer = jest.fn()
    render(
      <ThemeProvider theme={theme}>
        <GraphToolbar {...toolbarProps({ onToggleRenderer })} />
      </ThemeProvider>
    )
    fireEvent.click(screen.getByTestId('graph-renderer-toggle'))
    expect(onToggleRenderer).toHaveBeenCalledTimes(1)
  })
})
