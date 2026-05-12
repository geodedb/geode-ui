/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { LocalizationProvider } from '../../services/i18n'
import { MatrixView } from './MatrixView'
import { testTheme as theme } from '../../test-utils/theme'

const resp = {
  graph_summary: {
    nodes: [
      { id: 1, labels: ['Person'], properties: {} },
      { id: 2, labels: ['Movie'], properties: {} },
    ],
    edges: [
      { id: 12, start_node: 1, end_node: 2, type: 'ACTED_IN', properties: {} },
    ],
  },
}

function renderWith(node: React.ReactNode): void {
  render(
    <LocalizationProvider>
      <ThemeProvider theme={theme}>{node}</ThemeProvider>
    </LocalizationProvider>
  )
}

describe('MatrixView', () => {
  it('renders an adjacency table with label headers and edge counts', () => {
    renderWith(<MatrixView resp={resp} />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: /Movie/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('rowheader', { name: /Person/ })
    ).toBeInTheDocument()
    // the Person→Movie cell shows count 1
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('shows an empty state when there are no edges between labelled nodes', () => {
    renderWith(
      <MatrixView
        resp={{
          graph_summary: {
            nodes: [{ id: 1, labels: ['X'], properties: {} }],
            edges: [],
          },
        }}
      />
    )
    expect(screen.getByText(/no .*edges|nothing to show/i)).toBeInTheDocument()
  })
})
