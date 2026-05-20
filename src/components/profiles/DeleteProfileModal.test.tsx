import React from 'react'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../services/i18n/config'
import { lightTheme } from '@geodedb/ui-core/theme'
import { DeleteProfileModal } from './DeleteProfileModal'
import type { ProfileView } from '../../api/profiles'

jest.mock('../../api/profiles', () => ({
  ...jest.requireActual('../../api/profiles'),
  deleteProfile: jest.fn(),
}))

const mockDelete = jest.requireMock('../../api/profiles')
  .deleteProfile as jest.Mock

const target: ProfileView = {
  id: 'p-existing',
  scope: 'personal',
  ownerUserId: 'alice',
  name: 'my-dev',
  isDefault: false,
}

const renderModal = (
  open: boolean,
  onClose: () => void,
  onDeleted: () => void
) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>
        <DeleteProfileModal
          open={open}
          onClose={onClose}
          onDeleted={onDeleted}
          profile={target}
        />
      </ThemeProvider>
    </I18nextProvider>
  )

beforeEach(() => mockDelete.mockReset())

test('confirm — calls deleteProfile and onDeleted', async () => {
  mockDelete.mockResolvedValueOnce(undefined)
  const onClose = jest.fn()
  const onDeleted = jest.fn()
  renderModal(true, onClose, onDeleted)
  // The target profile name appears in the confirm body.
  await waitFor(() => expect(screen.getByText(/my-dev/)).toBeInTheDocument())
  // Click the destructive Delete button (NOT the cancel button). The
  // ConfirmModal renders the destructive action with role=button and the
  // `name` matches the confirmLabel, so the only Delete-named button in
  // the dialog is the destructive one.
  const deleteBtns = screen.getAllByRole('button', { name: /^delete$/i })
  const deleteBtn = deleteBtns[0]
  if (!deleteBtn) throw new Error('expected at least one Delete button')
  await act(async () => {
    fireEvent.click(deleteBtn)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(mockDelete).toHaveBeenCalledWith('p-existing')
  expect(onDeleted).toHaveBeenCalled()
  expect(onClose).toHaveBeenCalled()
})

test('cancel — closes without calling deleteProfile', () => {
  const onClose = jest.fn()
  renderModal(true, onClose, jest.fn())
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
  expect(mockDelete).not.toHaveBeenCalled()
  expect(onClose).toHaveBeenCalled()
})

// ---------------------------------------------------------------------------
// PSR-G05 (#82) — surface delete failures so the user can retry. Pre-fix
// `onConfirm` swallowed the rejection in a try/finally with no catch
// branch; the modal closed (or didn't, depending on timing) with no
// indication that the deletion had actually failed and the row would
// reappear after the next refresh.
// ---------------------------------------------------------------------------

test('PSR-G05: failed delete renders an inline error and the modal stays open', async () => {
  mockDelete.mockRejectedValueOnce(new Error('403 forbidden'))
  const onClose = jest.fn()
  const onDeleted = jest.fn()
  renderModal(true, onClose, onDeleted)
  await waitFor(() => expect(screen.getByText(/my-dev/)).toBeInTheDocument())
  const deleteBtns = screen.getAllByRole('button', { name: /^delete$/i })
  const deleteBtn = deleteBtns[0]
  if (!deleteBtn) throw new Error('expected at least one Delete button')
  await act(async () => {
    fireEvent.click(deleteBtn)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  // Error is announced for assistive tech AND visible.
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/403 forbidden/i)
  // Modal must NOT close and onDeleted must NOT fire so the user can retry.
  expect(onClose).not.toHaveBeenCalled()
  expect(onDeleted).not.toHaveBeenCalled()
})
