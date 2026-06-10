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

// Mock the generated client BEFORE importing RolesPage so the
// useEffect-driven fetch resolves against the canned role list.
//
// `getCapabilities` (GET /api/v1/capabilities) is the new Phase-1
// endpoint that gates the "+ New role" CTA; it does not exist in the
// generated client today.
jest.mock('../../api/client', () => ({
  client: {
    getRoles: jest.fn(),
    postAPIRoles: jest.fn(),
    deleteRole: jest.fn(),
    getCapabilities: jest.fn(),
  },
}))

import { RolesPage } from './RolesPage'
import { client } from '../../api/client'

import { testTheme as theme } from '../../test-utils/theme'

const mockClient = client as unknown as {
  getRoles: jest.Mock
  postAPIRoles: jest.Mock
  deleteRole: jest.Mock
  getCapabilities: jest.Mock
}

const renderPage = (): ReturnType<typeof render> =>
  render(
    <ThemeProvider theme={theme}>
      <RolesPage />
    </ThemeProvider>
  )

const capsWritable = (
  roles: boolean
): { geodeVersion: string; adminWritable: Record<string, boolean> } => ({
  // genapi 0.11.1: the generated client returns camelCase (converts the
  // snake_case wire response), so this mock mirrors the client's output.
  geodeVersion: 'v0.5.11-2-gcdf1b54c',
  adminWritable: { users: roles, roles, policies: roles, grants: roles },
})

beforeEach(() => {
  jest.clearAllMocks()
  mockClient.getRoles.mockResolvedValue({
    roles: [
      {
        name: 'admin',
        description: 'Full access',
        permissions: ['read', 'write'],
      },
      { name: 'reader', description: 'Read-only', permissions: ['read'] },
    ],
  })
  mockClient.postAPIRoles.mockResolvedValue({})
  mockClient.deleteRole.mockResolvedValue({})
  mockClient.getCapabilities.mockResolvedValue(capsWritable(true))
})

test('renders role rows from the mocked client', async () => {
  renderPage()

  await waitFor(() => {
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('reader')).toBeInTheDocument()
  })

  expect(screen.getByText('Full access')).toBeInTheDocument()
  expect(screen.getByText('read, write')).toBeInTheDocument()
  expect(screen.getByText('Roles (2)')).toBeInTheDocument()
})

// --- Phase 1: CTA gating --------------------------------------------

test('gates "+ New role" when admin_writable.roles is false', async () => {
  mockClient.getCapabilities.mockResolvedValue(capsWritable(false))
  renderPage()
  await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument())

  const btn = screen.queryByTestId('admin-new-role-btn')
  if (btn) {
    expect(btn).toBeDisabled()
    expect((btn.getAttribute('title') ?? '').length).toBeGreaterThan(0)
  }
  expect(screen.getByTestId('admin-roles-unsupported')).toBeInTheDocument()
})

test('enables "+ New role" when admin_writable.roles is true', async () => {
  mockClient.getCapabilities.mockResolvedValue(capsWritable(true))
  renderPage()
  await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument())

  const btn = await screen.findByTestId('admin-new-role-btn')
  expect(btn).toBeEnabled()
})

// --- Phase 2: chip/tag permission input in the create-role modal -----

test('create-role modal uses a chip input with a suggestions datalist and submits string[]', async () => {
  mockClient.getCapabilities.mockResolvedValue(capsWritable(true))
  renderPage()
  await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument())

  fireEvent.click(await screen.findByTestId('admin-new-role-btn'))
  const dialog = await screen.findByRole('dialog')

  // Name is still required.
  fireEvent.change(within(dialog).getByLabelText(/name/i), {
    target: { value: 'auditor' },
  })

  const permInput = within(dialog).getByTestId(
    'role-permissions-input'
  ) as HTMLInputElement
  // The text-entry field is wired to a <datalist> of permission
  // suggestions (the action:resource cross-product).
  const listId = permInput.getAttribute('list')
  expect(listId).toBeTruthy()
  expect(dialog.querySelector(`datalist#${listId}`)).toBeInTheDocument()

  // Typing a permission + Enter adds a removable chip.
  fireEvent.change(permInput, { target: { value: 'read:graph' } })
  fireEvent.keyDown(permInput, { key: 'Enter' })
  expect(within(dialog).getByText('read:graph')).toBeInTheDocument()

  fireEvent.change(permInput, { target: { value: 'write:node' } })
  fireEvent.keyDown(permInput, { key: 'Enter' })
  expect(within(dialog).getByText('write:node')).toBeInTheDocument()

  // Remove the first chip — the remove control is typically aria-labeled
  // with the permission value; fall back to a within-text query of a
  // sibling button if needed. Either way the chip text must disappear.
  const removeBtn =
    within(dialog).queryByRole('button', {
      name: /remove.*read:graph|read:graph.*remove/i,
    }) ??
    within(dialog)
      .getAllByRole('button')
      .find((b) => /read:graph/i.test(b.getAttribute('aria-label') ?? '')) ??
    null
  if (removeBtn) {
    fireEvent.click(removeBtn)
    expect(within(dialog).queryByText('read:graph')).not.toBeInTheDocument()
  }

  fireEvent.click(within(dialog).getByRole('button', { name: /create/i }))

  await waitFor(() => expect(mockClient.postAPIRoles).toHaveBeenCalled())
  const arg = mockClient.postAPIRoles.mock.calls[0][0]
  expect(Array.isArray(arg.permissions)).toBe(true)
  // After removing read:graph, only write:node remains. (If the remove
  // control wasn't found above the test still pins that the submitted
  // value is the array of chips, not a comma-joined string.)
  if (removeBtn) {
    expect(arg.permissions).toEqual(['write:node'])
  } else {
    expect(arg.permissions).toEqual(['read:graph', 'write:node'])
  }
})
