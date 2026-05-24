/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'

jest.mock('../../api/security/rlsAttributePolicies', () => ({
  addAttributePolicy: jest.fn(),
  removeAttributePolicy: jest.fn(),
  listAttributePolicies: jest.fn(),
}))

const useCapabilitiesMock = jest.fn()
jest.mock('../../hooks/useCapabilities', () => ({
  useCapabilities: () => useCapabilitiesMock(),
}))

import {
  addAttributePolicy,
  removeAttributePolicy,
  listAttributePolicies,
} from '../../api/security/rlsAttributePolicies'
import { RlsAttributePoliciesPage } from './RlsAttributePoliciesPage'
import { testTheme as theme } from '../../test-utils/theme'
import '../../services/i18n'

const addMock = addAttributePolicy as jest.Mock
const removeMock = removeAttributePolicy as jest.Mock
const listMock = listAttributePolicies as jest.Mock

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
  addMock.mockReset()
  removeMock.mockReset()
  useCapabilitiesMock.mockReset()
  useCapabilitiesMock.mockReturnValue(fullCaps)
})

test('renders existing attribute policies from listAttributePolicies', async () => {
  listMock.mockResolvedValue([
    {
      graph: 'g1',
      label: 'Doc',
      rowProperty: 'dept',
      attributeKey: 'department',
    },
  ])
  wrap(<RlsAttributePoliciesPage />)
  expect(await screen.findByText('Doc')).toBeInTheDocument()
  expect(screen.getByText('dept')).toBeInTheDocument()
  expect(screen.getByText('department')).toBeInTheDocument()
})

test('live preview reflects form inputs', async () => {
  listMock.mockResolvedValue([])
  wrap(<RlsAttributePoliciesPage />)
  fireEvent.click(await screen.findByTestId('admin-new-rls-attribute-btn'))
  fireEvent.change(screen.getByTestId('rls-attr-form-row-property'), {
    target: { value: 'region' },
  })
  fireEvent.change(screen.getByTestId('rls-attr-form-attribute-key'), {
    target: { value: 'home_region' },
  })
  expect(screen.getByTestId('rls-attr-form-preview')).toHaveTextContent(
    'row.region = principal.attribute.home_region'
  )
})

test('create flow calls addAttributePolicy + adds to session list when server cannot list', async () => {
  listMock.mockResolvedValue([])
  addMock.mockResolvedValue(undefined)
  wrap(<RlsAttributePoliciesPage />)
  fireEvent.click(await screen.findByTestId('admin-new-rls-attribute-btn'))
  fireEvent.change(screen.getByTestId('rls-attr-form-graph'), {
    target: { value: 'g1' },
  })
  fireEvent.change(screen.getByTestId('rls-attr-form-label'), {
    target: { value: 'Doc' },
  })
  fireEvent.change(screen.getByTestId('rls-attr-form-row-property'), {
    target: { value: 'dept' },
  })
  fireEvent.change(screen.getByTestId('rls-attr-form-attribute-key'), {
    target: { value: 'department' },
  })
  fireEvent.click(screen.getByTestId('rls-attr-submit'))
  await waitFor(() =>
    expect(addMock).toHaveBeenCalledWith({
      graph: 'g1',
      label: 'Doc',
      rowProperty: 'dept',
      attributeKey: 'department',
    })
  )
  expect(await screen.findByText('Doc')).toBeInTheDocument()
  expect(
    await screen.findByTestId('rls-attribute-listing-unsupported')
  ).toBeInTheDocument()
})

test('gates the New button on adminWritable.rlsAttributePolicies', async () => {
  useCapabilitiesMock.mockReturnValue({
    ...fullCaps,
    adminWritable: {
      ...fullCaps.adminWritable,
      rlsAttributePolicies: false,
    },
  })
  listMock.mockResolvedValue([])
  wrap(<RlsAttributePoliciesPage />)
  await waitFor(() =>
    expect(screen.getByTestId('admin-new-rls-attribute-btn')).toBeDisabled()
  )
})

test('remove flow calls removeAttributePolicy', async () => {
  listMock.mockResolvedValue([
    {
      graph: 'g1',
      label: 'Doc',
      rowProperty: 'dept',
      attributeKey: 'department',
    },
  ])
  removeMock.mockResolvedValue(true)
  wrap(<RlsAttributePoliciesPage />)
  fireEvent.click(await screen.findByTestId('rls-attr-remove-Doc'))
  const dialogs = await screen.findAllByRole('dialog')
  const confirmDialog = dialogs[dialogs.length - 1]!
  const confirmBtn = Array.from(confirmDialog.querySelectorAll('button')).find(
    (b) => /^delete$/i.test(b.textContent ?? '')
  )!
  fireEvent.click(confirmBtn)
  await waitFor(() =>
    expect(removeMock).toHaveBeenCalledWith({
      graph: 'g1',
      label: 'Doc',
      rowProperty: 'dept',
      attributeKey: 'department',
    })
  )
})
