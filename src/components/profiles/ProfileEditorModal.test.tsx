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

jest.mock('../../api/electron-bridge', () => ({
  isElectron: jest.fn().mockReturnValue(true),
  pickPemFile: jest.fn(),
}))

const mockPickPemFile = jest.requireMock('../../api/electron-bridge')
  .pickPemFile as jest.Mock

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

test('edit — isDefault is omitted when unchanged (PSR-G02-followup #124)', async () => {
  // Post-PSR-G02-followup the server's UpdateProfileReq carries
  // *bool for is_default, so a PATCH that doesn't touch the checkbox
  // must omit the key entirely (nil pointer => preserve). The previous
  // "always echo" workaround is no longer needed and would silently
  // re-write the persisted Default flag on every unrelated edit.
  mockUpdate.mockReset()
  mockUpdate.mockResolvedValueOnce({ ...editProfile, description: 'new desc' })
  // Render with isDefault: true so the form checkbox starts checked.
  // The user only edits the description and submits without toggling
  // the checkbox, so the PATCH payload must NOT include isDefault.
  renderEdit({ ...editProfile, isDefault: true }, jest.fn())
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
  })
  const callArg = mockUpdate.mock.calls[0][1]
  expect(callArg.isDefault).toBeUndefined()
  // Sanity-check the description WAS sent so we know the diff fired.
  expect(callArg.description).toBe('new desc')
})

test('edit — toggling isDefault explicitly emits the new value', async () => {
  // The other side of the contract: when the user actually changes
  // the checkbox, the PATCH must carry the new value so the server
  // can set/clear the persisted Default flag.
  mockUpdate.mockReset()
  mockUpdate.mockResolvedValueOnce({ ...editProfile, isDefault: true })
  // editProfile has isDefault: false. Render as-is; click the checkbox
  // to flip to true, then submit.
  renderEdit({ ...editProfile, isDefault: false }, jest.fn())
  await waitFor(() => {
    expect(
      (document.getElementById('profile-description') as HTMLInputElement).value
    ).toBe('old desc')
  })
  const checkbox = document.getElementById(
    'profile-isDefault'
  ) as HTMLInputElement
  fireEvent.click(checkbox)
  await act(async () => {
    fireEvent.submit(document.getElementById('profile-name')!.closest('form')!)
    await Promise.resolve()
    await Promise.resolve()
  })
  const callArg = mockUpdate.mock.calls[0][1]
  expect(callArg.isDefault).toBe(true)
})

test('create — Browse fills CA textarea with file contents (Electron)', async () => {
  mockPickPemFile.mockResolvedValueOnce('---PEM---')
  const onClose = jest.fn()
  const onSaved = jest.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>
        <ProfileEditorModal
          mode="create"
          open
          onClose={onClose}
          onSaved={onSaved}
          isAdmin
        />
      </ThemeProvider>
    </I18nextProvider>
  )
  const browseBtns = screen.getAllByRole('button', { name: /browse/i })
  expect(browseBtns.length).toBeGreaterThanOrEqual(3) // one per TLS field
  await act(async () => {
    fireEvent.click(browseBtns[0]!)
    await Promise.resolve()
    await Promise.resolve()
  })
  const caTextarea = document.getElementById(
    'profile-caPem'
  ) as HTMLTextAreaElement
  expect(caTextarea.value).toBe('---PEM---')
})

// ── Profile name uniqueness ──────────────────────────────────────────
//
// The 2026-05-17 uniqueness pass added: (a) a client-side duplicate
// gate driven by the `existingNames` prop, (b) an inline error hint
// + disabled Save button while the name collides, and (c) a server
// 409 -> friendly "name already exists" translation. The three tests
// below exercise each branch.

const renderCreateWithNames = (existingNames: string[], onClose?: () => void) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>
        <ProfileEditorModal
          mode="create"
          open
          onClose={onClose ?? jest.fn()}
          onSaved={jest.fn()}
          isAdmin
          existingNames={existingNames}
        />
      </ThemeProvider>
    </I18nextProvider>
  )

test('create — typing a duplicate name surfaces the inline error and disables Save', async () => {
  renderCreateWithNames(['Default', 'Staging'])
  fireEvent.change(document.getElementById('profile-name')!, {
    target: { value: 'default' },
  })
  // The inline error appears below the name input.
  expect(await screen.findByTestId('profile-name-error')).toHaveTextContent(
    /already exists/i
  )
  // Save button is disabled (jsdom: the button is the dialog's Save).
  const save = screen.getByRole('button', { name: /save/i })
  expect(save).toBeDisabled()
})

test('create — submitting a duplicate name short-circuits and does NOT call createProfile', async () => {
  mockCreate.mockReset()
  renderCreateWithNames(['Default'])
  fireEvent.change(document.getElementById('profile-name')!, {
    target: { value: 'Default' },
  })
  fireEvent.change(document.getElementById('profile-dsn')!, {
    target: { value: 'quic://x:1' },
  })
  await act(async () => {
    fireEvent.submit(document.getElementById('profile-name')!.closest('form')!)
    await Promise.resolve()
  })
  expect(mockCreate).not.toHaveBeenCalled()
})

test('create — server 409 conflict response surfaces the friendly i18n message', async () => {
  // Defense-in-depth: even when client gating is missing or the
  // profile list raced, a 409 from the server must produce the same
  // friendly "name already exists" alert.
  mockCreate.mockReset()
  mockCreate.mockRejectedValueOnce(
    Object.assign(new Error('http status 409: {"error":"conflict"}'), {
      status: 409,
      body: { error: 'conflict' },
    })
  )
  renderCreateWithNames([]) // empty list -> client gate doesn't trip
  fireEvent.change(document.getElementById('profile-name')!, {
    target: { value: 'p1' },
  })
  fireEvent.change(document.getElementById('profile-dsn')!, {
    target: { value: 'quic://x:1' },
  })
  await act(async () => {
    fireEvent.submit(document.getElementById('profile-name')!.closest('form')!)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  // The dialog renders multiple `role=alert` elements (inline name
  // error + footer ErrText). Both should reflect the friendly i18n
  // string; the footer one (`ErrText role="alert"`) is the one the
  // submit() catch wrote to.
  const alerts = await screen.findAllByRole('alert')
  const text = alerts.map((a) => a.textContent ?? '').join(' | ')
  expect(text).toMatch(/already exists/i)
  expect(text).not.toMatch(/http status 409/i)
})

test('edit — keeping the same name does NOT trip the duplicate gate', async () => {
  // No-rename PATCH must not collide with itself. existingNames here
  // includes the current name (the page passes the full list).
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>
        <ProfileEditorModal
          mode="edit"
          open
          onClose={jest.fn()}
          onSaved={jest.fn()}
          isAdmin
          profile={editProfile}
          existingNames={[editProfile.name, 'OtherProfile']}
        />
      </ThemeProvider>
    </I18nextProvider>
  )
  await waitFor(() => {
    expect(
      (document.getElementById('profile-name') as HTMLInputElement).value
    ).toBe(editProfile.name)
  })
  expect(screen.queryByTestId('profile-name-error')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
})

test('edit — renaming to a peer profile name DOES trip the duplicate gate', async () => {
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>
        <ProfileEditorModal
          mode="edit"
          open
          onClose={jest.fn()}
          onSaved={jest.fn()}
          isAdmin
          profile={editProfile}
          existingNames={[editProfile.name, 'OtherProfile']}
        />
      </ThemeProvider>
    </I18nextProvider>
  )
  await waitFor(() => {
    expect(
      (document.getElementById('profile-name') as HTMLInputElement).value
    ).toBe(editProfile.name)
  })
  fireEvent.change(document.getElementById('profile-name')!, {
    target: { value: 'OtherProfile' },
  })
  expect(await screen.findByTestId('profile-name-error')).toHaveTextContent(
    /already exists/i
  )
  expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
})
