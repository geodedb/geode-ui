/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

// Mock the generated client BEFORE importing UsersPage so the
// useEffect-driven fetch resolves against the canned user list.
//
// `getCapabilities` is the new Phase-1 endpoint (GET /api/v1/capabilities)
// the Admin page consults to gate the "+ New user" CTA. It does not exist
// in the generated client today; mocking it here keeps import-resolution
// clean and lets the tests below drive the gating behaviour the SPA does
// not yet implement.
jest.mock('../../api/client', () => ({
  client: {
    getUsers: jest.fn(),
    postUsers: jest.fn(),
    deleteUsername: jest.fn(),
    disable: jest.fn(),
    enable: jest.fn(),
    getCapabilities: jest.fn(),
  },
}))

import { UsersPage } from './UsersPage'
import { client } from '../../api/client'
import { WIRE_FEATURE_MISSING } from '../../api/serverErrorCodes'

import { testTheme as theme } from '../../test-utils/theme'

const mockClient = client as unknown as {
  getUsers: jest.Mock
  postUsers: jest.Mock
  deleteUsername: jest.Mock
  disable: jest.Mock
  enable: jest.Mock
  getCapabilities: jest.Mock
}

const renderPage = (): ReturnType<typeof render> =>
  render(
    <ThemeProvider theme={theme}>
      <UsersPage />
    </ThemeProvider>
  )

const capsWritable = (
  users: boolean
): { geodeVersion: string; adminWritable: Record<string, boolean> } => ({
  // genapi 0.11.1: the generated client returns camelCase (converts the
  // snake_case wire response), so this mock mirrors the client's output.
  geodeVersion: 'v0.5.11-2-gcdf1b54c',
  adminWritable: { users, roles: users, policies: users, grants: users },
})

beforeEach(() => {
  jest.clearAllMocks()
  mockClient.getUsers.mockResolvedValue({
    users: [
      {
        username: 'alice',
        email: 'alice@example.com',
        roles: ['admin'],
        disabled: false,
      },
      {
        username: 'bob',
        email: 'bob@example.com',
        roles: [],
        disabled: true,
      },
    ],
  })
  mockClient.postUsers.mockResolvedValue({})
  mockClient.deleteUsername.mockResolvedValue({})
  mockClient.disable.mockResolvedValue({})
  mockClient.enable.mockResolvedValue({})
  // Default: admin DDL supported, so the "+ New user" CTA is enabled.
  mockClient.getCapabilities.mockResolvedValue(capsWritable(true))
})

test('renders user rows with username, email, and status from the mocked client', async () => {
  renderPage()

  // Wait for the async getUsers() call to settle and the table to
  // render the canned rows. The two known usernames should both be in
  // the document, and bob's row should be marked 'disabled'.
  await waitFor(() => {
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
  })

  expect(screen.getByText('alice@example.com')).toBeInTheDocument()
  expect(screen.getByText('disabled')).toBeInTheDocument()
  expect(screen.getByText('active')).toBeInTheDocument()
  // Header reflects total count once data has loaded.
  expect(screen.getByText('Users (2)')).toBeInTheDocument()
})

// --- Phase 1: CTA gating from /api/v1/capabilities -------------------

test('hides or disables "+ New user" when admin_writable.users is false', async () => {
  mockClient.getCapabilities.mockResolvedValue(capsWritable(false))
  renderPage()

  await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())

  // The button is gated: either absent from the DOM, or rendered with
  // `disabled` AND an explanatory title/tooltip. There must also be an
  // `admin-users-unsupported` affordance explaining why.
  const btn = screen.queryByTestId('admin-new-user-btn')
  if (btn) {
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title')
    expect((btn.getAttribute('title') ?? '').length).toBeGreaterThan(0)
  }
  expect(screen.getByTestId('admin-users-unsupported')).toBeInTheDocument()
})

test('enables "+ New user" when admin_writable.users is true', async () => {
  mockClient.getCapabilities.mockResolvedValue(capsWritable(true))
  renderPage()

  await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())

  const btn = await screen.findByTestId('admin-new-user-btn')
  expect(btn).toBeEnabled()
  expect(
    screen.queryByTestId('admin-users-unsupported')
  ).not.toBeInTheDocument()
})

// --- Phase 1: friendly error mapping for wire_feature_missing --------

test('surfaces the friendly error_description, not the raw 501 blob, on wire_feature_missing', async () => {
  mockClient.getCapabilities.mockResolvedValue(capsWritable(true))
  // Defense-in-depth: even when gating let the modal open, a create POST
  // that fails with wire_feature_missing must render the parsed
  // description (or a clean i18n string), not "http status 501: {…}".
  const desc =
    'this operation is not supported on the connected Geode build (status_class=42000); the SPA may have surfaced this CTA prematurely'
  mockClient.postUsers.mockRejectedValue(
    Object.assign(
      new Error(
        'http status 501: {"error":"' +
          WIRE_FEATURE_MISSING +
          '","error_description":"' +
          desc +
          '"}'
      ),
      {
        status: 501,
        body: { error: WIRE_FEATURE_MISSING, error_description: desc },
      }
    )
  )

  renderPage()
  await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())

  fireEvent.click(await screen.findByTestId('admin-new-user-btn'))
  const dialog = await screen.findByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText(/username/i), {
    target: { value: 'carol' },
  })
  fireEvent.change(within(dialog).getByLabelText(/email/i), {
    target: { value: 'carol@example.com' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: /create/i }))

  const alert = await screen.findByRole('alert')
  // Friendly: contains (some of) the description text.
  expect(alert).toHaveTextContent(/not supported on the connected Geode build/i)
  // NOT the raw transport prefix.
  expect(alert).not.toHaveTextContent(/http status 501/i)
})
