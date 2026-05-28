/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'
import { LocalizationProvider } from '../services/i18n'
import { testTheme as theme } from '../test-utils/theme'
import type { ClusterStatusSnapshot, ClusterMember } from '../api/cluster'
import type { UseClusterStatusResult } from '../lib/useClusterStatus'

const clusterFixture: {
  current: UseClusterStatusResult
} = {
  current: {
    snapshot: null,
    loading: true,
    error: null,
    refresh: jest.fn().mockResolvedValue(undefined),
  },
}

jest.mock('../lib/useClusterStatus', () => ({
  useClusterStatus: (): UseClusterStatusResult => clusterFixture.current,
}))

import { ClusterPage } from './ClusterPage'

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <LocalizationProvider>
        <ThemeProvider theme={theme}>
          <ClusterPage />
        </ThemeProvider>
      </LocalizationProvider>
    </MemoryRouter>
  )
}

function makeMember(
  partial: Partial<ClusterMember> & { nodeId: number }
): ClusterMember {
  return {
    nodeId: partial.nodeId,
    role: partial.role ?? 'follower',
    term: partial.term ?? 1,
    leaderId: partial.leaderId ?? 1,
    endpoint: partial.endpoint ?? `10.0.0.${partial.nodeId}:7400`,
    lastContactMs: partial.lastContactMs ?? 0,
  }
}

describe('ClusterPage', () => {
  afterEach(() => {
    cleanup()
    clusterFixture.current = {
      snapshot: null,
      loading: true,
      error: null,
      refresh: jest.fn().mockResolvedValue(undefined),
    }
  })

  it('renders loading state when no snapshot yet', () => {
    renderPage()
    expect(screen.getByText(/Loading cluster status/)).toBeInTheDocument()
  })

  it('renders the error panel when error is set and no snapshot', () => {
    clusterFixture.current = {
      snapshot: null,
      loading: false,
      error: 'permission_denied: principal lacks cluster.read',
      refresh: jest.fn().mockResolvedValue(undefined),
    }
    renderPage()
    expect(screen.getByText(/Cluster status unavailable/)).toBeInTheDocument()
    expect(
      screen.getByText(/permission_denied: principal lacks cluster.read/)
    ).toBeInTheDocument()
  })

  it('renders the standalone panel when snapshot has a single standalone row', () => {
    const snap: ClusterStatusSnapshot = {
      members: [makeMember({ nodeId: 0, role: 'standalone', leaderId: 0 })],
      selfNodeId: 0,
      fetchedAt: 1,
    }
    clusterFixture.current = {
      snapshot: snap,
      loading: false,
      error: null,
      refresh: jest.fn().mockResolvedValue(undefined),
    }
    renderPage()
    expect(screen.getByTestId('cluster-standalone-panel')).toBeInTheDocument()
    expect(
      screen.queryByTestId('cluster-members-table')
    ).not.toBeInTheDocument()
  })

  it('renders the members table when clustered', () => {
    const snap: ClusterStatusSnapshot = {
      members: [
        makeMember({ nodeId: 1, role: 'leader', term: 4, leaderId: 1 }),
        makeMember({
          nodeId: 2,
          role: 'follower',
          term: 4,
          leaderId: 1,
          lastContactMs: 10,
        }),
      ],
      selfNodeId: 1,
      fetchedAt: 1,
    }
    clusterFixture.current = {
      snapshot: snap,
      loading: false,
      error: null,
      refresh: jest.fn().mockResolvedValue(undefined),
    }
    renderPage()
    expect(screen.getByTestId('cluster-members-table')).toBeInTheDocument()
    expect(screen.getAllByTestId('cluster-member-row')).toHaveLength(2)
  })

  it('manual refresh button calls hook.refresh()', () => {
    const refresh = jest.fn().mockResolvedValue(undefined)
    clusterFixture.current = {
      snapshot: {
        members: [makeMember({ nodeId: 1, role: 'leader' })],
        selfNodeId: 1,
        fetchedAt: 1,
      },
      loading: false,
      error: null,
      refresh,
    }
    renderPage()
    fireEvent.click(screen.getByTestId('cluster-refresh-btn'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
