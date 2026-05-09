import React from 'react'
import { fireEvent, render, screen, act } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../services/i18n/config'
import { lightTheme } from '../../theme'
import { ProfileEditorModal } from './ProfileEditorModal'

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
