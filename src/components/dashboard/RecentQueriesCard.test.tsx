import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'

import { RecentQueriesCard } from './RecentQueriesCard'
import type { QueryHistoryEntry } from '../../lib/useQueryHistory'
import { testTheme } from '../../test-utils/theme'

function renderCard(ui: React.ReactElement): void {
  render(
    <MemoryRouter>
      <ThemeProvider theme={testTheme}>{ui}</ThemeProvider>
    </MemoryRouter>
  )
}

const entries: QueryHistoryEntry[] = [
  {
    statement: 'MATCH (a) RETURN a',
    ranAt: 1700000000000,
    rowCount: 3,
    ok: true,
  },
  {
    statement: 'MATCH (b) RETURN b',
    ranAt: 1700000001000,
    rowCount: null,
    ok: false,
  },
]

test('renders one row per entry with a deep link to the query page', () => {
  renderCard(<RecentQueriesCard entries={entries} onClear={() => {}} />)
  expect(screen.getAllByTestId('dashboard-recent-row')).toHaveLength(2)
  const firstLink = screen.getAllByRole('link')[0] as HTMLAnchorElement
  expect(firstLink.getAttribute('href')).toContain('statement=MATCH')
})

test('shows the failed marker for an entry with no row count', () => {
  renderCard(<RecentQueriesCard entries={entries} onClear={() => {}} />)
  expect(screen.getByText('failed')).toBeInTheDocument()
})

test('clicking Clear calls onClear', () => {
  const onClear = jest.fn()
  renderCard(<RecentQueriesCard entries={entries} onClear={onClear} />)
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  expect(onClear).toHaveBeenCalledTimes(1)
})

test('shows an empty state when there are no entries', () => {
  renderCard(<RecentQueriesCard entries={[]} onClear={() => {}} />)
  expect(screen.getByRole('note')).toBeInTheDocument()
})

// GAP-048: the card header used to read "Recent queries", which the
// user reasonably read as a server-backed audit slice. It is in fact
// a per-device localStorage log (see useQueryHistory.ts). Rename +
// scope-hint pin the contract so a hurried operator does not mistake
// it for cross-machine history.
test('GAP-048: title reflects session-only scope', () => {
  renderCard(<RecentQueriesCard entries={[]} onClear={() => {}} />)
  expect(screen.getByText(/session query history/i)).toBeInTheDocument()
})

test('GAP-048: surfaces a scope hint explaining device-only storage', () => {
  renderCard(<RecentQueriesCard entries={[]} onClear={() => {}} />)
  const hint = screen.getByTestId('dashboard-recent-scope-hint')
  expect(hint).toHaveTextContent(/this device only/i)
})
