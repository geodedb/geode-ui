import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from 'styled-components'

import { testTheme as theme } from '../test-utils/theme'
import { LoginPage } from './LoginPage'
import { ConnectionsProvider } from '../api/connections'
import { AuthProvider } from '../auth/AuthProvider'

jest.mock('../api/auth', () => ({
  ...jest.requireActual('../api/auth'),
  fetchPublicProfiles: jest.fn(async () => [
    { name: 'default', description: 'Default cluster' },
    { name: 'prod', description: 'Production' },
  ]),
}))

const renderLogin = () =>
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <ConnectionsProvider>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </ConnectionsProvider>
      </MemoryRouter>
    </ThemeProvider>
  )

test('renders the public profile list on mount', async () => {
  renderLogin()
  await waitFor(() => {
    expect(screen.getByText(/^default$/)).toBeInTheDocument()
    expect(screen.getByText(/^prod$/)).toBeInTheDocument()
    expect(screen.getByText('Default cluster')).toBeInTheDocument()
    expect(screen.getByText('Production')).toBeInTheDocument()
  })
})

test('falls back to a profile text input when fetchPublicProfiles fails', async () => {
  const mod = jest.requireMock('../api/auth') as {
    fetchPublicProfiles: jest.Mock
  }
  mod.fetchPublicProfiles.mockRejectedValueOnce(new Error('boom'))
  renderLogin()
  await waitFor(() => {
    // Fallback affordance: the text input labelled with the existing
    // "auth.profile" key. The exact label text depends on the locale,
    // so look it up by id (LoginPage uses id="login-profile").
    expect(document.querySelector('#login-profile')).not.toBeNull()
  })
})
