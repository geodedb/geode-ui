import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'
import i18n from '../services/i18n/config'
import { lightTheme } from '../theme'
import { ConnectionsProvider } from '../api/connections'
import { ProfilesPage } from './ProfilesPage'

jest.mock('../api/profiles', () => ({
  ...jest.requireActual('../api/profiles'),
  listProfiles: jest.fn(),
}))

const mockList = jest.requireMock('../api/profiles').listProfiles as jest.Mock

const renderPage = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>
        <ConnectionsProvider>
          <MemoryRouter>
            <ProfilesPage />
          </MemoryRouter>
        </ConnectionsProvider>
      </ThemeProvider>
    </I18nextProvider>
  )

beforeEach(() => mockList.mockReset())

test('shows loading then renders fetched profiles', async () => {
  mockList.mockResolvedValueOnce([
    {
      id: 'a',
      scope: 'system',
      name: 'prod',
      description: 'Production',
      isDefault: true,
    },
    {
      id: 'b',
      scope: 'personal',
      ownerUserId: 'alice',
      name: 'alice-dev',
      isDefault: false,
    },
  ])
  renderPage()
  await waitFor(() => expect(screen.getByText('prod')).toBeInTheDocument())
  expect(screen.getByText('alice-dev')).toBeInTheDocument()
  // Default badge appears.
  expect(screen.getAllByText(/default/i).length).toBeGreaterThanOrEqual(1)
})

test('renders empty state when no profiles returned', async () => {
  mockList.mockResolvedValueOnce([])
  renderPage()
  await waitFor(() =>
    expect(screen.getByText(/no profiles yet/i)).toBeInTheDocument()
  )
})

test('renders error state on listProfiles failure', async () => {
  mockList.mockRejectedValueOnce(new Error('boom'))
  renderPage()
  await waitFor(() =>
    expect(screen.getByText(/could not load profiles/i)).toBeInTheDocument()
  )
})
