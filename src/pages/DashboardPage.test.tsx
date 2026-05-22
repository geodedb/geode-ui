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
  // Bug 4 (2026-05-21 bug-fix bundle): multi-graph view.
  allGraphStats: new Map(),
  loadAllStats: jest.fn(),
  reloadStats: jest.fn(),
}
jest.mock('../lib/useOverviewData', () => ({
  useOverviewData: (): OverviewData => overviewFixture,
}))

// Stub the metrics-polling hook so the dashboard test stays hermetic
// (no real fetch, no setInterval, no act() warnings from the real
// hook's microtask-driven setState). Default fixture: state='disabled'
// so the metrics cards drop out of the grid — the existing assertions
// already pin the four legacy cards independently, and a dedicated
// test block at the bottom of this file overrides the fixture to
// exercise the metrics-rendered path.
type MetricsFixtureState = 'idle' | 'loading' | 'ready' | 'error' | 'disabled'
const metricsFixture: {
  state: MetricsFixtureState
  latest: unknown
  history: Array<unknown>
  error: string | null
} = {
  state: 'disabled',
  latest: null,
  history: [],
  error: null,
}
jest.mock('../lib/useMetricsPolling', () => ({
  useMetricsPolling: (): typeof metricsFixture => metricsFixture,
}))

// AuditEventMixCard pulls from /api/v1/audit via useApiResource, which
// async-resolves setState calls after render(). The act-gate treats
// those microtask-driven dispatches as fatal, so mock the card to a
// static stub for these DashboardPage layout assertions; the card's
// own behavior is exercised in its dedicated test below.
jest.mock('../components/dashboard/AuditEventMixCard', () => ({
  AuditEventMixCard: (): JSX.Element | null => null,
}))

import { DashboardPage } from './DashboardPage'
import { useQueryHistory } from '../lib/useQueryHistory'
import { ConnectionsProvider } from '../api/connections'

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <LocalizationProvider>
        <ThemeProvider theme={theme}>
          {/* 2026-05-22 bug-fix: DashboardPage now reads the active
              profile name via useActiveConnection() to scope the
              session-query-history card. Mount an empty
              ConnectionsProvider so the hook resolves to null and
              the page falls through to the '' (no-profile) bucket
              the test fixture seeds below. */}
          <ConnectionsProvider initialConnections={[]}>
            <DashboardPage />
          </ConnectionsProvider>
        </ThemeProvider>
      </LocalizationProvider>
    </MemoryRouter>
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    localStorage.clear()
    // 2026-05-22 bug-fix: query history is keyed per profile. Seed
    // under the empty-string profile key — DashboardPage reads
    // entriesFor(state, activeConn?.profileName ?? '') and the test
    // mount has no active connection wired, so '' is the bucket the
    // page will pick.
    useQueryHistory.setState({
      byProfile: {
        '': [
          {
            statement: 'MATCH (a) RETURN a',
            ranAt: Date.now(),
            rowCount: 1,
            ok: true,
          },
        ],
      },
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
    // "movies" appears in both the GraphsCard list and the
    // GraphStatsCard table row (Bug 4 multi-graph view), so we
    // assert by container rather than getByText.
    expect(screen.getByTestId('dashboard-graphs-card')).toHaveTextContent(
      'movies'
    )
    expect(screen.getByTestId('dashboard-recent-row')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-connection-card')).toHaveTextContent(
      'v0.5.11'
    )
  })

  // Bug 4 (2026-05-21 bug-fix bundle): the graph-stats card is now a
  // multi-graph table — every graph in the list gets a row. The
  // previous single-graph "pick a default graph by name" heuristic
  // is gone. These specs replace the prior pickDefaultGraph
  // coverage with the new render contract.
  it('renders a row in the stats card for every graph in the list', () => {
    overviewFixture.graphs = ['movies', 'people', 'companies']
    renderPage()
    const card = screen.getByTestId('dashboard-stats-card')
    expect(card).toHaveTextContent('movies')
    expect(card).toHaveTextContent('people')
    expect(card).toHaveTextContent('companies')
  })

  it('renders rows for every graph including "default"', () => {
    overviewFixture.graphs = ['default', 'movies']
    renderPage()
    const card = screen.getByTestId('dashboard-stats-card')
    expect(card).toHaveTextContent('default')
    expect(card).toHaveTextContent('movies')
  })

  // Geode-metrics rendering gate. By default the polling fixture
  // is state='disabled' (the four metric cards drop out); when the
  // upstream proxy reports 'ready' all four cards render alongside
  // the legacy ones.
  it('hides metric cards when the polling hook reports disabled', () => {
    metricsFixture.state = 'disabled'
    renderPage()
    expect(
      screen.queryByTestId('dashboard-metrics-throughput')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('dashboard-metrics-connections')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('dashboard-metrics-storage')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('dashboard-metrics-server')
    ).not.toBeInTheDocument()
  })

  it('renders metric cards when the polling hook reports ready', () => {
    metricsFixture.state = 'ready'
    metricsFixture.latest = {
      queries: {
        total: 42,
        failed: 1,
        duration_seconds_sum: 0.5,
        duration_seconds_count: 42,
        duration_seconds_buckets: [
          { upper_bound: 0.01, count: 30 },
          { upper_bound: 1e308, count: 42 },
        ],
      },
      connections: { active: 3, total: 17 },
      transactions: { total: 9, failed: 0 },
      storage: { nodes_total: 1500, edges_total: 3200, memory_bytes: 1048576 },
      server: { uptime_seconds: 65, healthy: true },
      collected_at: new Date().toISOString(),
    } as never
    renderPage()
    expect(
      screen.getByTestId('dashboard-metrics-throughput')
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('dashboard-metrics-connections')
    ).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-metrics-storage')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-metrics-server')).toBeInTheDocument()
    // Spot-check that the numeric chips reflect the fixture.
    expect(screen.getByTestId('metrics-queries-total')).toHaveTextContent('42')
    // Reset for subsequent tests in this file.
    metricsFixture.state = 'disabled'
    metricsFixture.latest = null
  })
})
