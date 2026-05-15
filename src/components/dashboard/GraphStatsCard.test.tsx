import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

import { GraphStatsCard } from './GraphStatsCard'
import { testTheme } from '../../test-utils/theme'

function renderCard(ui: React.ReactElement): void {
  render(<ThemeProvider theme={testTheme}>{ui}</ThemeProvider>)
}

test('renders an enabled load button when stats are not yet loaded', () => {
  renderCard(
    <GraphStatsCard
      defaultGraph="movies"
      stats={null}
      loading={false}
      error={null}
      onLoad={() => {}}
    />
  )
  const btn = screen.getByTestId('dashboard-stats-load')
  expect(btn).toBeInTheDocument()
  expect(btn).toBeEnabled()
})

test('clicking the load button calls onLoad', () => {
  const onLoad = jest.fn()
  renderCard(
    <GraphStatsCard
      defaultGraph="movies"
      stats={null}
      loading={false}
      error={null}
      onLoad={onLoad}
    />
  )
  fireEvent.click(screen.getByTestId('dashboard-stats-load'))
  expect(onLoad).toHaveBeenCalledTimes(1)
})

test('disables the load button when there is no default graph', () => {
  renderCard(
    <GraphStatsCard
      defaultGraph={null}
      stats={null}
      loading={false}
      error={null}
      onLoad={() => {}}
    />
  )
  expect(screen.getByTestId('dashboard-stats-load')).toBeDisabled()
})

test('shows a loading status while loading', () => {
  renderCard(
    <GraphStatsCard
      defaultGraph="movies"
      stats={null}
      loading
      error={null}
      onLoad={() => {}}
    />
  )
  expect(screen.getByRole('status')).toBeInTheDocument()
})

test('shows node and edge counts once loaded', () => {
  renderCard(
    <GraphStatsCard
      defaultGraph="movies"
      stats={{ nodes: 42, edges: 99 }}
      loading={false}
      error={null}
      onLoad={() => {}}
    />
  )
  expect(screen.getByText('42')).toBeInTheDocument()
  expect(screen.getByText('99')).toBeInTheDocument()
})

test('shows an alert on error', () => {
  renderCard(
    <GraphStatsCard
      defaultGraph="movies"
      stats={null}
      loading={false}
      error="oops"
      onLoad={() => {}}
    />
  )
  expect(screen.getByRole('alert')).toHaveTextContent('oops')
})
