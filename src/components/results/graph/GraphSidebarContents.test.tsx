/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { GraphSidebarContents } from './GraphSidebarContents'
import { DEFAULT_SECTIONS_OPEN } from '../useGraphPrefs'

const baseProps = {
  t: (k: string) => k,
  nodeLabelBuckets: new Map([
    ['Movie', 5],
    ['Person', 3],
  ]),
  hiddenLabels: new Set<string>(),
  toggleHiddenLabel: () => {},
  swatchFor: () => '#000',
  nodeOptions: new Map(),
  edgeOptions: new Map(),
  nodeLabelPrefs: {},
  edgeLabelPrefs: {},
  setNodeLabelPref: () => {},
  setEdgeLabelPref: () => {},
  hiddenIds: [] as string[],
  collapsedEntries: [] as Array<[string, string[]]>,
  onRestoreHidden: () => {},
  onExpandCollapsed: () => {},
  nodeDisplayLabel: (id: string) => id,
  selected: null,
  inspectorView: 'props' as const,
  setInspectorView: () => {},
  onHideNode: () => {},
  onCollapseNode: () => {},
  onExploreNeighbours: () => {},
  exploringId: null,
  collapsed: new Map(),
  neighbors: [],
  onJumpNeighbor: () => {},
  onPin: () => {},
  isPinned: false,
  onFocus: () => {},
  onClearFocus: () => {},
  focusActive: false,
  focusHops: 1,
  setFocusHops: () => {},
  sectionsOpen: DEFAULT_SECTIONS_OPEN,
  onToggleSection: () => {},
  wheelSensitivity: 1.0,
  setWheelSensitivity: () => {},
}

describe('GraphSidebarContents collapsible sections', () => {
  it('renders Visibility, Display, and Inspector sections by default; hides empty Hidden + Collapsed', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphSidebarContents {...baseProps} />
      </ThemeProvider>
    )
    expect(screen.getByTestId('graph-section-visibility')).toBeInTheDocument()
    expect(screen.getByTestId('graph-section-display')).toBeInTheDocument()
    expect(screen.queryByTestId('graph-section-hidden')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('graph-section-collapsed')
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('graph-section-inspector')).toBeInTheDocument()
  })

  it('renders the Hidden section when hiddenIds is non-empty', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphSidebarContents {...baseProps} hiddenIds={['1', '2']} />
      </ThemeProvider>
    )
    expect(screen.getByTestId('graph-section-hidden')).toBeInTheDocument()
  })

  it('renders the Collapsed section when collapsedEntries is non-empty', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphSidebarContents
          {...baseProps}
          collapsedEntries={[['1', ['2', '3']]]}
        />
      </ThemeProvider>
    )
    expect(screen.getByTestId('graph-section-collapsed')).toBeInTheDocument()
  })

  it('clicking a section header fires onToggleSection with the section id', () => {
    const onToggleSection = jest.fn()
    render(
      <ThemeProvider theme={theme}>
        <GraphSidebarContents
          {...baseProps}
          onToggleSection={onToggleSection}
        />
      </ThemeProvider>
    )
    const section = screen.getByTestId('graph-section-visibility')
    const button = section.querySelector('button')
    if (!button) {
      throw new Error('expected a button inside the visibility section')
    }
    fireEvent.click(button)
    expect(onToggleSection).toHaveBeenCalledWith('visibility')
  })
})
