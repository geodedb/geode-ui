/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'

import { ClusterRoleChip } from './ClusterRoleChip'
import { testTheme } from '../../test-utils/theme'
import { i18n } from '../../services/i18n'
import type { ClusterStatusSnapshot, ClusterMember } from '../../api/cluster'

function renderChip(ui: React.ReactElement): void {
  render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={testTheme}>{ui}</ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>
  )
}

function snap(
  members: ClusterMember[],
  selfNodeId: number | null
): ClusterStatusSnapshot {
  return { members, selfNodeId, fetchedAt: 1 }
}

test('renders null when snapshot is null', () => {
  const { container } = render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={testTheme}>
          <ClusterRoleChip snapshot={null} />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>
  )
  expect(container.firstChild).toBeNull()
})

test('renders null when snapshot is standalone', () => {
  const { container } = render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={testTheme}>
          <ClusterRoleChip
            snapshot={snap(
              [
                {
                  nodeId: 0,
                  role: 'standalone',
                  term: 0,
                  leaderId: 0,
                  endpoint: '0.0.0.0:0',
                  lastContactMs: 0,
                },
              ],
              0
            )}
          />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>
  )
  expect(container.firstChild).toBeNull()
})

test('renders the role label when clustered (leader)', () => {
  renderChip(
    <ClusterRoleChip
      snapshot={snap(
        [
          {
            nodeId: 1,
            role: 'leader',
            term: 5,
            leaderId: 1,
            endpoint: '10.0.0.1:7400',
            lastContactMs: 0,
          },
          {
            nodeId: 2,
            role: 'follower',
            term: 5,
            leaderId: 1,
            endpoint: '10.0.0.2:7400',
            lastContactMs: 10,
          },
        ],
        1
      )}
    />
  )
  const chip = screen.getByTestId('cluster-role-chip')
  expect(chip).toBeVisible()
  expect(chip).toHaveTextContent(/leader/i)
})

test('renders the role label when clustered (follower)', () => {
  renderChip(
    <ClusterRoleChip
      snapshot={snap(
        [
          {
            nodeId: 1,
            role: 'leader',
            term: 5,
            leaderId: 1,
            endpoint: '10.0.0.1:7400',
            lastContactMs: 0,
          },
          {
            nodeId: 2,
            role: 'follower',
            term: 5,
            leaderId: 1,
            endpoint: '10.0.0.2:7400',
            lastContactMs: 10,
          },
        ],
        2
      )}
    />
  )
  expect(screen.getByTestId('cluster-role-chip')).toHaveTextContent(/follower/i)
})

test('is a link that points to /cluster with an aria-label', () => {
  renderChip(
    <ClusterRoleChip
      snapshot={snap(
        [
          {
            nodeId: 1,
            role: 'leader',
            term: 5,
            leaderId: 1,
            endpoint: '10.0.0.1:7400',
            lastContactMs: 0,
          },
          {
            nodeId: 2,
            role: 'follower',
            term: 5,
            leaderId: 1,
            endpoint: '10.0.0.2:7400',
            lastContactMs: 10,
          },
        ],
        1
      )}
    />
  )
  const chip = screen.getByTestId('cluster-role-chip')
  expect(chip.tagName.toLowerCase()).toBe('a')
  expect(chip.getAttribute('href')).toBe('/cluster')
  expect(chip.getAttribute('aria-label')).toMatch(/leader/i)
  expect(chip.getAttribute('aria-label')).toMatch(/cluster/i)
})

test('renders unknown when the self row is missing from members', () => {
  renderChip(
    <ClusterRoleChip
      snapshot={snap(
        [
          {
            nodeId: 7,
            role: 'leader',
            term: 5,
            leaderId: 7,
            endpoint: '10.0.0.7:7400',
            lastContactMs: 0,
          },
        ],
        99 // self id we don't have a row for
      )}
    />
  )
  expect(screen.getByTestId('cluster-role-chip')).toHaveTextContent(/unknown/i)
})
