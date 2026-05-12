import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

import { ConnectionCard } from './ConnectionCard'
import type { AdminWritable } from '../../api/capabilities'
import { testTheme } from '../../test-utils/theme'

function renderCard(ui: React.ReactElement): void {
  render(<ThemeProvider theme={testTheme}>{ui}</ThemeProvider>)
}

const NONE: AdminWritable = {
  users: false,
  roles: false,
  policies: false,
  grants: false,
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
