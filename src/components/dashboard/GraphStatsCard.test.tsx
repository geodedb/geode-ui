/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

import { GraphStatsCard } from './GraphStatsCard'
import { testTheme } from '../../test-utils/theme'
import type { PerGraphStats } from '../../lib/useOverviewData'

// Bug 4 (2026-05-21 bug-fix bundle): the card is the multi-graph
// view rewrite. These specs pin the new behaviour — auto-loaded table
// of per-graph counts, filter, and per-row + global refresh buttons.

function renderCard(ui: React.ReactElement): void {
  render(<ThemeProvider theme={testTheme}>{ui}</ThemeProvider>)
}

function statsMap(
  entries: Array<Partial<PerGraphStats> & { graph: string }>
): ReadonlyMap<string, PerGraphStats> {
  const m = new Map<string, PerGraphStats>()
  entries.forEach((e) => {
    m.set(e.graph, {
      graph: e.graph,
      nodes: e.nodes ?? null,
      edges: e.edges ?? null,
      loading: e.loading ?? false,
      error: e.error ?? null,
    })
  })
  return m
}

test('renders a row per graph with the loaded node/edge counts', () => {
  renderCard(
    <GraphStatsCard
      graphs={['movies', 'people']}
      stats={statsMap([
        { graph: 'movies', nodes: 42, edges: 99 },
        { graph: 'people', nodes: 7, edges: 3 },
      ])}
      onRefreshAll={() => {}}
      onRefreshOne={() => {}}
    />
  )
  expect(screen.getByTestId('graph-stats-row-movies')).toBeInTheDocument()
  expect(screen.getByTestId('graph-stats-row-people')).toBeInTheDocument()
  expect(screen.getByText('42')).toBeInTheDocument()
  expect(screen.getByText('99')).toBeInTheDocument()
  expect(screen.getByText('7')).toBeInTheDocument()
  expect(screen.getByText('3')).toBeInTheDocument()
})

test('renders an empty-state message when no graphs are present', () => {
  renderCard(
    <GraphStatsCard
      graphs={[]}
      stats={statsMap([])}
      onRefreshAll={() => {}}
      onRefreshOne={() => {}}
    />
  )
  expect(screen.getByRole('status')).toHaveTextContent(
    'No graphs to summarise.'
  )
})

test('filter narrows the visible rows', () => {
  renderCard(
    <GraphStatsCard
      graphs={['movies', 'people', 'companies']}
      stats={statsMap([
        { graph: 'movies', nodes: 1, edges: 1 },
        { graph: 'people', nodes: 1, edges: 1 },
        { graph: 'companies', nodes: 1, edges: 1 },
      ])}
      onRefreshAll={() => {}}
      onRefreshOne={() => {}}
    />
  )
  const input = screen.getByTestId('graph-stats-filter') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'mo' } })
  expect(screen.getByTestId('graph-stats-row-movies')).toBeInTheDocument()
  expect(screen.queryByTestId('graph-stats-row-people')).toBeNull()
  expect(screen.queryByTestId('graph-stats-row-companies')).toBeNull()
})

test('filter that matches nothing shows the no-match status', () => {
  renderCard(
    <GraphStatsCard
      graphs={['movies']}
      stats={statsMap([{ graph: 'movies', nodes: 1, edges: 1 }])}
      onRefreshAll={() => {}}
      onRefreshOne={() => {}}
    />
  )
  fireEvent.change(screen.getByTestId('graph-stats-filter'), {
    target: { value: 'zzz' },
  })
  expect(screen.getByRole('status')).toHaveTextContent(
    'No graphs match the filter.'
  )
})

test('refresh-all button fires onRefreshAll', () => {
  const onRefreshAll = jest.fn()
  renderCard(
    <GraphStatsCard
      graphs={['movies']}
      stats={statsMap([{ graph: 'movies', nodes: 1, edges: 1 }])}
      onRefreshAll={onRefreshAll}
      onRefreshOne={() => {}}
    />
  )
  fireEvent.click(screen.getByTestId('graph-stats-refresh-all'))
  expect(onRefreshAll).toHaveBeenCalledTimes(1)
})

test('per-row refresh button fires onRefreshOne with the row graph name', () => {
  const onRefreshOne = jest.fn()
  renderCard(
    <GraphStatsCard
      graphs={['movies', 'people']}
      stats={statsMap([
        { graph: 'movies', nodes: 1, edges: 1 },
        { graph: 'people', nodes: 2, edges: 2 },
      ])}
      onRefreshAll={() => {}}
      onRefreshOne={onRefreshOne}
    />
  )
  fireEvent.click(screen.getByTestId('graph-stats-refresh-people'))
  expect(onRefreshOne).toHaveBeenCalledTimes(1)
  expect(onRefreshOne).toHaveBeenCalledWith('people')
})

test('renders a pending placeholder while a row is loading', () => {
  renderCard(
    <GraphStatsCard
      graphs={['movies']}
      stats={statsMap([{ graph: 'movies', loading: true }])}
      onRefreshAll={() => {}}
      onRefreshOne={() => {}}
    />
  )
  // The row is in the document but cells show the pending placeholder.
  expect(screen.getByTestId('graph-stats-row-movies')).toBeInTheDocument()
  // The per-row refresh button is disabled while the row is loading.
  const refreshBtn = screen.getByTestId('graph-stats-refresh-movies')
  expect(refreshBtn).toBeDisabled()
})

test('renders an error indicator and surfaces the error via title', () => {
  renderCard(
    <GraphStatsCard
      graphs={['movies']}
      stats={statsMap([{ graph: 'movies', error: 'count() timed out' }])}
      onRefreshAll={() => {}}
      onRefreshOne={() => {}}
    />
  )
  const errIndicator = screen.getByTestId('graph-stats-error-movies')
  expect(errIndicator).toBeInTheDocument()
  expect(errIndicator).toHaveAttribute('title', 'count() timed out')
})

test('rows render in graph-list order, not stats-map insertion order', () => {
  renderCard(
    <GraphStatsCard
      graphs={['a', 'b', 'c']}
      // Insertion order intentionally scrambled to confirm the card
      // iterates `graphs`, not `stats`.
      stats={statsMap([
        { graph: 'c', nodes: 1, edges: 1 },
        { graph: 'a', nodes: 1, edges: 1 },
        { graph: 'b', nodes: 1, edges: 1 },
      ])}
      onRefreshAll={() => {}}
      onRefreshOne={() => {}}
    />
  )
  const rows = screen.getAllByText(/^[abc]$/)
  expect(rows.map((r) => r.textContent)).toEqual(['a', 'b', 'c'])
})
