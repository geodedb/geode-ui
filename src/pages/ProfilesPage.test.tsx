import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
  updateProfile: jest.fn(),
}))

// Mock the modals so the page tests don't need to render their internals.
jest.mock('../components/profiles/ProfileEditorModal', () => ({
  ProfileEditorModal: ({ open, mode, onClose, onSaved }: any) => {
    if (!open) return null
    return (
      <div data-testid={`editor-${mode}`}>
        <button
          data-testid="editor-stub-save"
          onClick={() => {
            onSaved()
            onClose()
          }}
        >
          save
        </button>
      </div>
    )
  },
}))
jest.mock('../components/profiles/DeleteProfileModal', () => ({
  DeleteProfileModal: ({ open, onClose, onDeleted }: any) => {
    if (!open) return null
    return (
      <div data-testid="delete-modal">
        <button
          data-testid="delete-stub-confirm"
          onClick={() => {
            onDeleted()
            onClose()
          }}
        >
          confirm
        </button>
      </div>
    )
  },
}))

const mockList = jest.requireMock('../api/profiles').listProfiles as jest.Mock
const mockUpdate = jest.requireMock('../api/profiles')
  .updateProfile as jest.Mock

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

beforeEach(() => {
  mockList.mockReset()
  mockUpdate.mockReset()
})

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

test('admin: clicking Create opens the editor in create mode', async () => {
  // System profile WITH dsn populated → admin path triggers.
  mockList.mockResolvedValueOnce([
    {
      id: 'a',
      scope: 'system',
      name: 'prod',
      dsn: 'quic://prod:1',
      isDefault: false,
    },
  ])
  renderPage()
  await waitFor(() => expect(screen.getByText('prod')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /create profile/i }))
  expect(screen.getByTestId('editor-create')).toBeInTheDocument()
})

test('admin: per-row Edit opens the editor pre-loaded with the row', async () => {
  mockList.mockResolvedValueOnce([
    {
      id: 'a',
      scope: 'system',
      name: 'prod',
      dsn: 'quic://prod:1',
      isDefault: false,
    },
  ])
  renderPage()
  await waitFor(() => expect(screen.getByText('prod')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
  expect(screen.getByTestId('editor-edit')).toBeInTheDocument()
})

test('non-admin viewing system profiles: row has no Edit/Delete buttons', async () => {
  // System profile WITHOUT dsn → non-admin redaction path. ProfilesPage
  // should infer isAdmin=false and hide action buttons on system rows.
  mockList.mockResolvedValueOnce([
    { id: 'a', scope: 'system', name: 'prod', isDefault: false },
  ])
  renderPage()
  await waitFor(() => expect(screen.getByText('prod')).toBeInTheDocument())
  expect(
    screen.queryByRole('button', { name: /^edit$/i })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /^delete$/i })
  ).not.toBeInTheDocument()
})

test('owner: per-row Edit shown for their own personal profile', async () => {
  // Personal profile with dsn populated → owner is viewing their own profile.
  mockList.mockResolvedValueOnce([
    {
      id: 'p1',
      scope: 'personal',
      ownerUserId: 'alice',
      name: 'alice-dev',
      dsn: 'quic://x:1',
      isDefault: false,
    },
  ])
  renderPage()
  await waitFor(() => expect(screen.getByText('alice-dev')).toBeInTheDocument())
  expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument()
})

// ---------------------------------------------------------------------------
// PSR-G05 (#82) — setAsDefault failures must surface so the user knows the
// click had no effect (or only a partial effect across the two-PATCH dance).
// ---------------------------------------------------------------------------

test('PSR-G05: setAsDefault failure surfaces an error banner and the user can retry', async () => {
  // Two profiles: prod (default) + staging (target). Clicking "Set as
  // default" on staging will issue PATCH(prod, isDefault=false) then
  // PATCH(staging, isDefault=true). Force the second PATCH to reject so
  // the dance ends mid-flight.
  mockList.mockResolvedValueOnce([
    {
      id: 'prod',
      scope: 'system',
      name: 'prod',
      dsn: 'quic://prod:1',
      isDefault: true,
    },
    {
      id: 'stg',
      scope: 'system',
      name: 'staging',
      dsn: 'quic://stg:1',
      isDefault: false,
    },
  ])
  // Refresh-after-failure also returns the same shape so the table
  // re-renders cleanly.
  mockList.mockResolvedValue([
    {
      id: 'prod',
      scope: 'system',
      name: 'prod',
      dsn: 'quic://prod:1',
      isDefault: false,
    },
    {
      id: 'stg',
      scope: 'system',
      name: 'staging',
      dsn: 'quic://stg:1',
      isDefault: false,
    },
  ])
  mockUpdate
    .mockResolvedValueOnce(undefined) // prod cleared OK
    .mockRejectedValueOnce(new Error('500 internal')) // staging promote fails
    .mockResolvedValueOnce(undefined) // retry: prod no-op (already cleared)
    .mockResolvedValueOnce(undefined) // retry: staging promote OK

  renderPage()
  await waitFor(() => expect(screen.getByText('staging')).toBeInTheDocument())

  // Click setDefault on the staging row.
  fireEvent.click(screen.getByRole('button', { name: /set as default/i }))

  // Error banner appears; the user can see the failure.
  const alert = await screen.findByTestId('profiles-set-default-error')
  expect(alert).toHaveTextContent(/500 internal/i)

  // After the failed dance the table still re-renders (the catch path
  // calls refresh() so the user sees server-truth) and at least one
  // "Set as default" button must remain so the user can retry. Use
  // queryAllByRole to tolerate multiple rows being non-default.
  const retryBtns = screen.queryAllByRole('button', {
    name: /set as default/i,
  })
  expect(retryBtns.length).toBeGreaterThanOrEqual(1)
})

test('successful save refreshes the list', async () => {
  mockList.mockResolvedValueOnce([
    {
      id: 'a',
      scope: 'system',
      name: 'prod',
      dsn: 'quic://prod:1',
      isDefault: false,
    },
  ])
  mockList.mockResolvedValueOnce([
    {
      id: 'a',
      scope: 'system',
      name: 'prod',
      dsn: 'quic://prod:1',
      isDefault: false,
    },
    {
      id: 'b',
      scope: 'personal',
      ownerUserId: 'alice',
      name: 'new',
      dsn: 'quic://y:2',
      isDefault: false,
    },
  ])
  renderPage()
  await waitFor(() => expect(screen.getByText('prod')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /create profile/i }))
  fireEvent.click(screen.getByTestId('editor-stub-save'))
  await waitFor(() => expect(screen.getByText('new')).toBeInTheDocument())
})
