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

  it('builds the matrix from a scalar-projection result when given the query', () => {
    // MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p.name, r, m.title:
    // the wire response carries only the edge in graph_summary; the
    // endpoints are placeholders. Without the query the matrix is empty
    // (regression: "the Matrix view never shows anything"); with it the
    // placeholders are labelled from the MATCH pattern.
    const scalarResp = {
      columns: [
        { name: 'name', type: 'STRING' },
        { name: 'r', type: 'EDGE' },
        { name: 'title', type: 'STRING' },
      ],
      rows: [
        [
          'Keanu Reeves',
          {
            id: 100,
            start_node: 11,
            end_node: 22,
            type: 'ACTED_IN',
            properties: {},
          },
          'The Matrix',
        ],
      ],
      graph_summary: {
        nodes: [],
        edges: [
          {
            id: 100,
            start_node: 11,
            end_node: 22,
            type: 'ACTED_IN',
            properties: {},
          },
        ],
      },
    }
    const q =
      'USE GRAPH movies; MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p.name, r, m.title'

    // No query → empty state (the bug).
    const { unmount } = render(
      <LocalizationProvider>
        <ThemeProvider theme={theme}>
          <MatrixView resp={scalarResp} />
        </ThemeProvider>
      </LocalizationProvider>
    )
    expect(screen.getByText(/no .*edges|nothing to show/i)).toBeInTheDocument()
    unmount()

    // With the query → a real adjacency table.
    renderWith(<MatrixView resp={scalarResp} query={q} />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: /Movie/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('rowheader', { name: /Person/ })
    ).toBeInTheDocument()
  })
})
