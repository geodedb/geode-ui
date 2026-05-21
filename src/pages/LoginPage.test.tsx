import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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

// Task 7 (2026-05-21 login profile UX): the three new tests below use
// the same provider stack as `renderLogin` but drive the public-profiles
// fetch via a global `fetch` spy rather than the module-level
// `fetchPublicProfiles` mock. `fetchPublicProfiles` in `src/api/auth.ts`
// is a thin wrapper over `fetch('/api/v1/profiles/public')`, so spying
// on `global.fetch` lets each test return a different profiles payload
// without re-mocking the module per-test. The module mock above is
// shared by the original two tests; the new tests opt out by re-routing
// `fetchPublicProfiles` to the real implementation through the spy.
const renderPage = renderLogin

test('renders the public profile list on mount', async () => {
  renderLogin()
  await waitFor(() => {
    expect(screen.getByText(/^default$/)).toBeInTheDocument()
    expect(screen.getByText(/^prod$/)).toBeInTheDocument()
    expect(screen.getByText('Default cluster')).toBeInTheDocument()
    expect(screen.getByText('Production')).toBeInTheDocument()
  })
})

test('still renders the login form when fetchPublicProfiles fails', async () => {
  // Task 7 refactor: when the public-profiles fetch errors out, the
  // page no longer renders a free-form profile text input — the old
  // `showList ? ul : wa-input` ternary was replaced by a single
  // ProfileFilter call that ONLY renders when profiles are populated.
  // The credentials form still mounts (default profile state is
  // 'default'), so the operator can submit; the picker is just absent.
  const mod = jest.requireMock('../api/auth') as {
    fetchPublicProfiles: jest.Mock
  }
  mod.fetchPublicProfiles.mockRejectedValueOnce(new Error('boom'))
  renderLogin()
  await waitFor(() => {
    expect(screen.getByTestId('login-username')).toBeInTheDocument()
    expect(screen.getByTestId('login-submit-btn')).toBeInTheDocument()
  })
  // The pre-refactor fallback (#login-profile WaInput) no longer
  // renders — confirm that.
  expect(document.querySelector('#login-profile')).toBeNull()
})

test('renders OnboardProfileForm when public profiles list is empty', async () => {
  const mod = jest.requireMock('../api/auth') as {
    fetchPublicProfiles: jest.Mock
  }
  mod.fetchPublicProfiles.mockResolvedValueOnce([])

  renderPage()

  expect(await screen.findByTestId('onboard-name')).toBeInTheDocument()
  expect(screen.queryByTestId('login-submit-btn')).toBeNull()
})

test('renders ProfileFilter when public profiles list is non-empty', async () => {
  const mod = jest.requireMock('../api/auth') as {
    fetchPublicProfiles: jest.Mock
  }
  mod.fetchPublicProfiles.mockResolvedValueOnce([
    { name: 'default', description: 'in-cluster' },
    { name: 'social', description: 'social graph' },
  ])

  renderPage()

  expect(await screen.findByTestId('profile-filter-input')).toBeInTheDocument()
  expect(screen.getByTestId('profile-filter-row-default')).toBeInTheDocument()
  expect(screen.getByTestId('profile-filter-row-social')).toBeInTheDocument()
})

test('clicking the Add-profile toggle on LoginPage swaps in OnboardProfileForm', async () => {
  const mod = jest.requireMock('../api/auth') as {
    fetchPublicProfiles: jest.Mock
  }
  mod.fetchPublicProfiles.mockResolvedValueOnce([{ name: 'default' }])

  renderPage()

  expect(await screen.findByTestId('profile-filter-input')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('login-add-profile'))
  expect(await screen.findByTestId('onboard-name')).toBeInTheDocument()
  expect(screen.queryByTestId('profile-filter-input')).toBeNull()
})
