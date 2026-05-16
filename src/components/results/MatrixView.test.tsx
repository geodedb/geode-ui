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

  it('skips zero-intensity cells from the styled cell pipeline (PERF #216)', () => {
    // Two Person nodes (no edges between them), two Movie nodes, one
    // Person→Movie edge. Cells: Person→Person=0, Person→Movie=1,
    // Movie→Person=0, Movie→Movie=0. Only Person→Movie carries the
    // intensity-coloured Td; the other three render as un-styled <td>.
    const resp2 = {
      graph_summary: {
        nodes: [
          { id: 1, labels: ['Person'], properties: {} },
          { id: 2, labels: ['Person'], properties: {} },
          { id: 3, labels: ['Movie'], properties: {} },
        ],
        edges: [
          {
            id: 13,
            start_node: 1,
            end_node: 3,
            type: 'ACTED_IN',
            properties: {},
          },
        ],
      },
    }
    const { container } = render(
      <LocalizationProvider>
        <ThemeProvider theme={theme}>
          <MatrixView resp={resp2} />
        </ThemeProvider>
      </LocalizationProvider>
    )
    // The Person→Movie cell has the populated count.
    expect(screen.getByText('1')).toBeInTheDocument()
    // The empty cells have no count text rendered (count was elided),
    // so the only non-header text content in <td> elements is "1".
    const dataCells = container.querySelectorAll('tbody td')
    const counts: string[] = []
    dataCells.forEach((td) => {
      const text = (td.textContent || '').trim()
      if (text) counts.push(text)
    })
    expect(counts).toEqual(['1'])
  })

  it('caps labels per dimension at the label budget and surfaces overflow (PERF #216)', () => {
    // Build a 70-node graph with 70 distinct labels and a single
    // Lk → L(k+1) edge between each consecutive pair. With budget=10,
    // only ten labels render and the overflow banner appears.
    const nodes = Array.from({ length: 70 }, (_, i) => ({
      id: i + 1,
      labels: [`L${String(i).padStart(2, '0')}`],
      properties: {},
    }))
    const edges = Array.from({ length: 69 }, (_, i) => ({
      id: 100 + i,
      start_node: i + 1,
      end_node: i + 2,
      type: 'REL',
      properties: {},
    }))
    const respBig = { graph_summary: { nodes, edges } }
    renderWith(<MatrixView resp={respBig} labelBudget={10} />)
    // Overflow banner present, labelled by aria.
    const banner = screen.getByTestId('matrix-overflow')
    expect(banner).toBeInTheDocument()
    expect(banner.textContent || '').toMatch(/10/) // shown
    expect(banner.textContent || '').toMatch(/60/) // hidden
    // Exactly 10 column headers (one per kept label) + the empty
    // top-left scope=col placeholder = 11 thead <th> nodes.
    const headRow = screen
      .getByRole('table')
      .querySelector('thead tr') as HTMLTableRowElement
    const colHeaders = headRow.querySelectorAll('th')
    expect(colHeaders.length).toBe(11)
  })

  it('the wrap is a flex column that fills its parent', () => {
    // Use the seeded `resp` defined at module scope (a Person→Movie
    // ACTED_IN edge) so the non-empty path renders the Wrap container.
    const { container } = render(
      <ThemeProvider theme={theme}>
        <LocalizationProvider>
          <div style={{ height: 800 }}>
            <MatrixView resp={resp} query="" />
          </div>
        </LocalizationProvider>
      </ThemeProvider>
    )
    const tableEl = container.querySelector('[role="table"]')
    // The non-empty branch renders <Wrap><Table /></Wrap>. The Wrap is
    // the parent of the role=table element.
    const wrap = tableEl?.parentElement as HTMLElement | null
    expect(wrap).not.toBeNull()
    if (wrap) {
      const cs = getComputedStyle(wrap)
      expect(cs.display).toBe('flex')
      expect(cs.flex).toMatch(/1 1 (0|auto)/)
      expect(cs.minHeight).toMatch(/^0(px)?$/)
    }
  })
})
