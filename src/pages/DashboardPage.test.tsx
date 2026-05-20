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

  // Regression: Geode auto-provisions an empty graph named "default"
  // on first boot. The stats card used to prefer that name unconditionally,
  // so an operator whose real data lived in any other graph saw the
  // card title "default stats" with Nodes 0 / Edges 0 and no way to
  // pick the real graph. The card MUST now title itself with the
  // first non-"default" graph in the list — if every graph the user
  // has is empty by name we still fall back to "default", but real
  // data takes precedence.
  it('prefers a non-default graph when both "default" and a real graph are present', () => {
    overviewFixture.graphs = ['default', 'movies']
    renderPage()
    expect(screen.getByTestId('dashboard-stats-card')).toHaveTextContent(
      'movies stats'
    )
    expect(screen.getByTestId('dashboard-stats-card')).not.toHaveTextContent(
      'default stats'
    )
  })

  it('falls back to "default" when it is the only graph available', () => {
    overviewFixture.graphs = ['default']
    renderPage()
    expect(screen.getByTestId('dashboard-stats-card')).toHaveTextContent(
      'default stats'
    )
  })

  it('prefers a non-default graph regardless of position in the list', () => {
    // The SHOW GRAPHS driver-order may return "default" first or
    // anywhere in the middle; the picker must scan the whole list
    // rather than treat any specific index as authoritative.
    overviewFixture.graphs = ['movies', 'default', 'vulndb']
    renderPage()
    const card = screen.getByTestId('dashboard-stats-card')
    // First non-default in list order wins so the operator can predict
    // which graph the card surfaces.
    expect(card).toHaveTextContent('movies stats')
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
