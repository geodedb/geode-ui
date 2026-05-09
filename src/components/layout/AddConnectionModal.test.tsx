import React from 'react'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../services/i18n/config'
import { lightTheme } from '../../theme'
import { AddConnectionModal } from './AddConnectionModal'

const mockConnectMore = jest.fn(async () => undefined)

jest.mock('../../auth/AuthProvider', () => ({
  ...jest.requireActual('../../auth/AuthProvider'),
  useAuth: () => ({
    isAuthed: true,
    setAuthed: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(),
    connectMore: mockConnectMore,
    disconnect: jest.fn(),
  }),
}))

jest.mock('../../api/auth', () => ({
  ...jest.requireActual('../../api/auth'),
  fetchPublicProfiles: jest.fn(async () => [
    { name: 'default', description: 'Default cluster' },
    { name: 'prod', description: 'Production' },
  ]),
}))

jest.mock('../../api/profiles', () => ({
  ...jest.requireActual('../../api/profiles'),
  listProfiles: jest.fn().mockResolvedValue([]),
}))

const renderModal = (open: boolean, onClose: () => void) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>
        <AddConnectionModal open={open} onClose={onClose} />
      </ThemeProvider>
    </I18nextProvider>
  )

beforeEach(() => {
  mockConnectMore.mockClear()
})

test('does not fetch or render when closed', () => {
  const { fetchPublicProfiles } = jest.requireMock('../../api/auth') as {
    fetchPublicProfiles: jest.Mock
  }
  fetchPublicProfiles.mockClear()
  renderModal(false, jest.fn())
  expect(fetchPublicProfiles).not.toHaveBeenCalled()
})

test('submits via connectMore with the typed profile/credentials', async () => {
  const onClose = jest.fn()
  renderModal(true, onClose)
  await waitFor(() => {
    expect(
      screen.getByRole('combobox', { name: /profile/i })
    ).toBeInTheDocument()
  })
  // Username + password fields.
  fireEvent.change(screen.getByLabelText(/username/i), {
    target: { value: 'alice' },
  })
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: 'pw' },
  })
  // Submit.
  await act(async () => {
    fireEvent.submit(screen.getByLabelText(/username/i).closest('form')!)
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(mockConnectMore).toHaveBeenCalledWith('alice', 'pw', 'default')
  expect(onClose).toHaveBeenCalled()
})
