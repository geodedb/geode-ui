/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../test-utils/theme'
import { ResultPanel } from './ResultPanel'

// GraphView is React.lazy'd inside ResultPanel; mock it so the lazy
// chunk + Cytoscape don't load in jsdom.
jest.mock('./GraphView', () => ({
  __esModule: true,
  GraphView: () => <div data-testid="mock-graphview" />,
}))

const resp = {
  columns: [{ name: 'n', type: 'NODE' }],
  rows: [[{ id: 1, labels: ['A'], properties: {} }]],
  row_count: 1,
  elapsed_ms: 1,
  graph_summary: {
    nodes: [{ id: 1, labels: ['A'], properties: {} }],
    edges: [],
  },
}

function renderPanel(
  props: Partial<React.ComponentProps<typeof ResultPanel>> = {}
) {
  const onTabChange = jest.fn()
  const utils = render(
    <ThemeProvider theme={theme}>
      <ResultPanel
        resp={resp}
        query="MATCH (n) RETURN n"
        tab="table"
        onTabChange={onTabChange}
        {...props}
      />
    </ThemeProvider>
  )
  return { ...utils, onTabChange }
}

describe('ResultPanel', () => {
  it('renders the four result tabs and reports tab changes', () => {
    const { onTabChange } = renderPanel()
    expect(screen.getAllByRole('tab')).toHaveLength(4)
    fireEvent.click(screen.getByRole('tab', { name: /json/i }))
    expect(onTabChange).toHaveBeenCalledWith('json')
  })

  it('renders the active view per the tab prop', () => {
    renderPanel({ tab: 'json' })
    // JsonView renders a <pre> with the stringified resp
    expect(screen.getByText(/"row_count": 1/)).toBeInTheDocument()
  })

  it('renders the maximize toggle only when onToggleMaximize is given', () => {
    const { rerender } = renderPanel()
    // The toggle is keyed by data-testid because <wa-button> renders
    // its `role="button"` inside the shadow root, and jsdom + the
    // testing-library a11y query can race Lit's first reactive update.
    // The testid is the stable selector callers in the app rely on.
    expect(screen.queryByTestId('result-fullscreen-toggle')).toBeNull()
    const onToggle = jest.fn()
    rerender(
      <ThemeProvider theme={theme}>
        <ResultPanel
          resp={resp}
          query=""
          tab="table"
          onTabChange={jest.fn()}
          onToggleMaximize={onToggle}
        />
      </ThemeProvider>
    )
    fireEvent.click(screen.getByTestId('result-fullscreen-toggle'))
    expect(onToggle).toHaveBeenCalled()
  })
})

describe('ResultPanel flex chain', () => {
  it('the tab-group host is a flex column', () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <ResultPanel
          resp={resp}
          tab="table"
          onTabChange={() => {}}
          onToggleMaximize={() => {}}
        />
      </ThemeProvider>
    )
    const tabsRow = container.firstChild as HTMLElement
    const cs = getComputedStyle(tabsRow)
    expect(cs.display).toBe('flex')
    expect(cs.flexDirection).toBe('column')
    expect(cs.flex).toMatch(/1 1 (0|auto)/)
    expect(cs.minHeight).toMatch(/^0(px)?$/)
  })
})
