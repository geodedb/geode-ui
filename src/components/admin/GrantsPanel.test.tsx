/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

// GrantsPanel does not list anything (no SHOW GRANTS endpoint), so the
// existing test only verifies the form scaffolding renders. The new
// tests add the Phase-1 CTA gating (Apply/Revoke disabled when
// admin_writable.grants is false) and the Phase-2 structured inputs
// (permission + resource comboboxes with <datalist>s, grantee-kind
// options sourced from RBAC_GRANTEE_KINDS).
//
// `getCapabilities` (GET /api/v1/capabilities) does not exist in the
// generated client today; mocking it keeps import-resolution clean.
jest.mock('../../api/client', () => ({
  client: {
    grants: jest.fn(),
    revoke: jest.fn(),
    getCapabilities: jest.fn(),
  },
}))

import { GrantsPanel } from './GrantsPanel'
import { client } from '../../api/client'

import { testTheme as theme } from '../../test-utils/theme'

const mockClient = client as unknown as {
  grants: jest.Mock
  revoke: jest.Mock
  getCapabilities: jest.Mock
}

const renderPanel = (): ReturnType<typeof render> =>
  render(
    <ThemeProvider theme={theme}>
      <GrantsPanel />
    </ThemeProvider>
  )

const capsWritable = (
  grants: boolean
): { geodeVersion: string; adminWritable: Record<string, boolean> } => ({
  // genapi 0.11.1: the generated client returns camelCase (converts the
  // snake_case wire response), so this mock mirrors the client's output.
  geodeVersion: 'v0.5.11-2-gcdf1b54c',
  adminWritable: { users: grants, roles: grants, policies: grants, grants },
})

beforeEach(() => {
  jest.clearAllMocks()
  mockClient.grants.mockResolvedValue({})
  mockClient.revoke.mockResolvedValue({})
  mockClient.getCapabilities.mockResolvedValue(capsWritable(true))
})

test('renders the grants form with apply and revoke buttons', async () => {
  renderPanel()

  expect(screen.getByText('Grants')).toBeInTheDocument()
  expect(screen.getByText('Apply')).toBeInTheDocument()
  expect(screen.getByText('Revoke')).toBeInTheDocument()
  // Permission, Resource, Grantee, Grantee kind labels are present.
  expect(screen.getByText('Permission')).toBeInTheDocument()
  expect(screen.getByText('Resource')).toBeInTheDocument()
  expect(screen.getByText('Grantee')).toBeInTheDocument()
  expect(screen.getByText('Grantee kind')).toBeInTheDocument()
  // QUALITY #227: GrantsPanel kicks off `getCapabilities` on mount via
  // useApiResource. Without awaiting the async resolution the
  // `dispatch({kind:'success'})` fires after the test exits, producing
  // an act() warning. Wait for the CTA to settle (enabled-by-caps).
  await waitFor(() =>
    expect(screen.getByTestId('admin-grants-apply-btn')).toBeEnabled()
  )
})

// --- Phase 1: CTA gating --------------------------------------------

test('disables Apply/Revoke when admin_writable.grants is false', async () => {
  mockClient.getCapabilities.mockResolvedValue(capsWritable(false))
  renderPanel()

  await waitFor(() => {
    const apply = screen.queryByTestId('admin-grants-apply-btn')
    const revoke = screen.queryByTestId('admin-grants-revoke-btn')
    // Either gone, or both disabled.
    if (apply) expect(apply).toBeDisabled()
    if (revoke) expect(revoke).toBeDisabled()
  })
  expect(screen.getByTestId('admin-grants-unsupported')).toBeInTheDocument()
})

test('enables Apply/Revoke when admin_writable.grants is true', async () => {
  mockClient.getCapabilities.mockResolvedValue(capsWritable(true))
  renderPanel()

  expect(await screen.findByTestId('admin-grants-apply-btn')).toBeEnabled()
  expect(await screen.findByTestId('admin-grants-revoke-btn')).toBeEnabled()
})

// --- Phase 2: structured permission/resource/grantee-kind inputs ----

test('permission and resource inputs are comboboxes backed by <datalist>s; grantee-kind has user/role options', async () => {
  mockClient.getCapabilities.mockResolvedValue(capsWritable(true))
  const { container } = renderPanel()

  const permInput = (await screen.findByTestId(
    'grant-permission-input'
  )) as HTMLInputElement
  const permListId = permInput.getAttribute('list')
  expect(permListId).toBeTruthy()
  expect(container.querySelector(`datalist#${permListId}`)).toBeInTheDocument()

  const resInput = screen.getByTestId(
    'grant-resource-input'
  ) as HTMLInputElement
  const resListId = resInput.getAttribute('list')
  expect(resListId).toBeTruthy()
  expect(container.querySelector(`datalist#${resListId}`)).toBeInTheDocument()

  const kindSel = screen.getByTestId(
    'grant-grantee-kind-select'
  ) as HTMLSelectElement
  const kindValues = Array.from(kindSel.options).map((o) => o.value)
  expect(kindValues).toEqual(expect.arrayContaining(['user', 'role']))
})
