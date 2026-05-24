/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'

jest.mock('../../api/security/rlsDenyPolicies', () => ({
  addDenyPolicy: jest.fn(),
  removeDenyPolicy: jest.fn(),
  listDenyPolicies: jest.fn(),
  getDenyPolicyCount: jest.fn(),
}))

const useCapabilitiesMock = jest.fn()
jest.mock('../../hooks/useCapabilities', () => ({
  useCapabilities: () => useCapabilitiesMock(),
}))

import {
  addDenyPolicy,
  removeDenyPolicy,
  listDenyPolicies,
  getDenyPolicyCount,
} from '../../api/security/rlsDenyPolicies'
import { RlsDenyPoliciesPage } from './RlsDenyPoliciesPage'
import { testTheme as theme } from '../../test-utils/theme'
import '../../services/i18n'

const addMock = addDenyPolicy as jest.Mock
const removeMock = removeDenyPolicy as jest.Mock
const listMock = listDenyPolicies as jest.Mock
const countMock = getDenyPolicyCount as jest.Mock

const wrap = (n: React.ReactNode): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>{n}</ThemeProvider>
    </MemoryRouter>
  )

const fullCaps = {
  adminWritable: {
    users: true,
    roles: true,
    policies: true,
    grants: true,
    attributes: true,
    rlsDenyPolicies: true,
    rlsAttributePolicies: true,
  },
  geodeVersion: '0.5.20',
  loading: false,
  loaded: true,
}

beforeEach(() => {
  listMock.mockReset()
  countMock.mockReset()
  addMock.mockReset()
  removeMock.mockReset()
  useCapabilitiesMock.mockReset()
  useCapabilitiesMock.mockReturnValue(fullCaps)
})

test('renders the policy list from listDenyPolicies', async () => {
  listMock.mockResolvedValue([
    { graph: 'g1', label: 'Person', username: 'alice' },
    { graph: 'g2', label: 'Org', username: '' },
  ])
  countMock.mockResolvedValue(2)
  wrap(<RlsDenyPoliciesPage />)
  expect(await screen.findByText('Person')).toBeInTheDocument()
  expect(screen.getByText('Org')).toBeInTheDocument()
  expect(screen.getByText('alice')).toBeInTheDocument()
  expect(screen.getByTestId('rls-deny-all-users')).toBeInTheDocument()
})

test('gates the New button on adminWritable.rlsDenyPolicies', async () => {
  useCapabilitiesMock.mockReturnValue({
    ...fullCaps,
    adminWritable: { ...fullCaps.adminWritable, rlsDenyPolicies: false },
  })
  listMock.mockResolvedValue([])
  countMock.mockResolvedValue(0)
  wrap(<RlsDenyPoliciesPage />)
  await waitFor(() =>
    expect(screen.getByTestId('admin-new-rls-deny-btn')).toBeDisabled()
  )
})

test('create flow calls addDenyPolicy with the form values', async () => {
  listMock
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ graph: 'g1', label: 'L', username: 'u' }])
  countMock.mockResolvedValue(1)
  addMock.mockResolvedValue(undefined)
  wrap(<RlsDenyPoliciesPage />)
  fireEvent.click(await screen.findByTestId('admin-new-rls-deny-btn'))
  fireEvent.change(screen.getByTestId('rls-deny-form-graph'), {
    target: { value: 'g1' },
  })
  fireEvent.change(screen.getByTestId('rls-deny-form-label'), {
    target: { value: 'L' },
  })
  fireEvent.change(screen.getByTestId('rls-deny-form-username'), {
    target: { value: 'u' },
  })
  fireEvent.click(screen.getByTestId('rls-deny-submit'))
  await waitFor(() =>
    expect(addMock).toHaveBeenCalledWith({
      graph: 'g1',
      label: 'L',
      username: 'u',
    })
  )
})

test('remove flow calls removeDenyPolicy', async () => {
  listMock.mockResolvedValue([
    { graph: 'g1', label: 'Person', username: 'alice' },
  ])
  countMock.mockResolvedValue(1)
  removeMock.mockResolvedValue(1)
  wrap(<RlsDenyPoliciesPage />)
  fireEvent.click(await screen.findByTestId('rls-deny-remove-Person'))
  const dialogs = await screen.findAllByRole('dialog')
  const confirmDialog = dialogs[dialogs.length - 1]!
  const confirmBtn = Array.from(confirmDialog.querySelectorAll('button')).find(
    (b) => /^delete$/i.test(b.textContent ?? '')
  )!
  fireEvent.click(confirmBtn)
  await waitFor(() =>
    expect(removeMock).toHaveBeenCalledWith({
      graph: 'g1',
      label: 'Person',
      username: 'alice',
    })
  )
})

test('surfaces a list error in the banner', async () => {
  listMock.mockRejectedValue(new Error('boom'))
  countMock.mockResolvedValue(0)
  wrap(<RlsDenyPoliciesPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('boom')
})
