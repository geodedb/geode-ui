import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'

import { ClusterCard } from './ClusterCard'
import { testTheme } from '../../test-utils/theme'
import { i18n } from '../../services/i18n'
import type { ClusterStatusSnapshot } from '../../api/cluster'

function renderCard(ui: React.ReactElement): void {
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={testTheme}>{ui}</ThemeProvider>
    </I18nextProvider>
  )
}

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

const clusteredSnap: ClusterStatusSnapshot = {
  members: [
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
      lastContactMs: 7,
    },
  ],
  selfNodeId: 1,
  fetchedAt: 1,
}

test('renders nothing in standalone mode', () => {
  const { container } = render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={testTheme}>
        <ClusterCard snapshot={standaloneSnap} loading={false} error={null} />
      </ThemeProvider>
    </I18nextProvider>
  )
  expect(container.firstChild).toBeNull()
})

test('renders cluster role / term / leader / member count when clustered', () => {
  renderCard(
    <ClusterCard snapshot={clusteredSnap} loading={false} error={null} />
  )
  expect(screen.getByTestId('dashboard-cluster-card')).toBeInTheDocument()
  expect(screen.getByText('Leader')).toBeInTheDocument()
  expect(screen.getByText(/Term/)).toBeInTheDocument()
  // Self-node label shows next to nodeId 1.
  expect(screen.getByText(/this node/)).toBeInTheDocument()
  // Member count reflects 3 nodes.
  expect(screen.getByText(/3/)).toBeInTheDocument()
})

test('renders loading state when snapshot is null and loading=true', () => {
  renderCard(<ClusterCard snapshot={null} loading error={null} />)
  expect(screen.getByText(/Loading cluster status/)).toBeInTheDocument()
})

test('renders the error string when error is set', () => {
  renderCard(
    <ClusterCard snapshot={null} loading={false} error="upstream timeout" />
  )
  expect(screen.getByText(/upstream timeout/)).toBeInTheDocument()
})
