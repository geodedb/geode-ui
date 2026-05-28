import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'

import { MembersTable } from './MembersTable'
import { testTheme } from '../../test-utils/theme'
import { i18n } from '../../services/i18n'
import type { ClusterMember } from '../../api/cluster'

function renderTable(ui: React.ReactElement): void {
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={testTheme}>{ui}</ThemeProvider>
    </I18nextProvider>
  )
}

const members: ClusterMember[] = [
  {
    nodeId: 1,
    role: 'leader',
    term: 7,
    leaderId: 1,
    endpoint: '10.0.0.1:7400',
    lastContactMs: 0,
  },
  {
    nodeId: 2,
    role: 'follower',
    term: 7,
    leaderId: 1,
    endpoint: '10.0.0.2:7400',
    lastContactMs: 12,
  },
  {
    nodeId: 3,
    role: 'follower',
    term: 7,
    leaderId: 1,
    endpoint: '10.0.0.3:7400',
    lastContactMs: 45_000,
  },
]

test('renders all six column headers', () => {
  renderTable(<MembersTable members={members} selfNodeId={1} />)
  expect(screen.getByRole('columnheader', { name: 'Node' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Role' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Term' })).toBeInTheDocument()
  expect(
    screen.getByRole('columnheader', { name: 'Leader' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('columnheader', { name: 'Endpoint' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('columnheader', { name: 'Last contact' })
  ).toBeInTheDocument()
})

test('renders one row per member with the right data', () => {
  renderTable(<MembersTable members={members} selfNodeId={1} />)
  const rows = screen.getAllByTestId('cluster-member-row')
  expect(rows).toHaveLength(3)
  expect(within(rows[0]!).getByText('10.0.0.1:7400')).toBeInTheDocument()
  expect(within(rows[1]!).getByText('10.0.0.2:7400')).toBeInTheDocument()
  expect(within(rows[2]!).getByText('10.0.0.3:7400')).toBeInTheDocument()
})

test('marks the self row with the self badge and a data-self="true" attribute', () => {
  renderTable(<MembersTable members={members} selfNodeId={2} />)
  const rows = screen.getAllByTestId('cluster-member-row')
  expect(rows[0]).toHaveAttribute('data-self', 'false')
  expect(rows[1]).toHaveAttribute('data-self', 'true')
  expect(within(rows[1]!).getByText(/this node/i)).toBeInTheDocument()
})

test('marks the leader row with data-leader="true"', () => {
  renderTable(<MembersTable members={members} selfNodeId={1} />)
  const rows = screen.getAllByTestId('cluster-member-row')
  expect(rows[0]).toHaveAttribute('data-leader', 'true')
  expect(rows[1]).toHaveAttribute('data-leader', 'false')
})

test('formats freshness — fresh (< 2s), stale (2-30s), lost (>= 30s)', () => {
  const variedMembers: ClusterMember[] = [
    { ...members[0]!, nodeId: 10, lastContactMs: 0 },
    { ...members[1]!, nodeId: 11, lastContactMs: 500 },
    { ...members[2]!, nodeId: 12, lastContactMs: 5000 },
    { ...members[2]!, nodeId: 13, lastContactMs: 90_000 },
  ]
  renderTable(<MembersTable members={variedMembers} selfNodeId={10} />)
  const rows = screen.getAllByTestId('cluster-member-row')
  expect(rows[0]).toHaveAttribute('data-freshness', 'self')
  expect(rows[1]).toHaveAttribute('data-freshness', 'fresh')
  expect(rows[2]).toHaveAttribute('data-freshness', 'stale')
  expect(rows[3]).toHaveAttribute('data-freshness', 'lost')
})

test('renders empty state when members is empty', () => {
  renderTable(<MembersTable members={[]} selfNodeId={null} />)
  expect(screen.queryByTestId('cluster-member-row')).not.toBeInTheDocument()
  // The table itself still renders (the operator should see "Members" + headers).
  expect(screen.getByRole('columnheader', { name: 'Node' })).toBeInTheDocument()
})
