import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

import { ConnectionCard } from './ConnectionCard'
import type { AdminWritable } from '../../api/capabilities'
import type { ClusterStatusSnapshot } from '../../api/cluster'
import { testTheme } from '../../test-utils/theme'

function renderCard(ui: React.ReactElement): void {
  render(<ThemeProvider theme={testTheme}>{ui}</ThemeProvider>)
}

const NONE: AdminWritable = {
  users: false,
  roles: false,
  policies: false,
  grants: false,
  attributes: false,
  rlsDenyPolicies: false,
  rlsAttributePolicies: false,
}

test('renders the version and all four capabilities disabled', () => {
  renderCard(
    <ConnectionCard
      geodeVersion="v0.5.11"
      adminWritable={NONE}
      loading={false}
      error={null}
    />
  )
  expect(screen.getByText(/v0\.5\.11/)).toBeInTheDocument()
  expect(screen.getAllByText('disabled')).toHaveLength(4)
})

test('shows enabled for a capability that is true', () => {
  renderCard(
    <ConnectionCard
      geodeVersion="v0.5.11"
      adminWritable={{ ...NONE, users: true }}
      loading={false}
      error={null}
    />
  )
  const usersRow = screen.getByText('Users').closest('li') as HTMLElement
  expect(within(usersRow).getByText('enabled')).toBeInTheDocument()
  expect(screen.getAllByText('disabled')).toHaveLength(3)
})

test('shows a loading status while loading', () => {
  renderCard(
    <ConnectionCard
      geodeVersion={null}
      adminWritable={null}
      loading
      error={null}
    />
  )
  expect(screen.getByRole('status')).toBeInTheDocument()
})

test('shows an alert on error', () => {
  renderCard(
    <ConnectionCard
      geodeVersion={null}
      adminWritable={null}
      loading={false}
      error="x"
    />
  )
  expect(screen.getByRole('alert')).toHaveTextContent('x')
})

test('cluster row is absent when clusterSnapshot is undefined', () => {
  renderCard(
    <ConnectionCard
      geodeVersion="v1"
      adminWritable={NONE}
      loading={false}
      error={null}
    />
  )
  expect(
    screen.queryByTestId('connection-card-cluster-row')
  ).not.toBeInTheDocument()
})

test('cluster row is absent when clusterSnapshot is standalone', () => {
  const standaloneSnap: ClusterStatusSnapshot = {
    members: [
      {
        nodeId: 0,
        role: 'standalone',
        term: 0,
        leaderId: 0,
        endpoint: '0.0.0.0:0',
        lastContactMs: 0,
      },
    ],
    selfNodeId: 0,
    fetchedAt: 1,
  }
  renderCard(
    <ConnectionCard
      geodeVersion="v1"
      adminWritable={NONE}
      loading={false}
      error={null}
      clusterSnapshot={standaloneSnap}
    />
  )
  expect(
    screen.queryByTestId('connection-card-cluster-row')
  ).not.toBeInTheDocument()
})

test('cluster row renders membership count + role when clustered', () => {
  const clusteredSnap: ClusterStatusSnapshot = {
    members: [
      {
        nodeId: 1,
        role: 'leader',
        term: 4,
        leaderId: 1,
        endpoint: '10.0.0.1:7400',
        lastContactMs: 0,
      },
      {
        nodeId: 2,
        role: 'follower',
        term: 4,
        leaderId: 1,
        endpoint: '10.0.0.2:7400',
        lastContactMs: 10,
      },
      {
        nodeId: 3,
        role: 'follower',
        term: 4,
        leaderId: 1,
        endpoint: '10.0.0.3:7400',
        lastContactMs: 7,
      },
    ],
    selfNodeId: 1,
    fetchedAt: 1,
  }
  renderCard(
    <ConnectionCard
      geodeVersion="v1"
      adminWritable={NONE}
      loading={false}
      error={null}
      clusterSnapshot={clusteredSnap}
    />
  )
  const row = screen.getByTestId('connection-card-cluster-row')
  expect(row).toBeInTheDocument()
  expect(row).toHaveTextContent('Cluster')
  expect(row).toHaveTextContent('3 nodes')
  expect(row).toHaveTextContent(/leader/i)
})
