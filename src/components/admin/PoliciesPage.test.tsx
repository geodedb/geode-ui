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

// Mock the generated client BEFORE importing PoliciesPage so the
// useEffect-driven fetch resolves against the canned policy list.
//
// `getCapabilities` (GET /api/v1/capabilities) is the new Phase-1
// endpoint that gates the "+ New policy" CTA; it does not exist in the
// generated client today.
jest.mock('../../api/client', () => ({
  client: {
    getPolicies: jest.fn(),
    postPolicies: jest.fn(),
    deleteName: jest.fn(),
    getCapabilities: jest.fn(),
  },
}))

import { PoliciesPage } from './PoliciesPage'
import { client } from '../../api/client'

import { testTheme as theme } from '../../test-utils/theme'

const mockClient = client as unknown as {
  getPolicies: jest.Mock
  postPolicies: jest.Mock
  deleteName: jest.Mock
  getCapabilities: jest.Mock
}

const renderPage = (): ReturnType<typeof render> =>
  render(
    <ThemeProvider theme={theme}>
      <PoliciesPage />
    </ThemeProvider>
  )

const capsWritable = (
  policies: boolean
): { geodeVersion: string; adminWritable: Record<string, boolean> } => ({
  // genapi 0.11.1: the generated client returns camelCase (converts the
  // snake_case wire response), so this mock mirrors the client's output.
  geodeVersion: 'v0.5.11-2-gcdf1b54c',
  adminWritable: {
    users: policies,
    roles: policies,
    policies,
    grants: policies,
  },
})

beforeEach(() => {
  jest.clearAllMocks()
  mockClient.getPolicies.mockResolvedValue({
    policies: [
      {
        name: 'tenant_isolation',
        resource: 'graph:default',
        expression: 'tenant_id = $tenant',
      },
      {
        name: 'rls_owner',
        resource: 'graph:billing',
        expression: 'owner = $user',
      },
    ],
  })
  mockClient.postPolicies.mockResolvedValue({})
  mockClient.deleteName.mockResolvedValue({})
  mockClient.getCapabilities.mockResolvedValue(capsWritable(true))
})

test('renders policy rows from the mocked client', async () => {
  renderPage()

  await waitFor(() => {
    expect(screen.getByText('tenant_isolation')).toBeInTheDocument()
    expect(screen.getByText('rls_owner')).toBeInTheDocument()
  })

  expect(screen.getByText('graph:default')).toBeInTheDocument()
  expect(screen.getByText('tenant_id = $tenant')).toBeInTheDocument()
  expect(screen.getByText('Policies (2)')).toBeInTheDocument()
})

// --- Phase 1: CTA gating --------------------------------------------

test('gates "+ New policy" when admin_writable.policies is false', async () => {
  mockClient.getCapabilities.mockResolvedValue(capsWritable(false))
  renderPage()
  await waitFor(() =>
    expect(screen.getByText('tenant_isolation')).toBeInTheDocument()
  )

  const btn = screen.queryByTestId('admin-new-policy-btn')
  if (btn) {
    expect(btn).toBeDisabled()
    expect((btn.getAttribute('title') ?? '').length).toBeGreaterThan(0)
  }
  expect(screen.getByTestId('admin-policies-unsupported')).toBeInTheDocument()
})

test('enables "+ New policy" when admin_writable.policies is true', async () => {
  mockClient.getCapabilities.mockResolvedValue(capsWritable(true))
  renderPage()
  await waitFor(() =>
    expect(screen.getByText('tenant_isolation')).toBeInTheDocument()
  )

  const btn = await screen.findByTestId('admin-new-policy-btn')
  expect(btn).toBeEnabled()
})

// --- Phase 2: structured RowLevelPolicy form ------------------------

test('create-policy modal exposes Operation/Table/Using fields (no free-text Expression) and submits a coherent body', async () => {
  mockClient.getCapabilities.mockResolvedValue(capsWritable(true))
  renderPage()
  await waitFor(() =>
    expect(screen.getByText('tenant_isolation')).toBeInTheDocument()
  )

  fireEvent.click(await screen.findByTestId('admin-new-policy-btn'))
  const dialog = await screen.findByRole('dialog')

  // Name still required.
  fireEvent.change(within(dialog).getByLabelText(/^name/i), {
    target: { value: 'rls_billing' },
  })

  // Operation <select> — options from RLS_OPERATIONS.
  const opSel = within(dialog).getByTestId(
    'policy-operation-select'
  ) as HTMLSelectElement
  const opValues = Array.from(opSel.options).map((o) => o.value)
  expect(opValues).toEqual(
    expect.arrayContaining(['select', 'insert', 'update', 'delete', 'all'])
  )
  fireEvent.change(opSel, { target: { value: 'select' } })

  // Table combobox — text input + resources <datalist>.
  const tableInput = within(dialog).getByTestId(
    'policy-table-input'
  ) as HTMLInputElement
  const tableListId = tableInput.getAttribute('list')
  expect(tableListId).toBeTruthy()
  expect(dialog.querySelector(`datalist#${tableListId}`)).toBeInTheDocument()
  fireEvent.change(tableInput, { target: { value: 'node' } })

  // USING predicate — free-text textarea.
  const usingArea = within(dialog).getByTestId('policy-using-textarea')
  fireEvent.change(usingArea, {
    target: { value: 'owner_id = current_user()' },
  })

  // Optional WITH CHECK predicate may or may not be present.
  const checkArea = within(dialog).queryByTestId('policy-check-textarea')
  if (checkArea) {
    fireEvent.change(checkArea, {
      target: { value: 'owner_id = current_user()' },
    })
  }

  // There must NOT be a single free-text textarea labeled exactly
  // "Expression" anymore.
  expect(within(dialog).queryByLabelText('Expression')).not.toBeInTheDocument()

  fireEvent.click(within(dialog).getByRole('button', { name: /create/i }))

  await waitFor(() => expect(mockClient.postPolicies).toHaveBeenCalled())
  const body = mockClient.postPolicies.mock.calls[0][0]
  const blob = JSON.stringify(body).toLowerCase()
  // Coherent: the operation and the USING predicate text show up
  // somewhere in the submitted body (we don't over-pin the exact
  // composition — the fixer decides the wire shape).
  expect(blob).toContain('select')
  expect(blob).toContain('owner_id = current_user()')
})
