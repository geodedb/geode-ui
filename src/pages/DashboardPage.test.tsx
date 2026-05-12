/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'
import { LocalizationProvider } from '../services/i18n'
import { testTheme as theme } from '../test-utils/theme'
import type { OverviewData } from '../lib/useOverviewData'

// Mock the overview hook so the page renders deterministically without
// touching the network. The fixture exercises every card in its
// data-present state (one graph, a known geode version, all admin DDL
// families read-only, no default-graph stats loaded yet).
const overviewFixture: OverviewData = {
  graphs: ['movies'],
  geodeVersion: 'v0.5.11',
  adminWritable: {
    users: false,
    roles: false,
    policies: false,
    grants: false,
  },
  loading: false,
  graphsError: null,
  capsError: null,
  reload: jest.fn(),
  defaultGraphStats: null,
  statsLoading: false,
  statsError: null,
  loadStats: jest.fn(),
}
jest.mock('../lib/useOverviewData', () => ({
  useOverviewData: (): OverviewData => overviewFixture,
}))

import { DashboardPage } from './DashboardPage'
import { useQueryHistory } from '../lib/useQueryHistory'

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <LocalizationProvider>
        <ThemeProvider theme={theme}>
          <DashboardPage />
        </ThemeProvider>
      </LocalizationProvider>
    </MemoryRouter>
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    localStorage.clear()
    useQueryHistory.setState({
      entries: [
        {
          statement: 'MATCH (a) RETURN a',
          ranAt: Date.now(),
          rowCount: 1,
          ok: true,
        },
      ],
    })
  })

  it('renders the overview heading and all four cards', () => {
    renderPage()
    expect(
      screen.getByRole('heading', { name: 'Overview' })
    ).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-graphs-card')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-recent-card')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-connection-card')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-stats-card')).toBeInTheDocument()
  })

  it('shows the graph list, a recent-query row, and the connection version', () => {
    renderPage()
    expect(screen.getByText('movies')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-recent-row')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-connection-card')).toHaveTextContent(
      'v0.5.11'
    )
  })
})
