/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

jest.mock('../../api/security/userAttributes', () => ({
  listUserAttributes: jest.fn(),
  setUserAttribute: jest.fn(),
  removeUserAttribute: jest.fn(),
}))

import {
  listUserAttributes,
  setUserAttribute,
  removeUserAttribute,
} from '../../api/security/userAttributes'
import { UserAttributesModal } from './UserAttributesModal'
import { testTheme as theme } from '../../test-utils/theme'
import '../../services/i18n'

const listMock = listUserAttributes as jest.Mock
const setMock = setUserAttribute as jest.Mock
const removeMock = removeUserAttribute as jest.Mock

const wrap = (node: React.ReactNode): ReturnType<typeof render> =>
  render(<ThemeProvider theme={theme}>{node}</ThemeProvider>)

beforeEach(() => {
  listMock.mockReset()
  setMock.mockReset()
  removeMock.mockReset()
})

test('lists existing attributes for the user on open', async () => {
  listMock.mockResolvedValue([
    { key: 'department', value: 'engineering' },
    { key: 'level', value: 'L3' },
  ])
  wrap(<UserAttributesModal username="alice" onClose={() => {}} />)
  expect(await screen.findByText('department')).toBeInTheDocument()
  expect(screen.getByText('engineering')).toBeInTheDocument()
  expect(screen.getByText('level')).toBeInTheDocument()
  expect(screen.getByText('L3')).toBeInTheDocument()
})

test('add flow calls setUserAttribute then mirrors the new row', async () => {
  listMock.mockResolvedValue([])
  setMock.mockResolvedValue(undefined)
  wrap(<UserAttributesModal username="alice" onClose={() => {}} />)
  fireEvent.click(await screen.findByTestId('user-attributes-add-btn'))
  fireEvent.change(screen.getByTestId('user-attr-new-key'), {
    target: { value: 'region' },
  })
  fireEvent.change(screen.getByTestId('user-attr-new-value'), {
    target: { value: 'us-east' },
  })
  fireEvent.click(screen.getByTestId('user-attr-submit-btn'))
  await waitFor(() =>
    expect(setMock).toHaveBeenCalledWith('alice', 'region', 'us-east')
  )
  expect(await screen.findByText('region')).toBeInTheDocument()
  expect(screen.getByText('us-east')).toBeInTheDocument()
})

test('add validates attribute key format client-side', async () => {
  listMock.mockResolvedValue([])
  wrap(<UserAttributesModal username="alice" onClose={() => {}} />)
  fireEvent.click(await screen.findByTestId('user-attributes-add-btn'))
  fireEvent.change(screen.getByTestId('user-attr-new-key'), {
    target: { value: '1invalid' },
  })
  fireEvent.change(screen.getByTestId('user-attr-new-value'), {
    target: { value: 'x' },
  })
  fireEvent.click(screen.getByTestId('user-attr-submit-btn'))
  expect(
    await screen.findByText(/keys must start with a letter/i)
  ).toBeInTheDocument()
  expect(setMock).not.toHaveBeenCalled()
})

test('remove flow confirms then calls removeUserAttribute', async () => {
  listMock.mockResolvedValue([{ key: 'department', value: 'eng' }])
  removeMock.mockResolvedValue(undefined)
  wrap(<UserAttributesModal username="alice" onClose={() => {}} />)
  fireEvent.click(await screen.findByTestId('user-attr-remove-department'))
  const dialogs = await screen.findAllByRole('dialog')
  const confirmDialog = dialogs[dialogs.length - 1]!
  const confirmBtn = Array.from(confirmDialog.querySelectorAll('button')).find(
    (b) => /^delete$/i.test(b.textContent ?? '')
  )!
  fireEvent.click(confirmBtn)
  await waitFor(() =>
    expect(removeMock).toHaveBeenCalledWith('alice', 'department')
  )
})

test('shows unsupportedTooltip in form when setUserAttribute rejects with 501', async () => {
  listMock.mockResolvedValue([])
  setMock.mockRejectedValue(
    Object.assign(new Error('wire_feature_missing'), { status: 501 })
  )
  wrap(<UserAttributesModal username="alice" onClose={() => {}} />)
  fireEvent.click(await screen.findByTestId('user-attributes-add-btn'))
  fireEvent.change(screen.getByTestId('user-attr-new-key'), {
    target: { value: 'k' },
  })
  fireEvent.change(screen.getByTestId('user-attr-new-value'), {
    target: { value: 'v' },
  })
  fireEvent.click(screen.getByTestId('user-attr-submit-btn'))
  expect(
    await screen.findByText(
      /does not implement geode\.auth\.user_set_attribute/i
    )
  ).toBeInTheDocument()
})

test('empty state shows the noneYet message', async () => {
  listMock.mockResolvedValue([])
  wrap(<UserAttributesModal username="alice" onClose={() => {}} />)
  expect(await screen.findByTestId('user-attributes-empty')).toBeInTheDocument()
})
