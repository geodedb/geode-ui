/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import {
  GraphToolbarMore,
  type GraphToolbarMoreProps,
} from './GraphToolbarMore'

const makeProps = (
  overrides: Partial<GraphToolbarMoreProps> = {}
): GraphToolbarMoreProps => ({
  t: (k: string) => k,
  miniMap: false,
  onToggleMiniMap: () => {},
  lasso: false,
  onToggleLasso: () => {},
  domNodes: false,
  onToggleDomNodes: () => {},
  sidebarCollapsed: false,
  onToggleSidebar: () => {},
  ...overrides,
})

describe('GraphToolbarMore', () => {
  it('renders the four checkbox items with their toggle state reflected', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphToolbarMore
          {...makeProps({
            miniMap: true,
            lasso: false,
            domNodes: true,
            sidebarCollapsed: false,
          })}
        />
      </ThemeProvider>
    )
    expect(screen.getByTestId('graph-more-minimap')).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByTestId('graph-more-lasso')).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(screen.getByTestId('graph-more-domnodes')).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByTestId('graph-more-sidebar')).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('clicking the minimap item fires onToggleMiniMap', () => {
    const onToggleMiniMap = jest.fn()
    render(
      <ThemeProvider theme={theme}>
        <GraphToolbarMore {...makeProps({ onToggleMiniMap })} />
      </ThemeProvider>
    )
    fireEvent.click(screen.getByTestId('graph-more-minimap'))
    expect(onToggleMiniMap).toHaveBeenCalledTimes(1)
  })

  it('clicking the sidebar item fires onToggleSidebar', () => {
    const onToggleSidebar = jest.fn()
    render(
      <ThemeProvider theme={theme}>
        <GraphToolbarMore {...makeProps({ onToggleSidebar })} />
      </ThemeProvider>
    )
    fireEvent.click(screen.getByTestId('graph-more-sidebar'))
    expect(onToggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('exposes the More trigger with the i18n moreLabel', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphToolbarMore {...makeProps()} />
      </ThemeProvider>
    )
    expect(screen.getByText('graph.moreLabel')).toBeInTheDocument()
  })
})
