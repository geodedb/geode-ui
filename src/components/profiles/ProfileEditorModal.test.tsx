import React from 'react'
import { fireEvent, render, screen, act, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../services/i18n/config'
import { lightTheme } from '../../theme'
import { ProfileEditorModal } from './ProfileEditorModal'
import { ProfileView } from '../../api/profiles'

jest.mock('../../api/profiles', () => ({
  ...jest.requireActual('../../api/profiles'),
  createProfile: jest.fn(),
  updateProfile: jest.fn(),
}))

const mockCreate = jest.requireMock('../../api/profiles')
  .createProfile as jest.Mock

const renderEditor = (props: {
  open: boolean
  isAdmin: boolean
  onClose?: () => void
  onSaved?: () => void
}) => {
  const onClose = props.onClose ?? jest.fn()
  const onSaved = props.onSaved ?? jest.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>
        <ProfileEditorModal
          mode="create"
          open={props.open}
          onClose={onClose}
          onSaved={onSaved}
          isAdmin={props.isAdmin}
        />
      </ThemeProvider>
    </I18nextProvider>
  )
  return { onClose, onSaved }
}

beforeEach(() => mockCreate.mockReset())

test('create — happy path posts the typed input and calls onSaved', async () => {
  mockCreate.mockResolvedValueOnce({
    id: 'new-id',
    scope: 'personal',
    name: 'p1',
    isDefault: false,
  })
  const { onClose, onSaved } = renderEditor({ open: true, isAdmin: true })
  fireEvent.change(document.getElementById('profile-name')!, {
    target: { value: 'p1' },
  })
  fireEvent.change(document.getElementById('profile-dsn')!, {
    target: { value: 'quic://x:1' },
  })
  fireEvent.change(screen.getByLabelText('Scope'), {
    target: { value: 'personal' },
  })
  await act(async () => {
    fireEvent.submit(document.getElementById('profile-name')!.closest('form')!)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: 'personal',
      name: 'p1',
      dsn: 'quic://x:1',
    })
  )
  expect(onSaved).toHaveBeenCalled()
  expect(onClose).toHaveBeenCalled()
})

test('non-admin: scope select hides the system option', () => {
  renderEditor({ open: true, isAdmin: false })
  const scopeSelect = screen.getByLabelText('Scope') as HTMLSelectElement
  const options = Array.from(scopeSelect.options).map((o) => o.value)
  expect(options).toContain('personal')
  expect(options).not.toContain('system')
})

test('admin: scope select includes the system option', () => {
  renderEditor({ open: true, isAdmin: true })
  const scopeSelect = screen.getByLabelText('Scope') as HTMLSelectElement
  const options = Array.from(scopeSelect.options).map((o) => o.value)
  expect(options).toContain('personal')
  expect(options).toContain('system')
})

const mockUpdate = jest.requireMock('../../api/profiles')
  .updateProfile as jest.Mock

const editProfile: ProfileView = {
  id: 'p-existing',
  scope: 'personal',
  ownerUserId: 'alice',
  name: 'old',
  dsn: 'quic://old:1',
  description: 'old desc',
  isDefault: false,
  savedUsername: 'alice',
}

const renderEdit = (profile: ProfileView, onSaved: () => void) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>
        <ProfileEditorModal
          mode="edit"
          open
          onClose={jest.fn()}
          onSaved={onSaved}
          isAdmin={false}
          profile={profile}
        />
      </ThemeProvider>
    </I18nextProvider>
  )

test('edit — pre-populates fields from the supplied profile', async () => {
  renderEdit(editProfile, jest.fn())
  await waitFor(() => {
    expect(
      (document.getElementById('profile-name') as HTMLInputElement).value
    ).toBe('old')
  })
  expect(
    (document.getElementById('profile-dsn') as HTMLInputElement).value
  ).toBe('quic://old:1')
  expect(
    (document.getElementById('profile-description') as HTMLInputElement).value
  ).toBe('old desc')
})

test('edit — submit calls updateProfile with the diff only', async () => {
  mockUpdate.mockResolvedValueOnce({ ...editProfile, description: 'new desc' })
  const onSaved = jest.fn()
  renderEdit(editProfile, onSaved)
  await waitFor(() => {
    expect(
      (document.getElementById('profile-description') as HTMLInputElement).value
    ).toBe('old desc')
  })
  fireEvent.change(document.getElementById('profile-description')!, {
    target: { value: 'new desc' },
  })
  await act(async () => {
    fireEvent.submit(document.getElementById('profile-name')!.closest('form')!)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(mockUpdate).toHaveBeenCalledWith(
    'p-existing',
    expect.objectContaining({ description: 'new desc' })
  )
  // Diff-only: name + dsn + savedUsername were NOT changed → not in payload.
  const callArg = mockUpdate.mock.calls[0][1]
  expect(callArg.name).toBeUndefined()
  expect(callArg.dsn).toBeUndefined()
  expect(callArg.savedUsername).toBeUndefined()
  expect(onSaved).toHaveBeenCalled()
})

test('edit — scope select is disabled', () => {
  renderEdit(editProfile, jest.fn())
  const scopeSelect = document.getElementById(
    'profile-scope'
  ) as HTMLSelectElement
  expect(scopeSelect.disabled).toBe(true)
})
