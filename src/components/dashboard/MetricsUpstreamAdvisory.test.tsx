/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

import { MetricsUpstreamAdvisory } from './MetricsUpstreamAdvisory'
import type { UseMetricsPollingResult } from '../../lib/useMetricsPolling'

// Bug 3 (2026-05-21 bug-fix bundle): the advisory only fires when the
// upstream Geode metrics emitter is declared-but-not-wired (every
// counter zero AND uptime > threshold). These specs lock that
// detection down so a fresh / loaded / disabled server never sees a
// false-positive banner.

const DISMISS_KEY = 'geode-ui.metrics-upstream-advisory.dismissed'

function snapshot(
  overrides: Partial<{
    uptime: number
    queriesTotal: number
    connectionsTotal: number
    nodesTotal: number
  }>
): UseMetricsPollingResult['latest'] {
  return {
    queries: {
      total: overrides.queriesTotal ?? 0,
      failed: 0,
      duration_seconds_sum: 0,
      duration_seconds_count: 0,
      duration_seconds_buckets: [],
    },
    connections: { active: 0, total: overrides.connectionsTotal ?? 0 },
    transactions: { total: 0, failed: 0 },
    storage: {
      nodes_total: overrides.nodesTotal ?? 0,
      edges_total: 0,
      memory_bytes: 0,
    },
    server: {
      uptime_seconds: overrides.uptime ?? 0,
      healthy: true,
    },
    collected_at: new Date().toISOString(),
  } as never
}

function polling(
  state: UseMetricsPollingResult['state'],
  latest: UseMetricsPollingResult['latest']
): UseMetricsPollingResult {
  return {
    state,
    latest,
    history: [],
    error: null,
  }
}

beforeEach(() => {
  try {
    sessionStorage.removeItem(DISMISS_KEY)
  } catch {
    /* private mode */
  }
})

test('does not render when polling state is disabled', () => {
  render(<MetricsUpstreamAdvisory polling={polling('disabled', null)} />)
  expect(
    screen.queryByTestId('metrics-upstream-advisory')
  ).not.toBeInTheDocument()
})

test('does not render before any sample has landed', () => {
  render(<MetricsUpstreamAdvisory polling={polling('loading', null)} />)
  expect(
    screen.queryByTestId('metrics-upstream-advisory')
  ).not.toBeInTheDocument()
})

test('does not render on a fresh server (uptime below the quiet threshold)', () => {
  render(
    <MetricsUpstreamAdvisory
      polling={polling('ready', snapshot({ uptime: 5 }))}
    />
  )
  expect(
    screen.queryByTestId('metrics-upstream-advisory')
  ).not.toBeInTheDocument()
})

test('renders when uptime exceeds the threshold and every counter is zero', () => {
  render(
    <MetricsUpstreamAdvisory
      polling={polling('ready', snapshot({ uptime: 120 }))}
    />
  )
  expect(screen.getByTestId('metrics-upstream-advisory')).toBeInTheDocument()
})

test('does not render when any counter has moved off zero (queries)', () => {
  render(
    <MetricsUpstreamAdvisory
      polling={polling('ready', snapshot({ uptime: 120, queriesTotal: 1 }))}
    />
  )
  expect(
    screen.queryByTestId('metrics-upstream-advisory')
  ).not.toBeInTheDocument()
})

test('does not render when any counter has moved off zero (connections)', () => {
  render(
    <MetricsUpstreamAdvisory
      polling={polling('ready', snapshot({ uptime: 120, connectionsTotal: 1 }))}
    />
  )
  expect(
    screen.queryByTestId('metrics-upstream-advisory')
  ).not.toBeInTheDocument()
})

test('does not render when any gauge has moved off zero (nodes)', () => {
  render(
    <MetricsUpstreamAdvisory
      polling={polling('ready', snapshot({ uptime: 120, nodesTotal: 1 }))}
    />
  )
  expect(
    screen.queryByTestId('metrics-upstream-advisory')
  ).not.toBeInTheDocument()
})

test('dismiss button removes the banner and persists the choice in sessionStorage', () => {
  const props = { polling: polling('ready', snapshot({ uptime: 120 })) }
  const { rerender } = render(<MetricsUpstreamAdvisory {...props} />)
  expect(screen.getByTestId('metrics-upstream-advisory')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('metrics-upstream-advisory-dismiss'))
  expect(
    screen.queryByTestId('metrics-upstream-advisory')
  ).not.toBeInTheDocument()
  expect(sessionStorage.getItem(DISMISS_KEY)).toBe('1')
  // A subsequent mount in the same session keeps the dismissal.
  rerender(<MetricsUpstreamAdvisory {...props} />)
  expect(
    screen.queryByTestId('metrics-upstream-advisory')
  ).not.toBeInTheDocument()
})
