import React from 'react'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../services/i18n/config'
import { lightTheme } from '@geodedb/ui-core/theme'
import { AddConnectionModal } from './AddConnectionModal'

// connectMore now returns the new connection's connectionId so the
// modal can call switchActive on the freshly-minted connection. Older
// tests that don't care about the return value still work because the
// id they get back is never asserted there.
const mockConnectMore = jest.fn(async () => 'conn-1')
const mockSwitchActive = jest.fn()

jest.mock('../../auth/AuthProvider', () => ({
  ...jest.requireActual('../../auth/AuthProvider'),
  useAuth: () => ({
    isAuthed: true,
    setAuthed: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(),
    connectMore: mockConnectMore,
    disconnect: jest.fn(),
    switchActive: mockSwitchActive,
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

jest.mock('../../api/electron-bridge', () => ({
  ...jest.requireActual('../../api/electron-bridge'),
  isElectron: jest.fn().mockReturnValue(true),
  getStoredPassword: jest.fn().mockResolvedValue(null),
}))

const renderModal = (
  open: boolean,
  onClose: () => void,
  props: { initialProfile?: string } = {}
) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>
        <AddConnectionModal
          open={open}
          onClose={onClose}
          initialProfile={props.initialProfile}
        />
      </ThemeProvider>
    </I18nextProvider>
  )

beforeEach(() => {
  mockConnectMore.mockClear()
  mockConnectMore.mockResolvedValue('conn-1')
  mockSwitchActive.mockClear()
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
      screen.getByRole('combobox', { name: /connection/i })
    ).toBeInTheDocument()
  })
  // Username + password fields. The "Use saved password" toggle (F14)
  // also matches /password/i, so target the password text field by its
  // type to disambiguate.
  fireEvent.change(screen.getByLabelText(/username/i), {
    target: { value: 'alice' },
  })
  fireEvent.change(
    screen.getByLabelText(/password/i, { selector: 'input[type="password"]' }),
    {
      target: { value: 'pw' },
    }
  )
  // Submit.
  await act(async () => {
    fireEvent.submit(screen.getByLabelText(/username/i).closest('form')!)
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(mockConnectMore).toHaveBeenCalledWith('alice', 'pw', 'default', false)
  expect(onClose).toHaveBeenCalled()
})

// ---------------------------------------------------------------------------
// PSR-F13 (#110) — collapse 4 modal-open useEffects.
// PSR-F14 (#111) — debounce + gate getStoredPassword behind explicit
// "Use saved password" toggle.
//
// Pre-fix the modal fired 4 separate effects on mount:
//   1. fetchPublicProfiles
//   2. listProfiles
//   3. saved-username sync (cheap, but extra render)
//   4. getStoredPassword (per-username keystroke → IPC + safeStorage
//      decrypt per character)
//
// Post-fix:
//   - effects 1+2 batch into a single Promise.all
//   - effect 4 is gated behind a checkbox AND debounced 300ms
//   - the renderer maintains a (username -> password) cache cleared on
//     onClose so re-typing the same username doesn't re-fire IPC
// ---------------------------------------------------------------------------

test('PSR-F13: opening the modal batches fetchPublicProfiles + listProfiles into one render cycle', async () => {
  const { fetchPublicProfiles } = jest.requireMock('../../api/auth') as {
    fetchPublicProfiles: jest.Mock
  }
  const { listProfiles } = jest.requireMock('../../api/profiles') as {
    listProfiles: jest.Mock
  }
  fetchPublicProfiles.mockClear()
  listProfiles.mockClear()
  renderModal(true, jest.fn())
  await waitFor(() => {
    expect(
      screen.getByRole('combobox', { name: /connection/i })
    ).toBeInTheDocument()
  })
  // Each mock should have been called exactly once on open.
  expect(fetchPublicProfiles).toHaveBeenCalledTimes(1)
  expect(listProfiles).toHaveBeenCalledTimes(1)
})

test('PSR-F13/F14: opening the modal does NOT auto-fire getStoredPassword', async () => {
  jest.useFakeTimers()
  try {
    const { getStoredPassword } = jest.requireMock(
      '../../api/electron-bridge'
    ) as { getStoredPassword: jest.Mock }
    getStoredPassword.mockClear()
    renderModal(true, jest.fn())
    await act(async () => {
      jest.advanceTimersByTime(1000)
      await Promise.resolve()
    })
    // Type into username — pre-fix this would fire IPC per keystroke.
    // Post-fix: with the toggle OFF, no IPC at all.
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'a' },
    })
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'al' },
    })
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'ali' },
    })
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'alic' },
    })
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'alice' },
    })
    await act(async () => {
      jest.advanceTimersByTime(1000)
      await Promise.resolve()
    })
    expect(getStoredPassword).not.toHaveBeenCalled()
  } finally {
    jest.useRealTimers()
  }
})

test('PSR-F14: with toggle ON, getStoredPassword fires once after debounce window elapses', async () => {
  jest.useFakeTimers()
  try {
    const { getStoredPassword } = jest.requireMock(
      '../../api/electron-bridge'
    ) as { getStoredPassword: jest.Mock }
    getStoredPassword.mockClear()
    getStoredPassword.mockResolvedValue('decrypted-pw')
    renderModal(true, jest.fn())
    await act(async () => {
      jest.advanceTimersByTime(50)
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(
        screen.getByRole('combobox', { name: /connection/i })
      ).toBeInTheDocument()
    })
    // Flip the toggle ON.
    const toggle = screen.getByLabelText(/use saved password/i)
    fireEvent.click(toggle)
    // Type the username in 5 keystrokes within the debounce window.
    const keystrokes = ['u', 'us', 'use', 'user', 'users']
    keystrokes.forEach((v) => {
      fireEvent.change(screen.getByLabelText(/username/i), {
        target: { value: v },
      })
    })
    // Inside the window: no IPC yet.
    expect(getStoredPassword).not.toHaveBeenCalled()
    await act(async () => {
      jest.advanceTimersByTime(310)
      await Promise.resolve()
      await Promise.resolve()
    })
    // After the 300ms idle window: exactly one IPC call.
    expect(getStoredPassword).toHaveBeenCalledTimes(1)
    expect(getStoredPassword).toHaveBeenCalledWith('default', 'users')
  } finally {
    jest.useRealTimers()
  }
})

test('PSR-F14: re-typing the same (profile, username) tuple is a cache hit (no extra IPC)', async () => {
  jest.useFakeTimers()
  try {
    const { getStoredPassword } = jest.requireMock(
      '../../api/electron-bridge'
    ) as { getStoredPassword: jest.Mock }
    getStoredPassword.mockClear()
    getStoredPassword.mockResolvedValue('cached-pw')
    renderModal(true, jest.fn())
    await act(async () => {
      jest.advanceTimersByTime(50)
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByLabelText(/use saved password/i)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText(/use saved password/i))
    // First entry: username "alice" → 1 IPC after debounce.
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'alice' },
    })
    await act(async () => {
      jest.advanceTimersByTime(310)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(getStoredPassword).toHaveBeenCalledTimes(1)
    // Clear and retype the same value — should hit the cache, not IPC.
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'bob' },
    })
    await act(async () => {
      jest.advanceTimersByTime(310)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(getStoredPassword).toHaveBeenCalledTimes(2)
    // Now switch back to "alice" — cache hit, no third IPC.
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'alice' },
    })
    await act(async () => {
      jest.advanceTimersByTime(310)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(getStoredPassword).toHaveBeenCalledTimes(2)
  } finally {
    jest.useRealTimers()
  }
})

// ---------------------------------------------------------------------------
// PSR-G04 (#81) + PSR-G10 (#87) — surface listProfiles + fetchPublicProfiles
// errors instead of swallowing them. Pre-fix the modal opened looking
// healthy with no profile dropdown / no saved-username fill and no
// indication that anything had failed; users couldn't tell whether the
// network was down or whether they simply had no saved profiles.
// ---------------------------------------------------------------------------

test('PSR-G04: submit failure renders an inline error message', async () => {
  mockConnectMore.mockRejectedValueOnce(new Error('upstream auth refused'))
  const onClose = jest.fn()
  renderModal(true, onClose)
  await waitFor(() => {
    expect(
      screen.getByRole('combobox', { name: /connection/i })
    ).toBeInTheDocument()
  })
  fireEvent.change(screen.getByLabelText(/username/i), {
    target: { value: 'alice' },
  })
  fireEvent.change(
    screen.getByLabelText(/password/i, { selector: 'input[type="password"]' }),
    { target: { value: 'pw' } }
  )
  await act(async () => {
    fireEvent.submit(screen.getByLabelText(/username/i).closest('form')!)
    await Promise.resolve()
    await Promise.resolve()
  })
  // Error must be visible to screen readers AND on-screen.
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/upstream auth refused/i)
  // Modal must NOT auto-close on a failed submit so the user can retry.
  expect(onClose).not.toHaveBeenCalled()
})

test('PSR-G04/G10: listProfiles failure renders fallback warning and form stays usable', async () => {
  const { listProfiles } = jest.requireMock('../../api/profiles') as {
    listProfiles: jest.Mock
  }
  listProfiles.mockRejectedValueOnce(new Error('500 internal'))
  renderModal(true, jest.fn())
  // The public-profile select should still render (it is independent
  // of listProfiles), and the warning banner should appear.
  await waitFor(() => {
    expect(
      screen.getByTestId('add-connection-authed-profile-warning')
    ).toBeInTheDocument()
  })
  // Form remains usable: typing into the username field still works.
  fireEvent.change(screen.getByLabelText(/username/i), {
    target: { value: 'still-typing' },
  })
  expect(screen.getByLabelText(/username/i)).toHaveValue('still-typing')
})

test('PSR-G04: fetchPublicProfiles failure renders fallback warning and switches to free-form input', async () => {
  const { fetchPublicProfiles } = jest.requireMock('../../api/auth') as {
    fetchPublicProfiles: jest.Mock
  }
  fetchPublicProfiles.mockRejectedValueOnce(new Error('network down'))
  renderModal(true, jest.fn())
  await waitFor(() => {
    expect(
      screen.getByTestId('add-connection-public-profile-warning')
    ).toBeInTheDocument()
  })
  // No <select role="combobox"> when the public list failed — it falls
  // through to the free-form Input branch.
  expect(
    screen.queryByRole('combobox', { name: /connection/i })
  ).not.toBeInTheDocument()
  // Reset the rejection so subsequent tests get the default mock.
  fetchPublicProfiles.mockResolvedValue([
    { name: 'default', description: 'Default cluster' },
    { name: 'prod', description: 'Production' },
  ])
})

test('PSR-F14: closing the modal clears the password cache (no leak across opens)', async () => {
  jest.useFakeTimers()
  try {
    const { getStoredPassword } = jest.requireMock(
      '../../api/electron-bridge'
    ) as { getStoredPassword: jest.Mock }
    getStoredPassword.mockClear()
    getStoredPassword.mockResolvedValue('first-pw')
    const onClose = jest.fn()
    const { rerender } = renderModal(true, onClose)
    await act(async () => {
      jest.advanceTimersByTime(50)
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByLabelText(/use saved password/i)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText(/use saved password/i))
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'cached' },
    })
    await act(async () => {
      jest.advanceTimersByTime(310)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(getStoredPassword).toHaveBeenCalledTimes(1)
    // Close (open=false) then re-open. The cache should be empty so
    // typing the same username triggers a fresh IPC.
    rerender(
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={lightTheme}>
          <AddConnectionModal open={false} onClose={onClose} />
        </ThemeProvider>
      </I18nextProvider>
    )
    rerender(
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={lightTheme}>
          <AddConnectionModal open onClose={onClose} />
        </ThemeProvider>
      </I18nextProvider>
    )
    await act(async () => {
      jest.advanceTimersByTime(50)
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByLabelText(/use saved password/i)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText(/use saved password/i))
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'cached' },
    })
    await act(async () => {
      jest.advanceTimersByTime(310)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(getStoredPassword).toHaveBeenCalledTimes(2)
  } finally {
    jest.useRealTimers()
  }
})

// 2026-05-22 bug report — when the ConnectionSwitcher dropdown opens
// the modal with a specific profile pre-selected (operator clicked an
// inactive profile chip), the profile picker was falling back to the
// public-profiles default ("default") because the public-profiles
// fetch resolved AFTER the prop-applied setState and overrode it. The
// fix: when initialProfile is set, the public-profiles default
// discovery must NOT touch the profile state.
describe('initialProfile precedence over public-profiles default', () => {
  test('the picker stays on the supplied initialProfile after the public-profiles fetch resolves', async () => {
    renderModal(true, jest.fn(), { initialProfile: 'prod' })
    // Wait for the public-profiles fetch to settle so the racing effect
    // would have had a chance to overwrite the prop.
    await waitFor(() => {
      expect(
        screen.getByRole('combobox', { name: /connection/i })
      ).toBeInTheDocument()
    })
    // The pre-selected profile must STILL be 'prod' — pre-fix the
    // public-profiles' first entry ('default') won the race.
    const select = screen.getByRole('combobox', {
      name: /connection/i,
    }) as HTMLSelectElement
    expect(select.value).toBe('prod')
  })

  test('clicking submit with a pre-selected initialProfile forwards that profile name to connectMore', async () => {
    renderModal(true, jest.fn(), { initialProfile: 'prod' })
    await waitFor(() => {
      expect(
        screen.getByRole('combobox', { name: /connection/i })
      ).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'alice' },
    })
    fireEvent.change(
      screen.getByLabelText(/password/i, {
        selector: 'input[type="password"]',
      }),
      { target: { value: 'pw' } }
    )
    await act(async () => {
      fireEvent.submit(screen.getByLabelText(/username/i).closest('form')!)
      await Promise.resolve()
      await Promise.resolve()
    })
    // connectMore must see 'prod' — not the public-profiles default
    // 'default'.
    expect(mockConnectMore).toHaveBeenCalledWith('alice', 'pw', 'prod', false)
  })
})

// 2026-05-22 bug report — the operator clicked an inactive profile in
// the ConnectionSwitcher dropdown, authenticated, and expected the UI
// to switch to that profile. The pre-fix connectMore path adds the
// connection but deliberately does NOT call setActive (by design —
// "+ Add another connection" is fire-and-forget add). When the modal
// opens with `initialProfile` set, however, the operator picked a
// SPECIFIC profile to use; the intent is switching, not just adding.
describe('post-connect switchActive when modal opened with initialProfile', () => {
  test('calls switchActive with the freshly-minted connectionId after a successful connectMore', async () => {
    mockConnectMore.mockResolvedValueOnce('new-conn-id')
    const onClose = jest.fn()
    renderModal(true, onClose, { initialProfile: 'prod' })
    await waitFor(() => {
      expect(
        screen.getByRole('combobox', { name: /connection/i })
      ).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'alice' },
    })
    fireEvent.change(
      screen.getByLabelText(/password/i, {
        selector: 'input[type="password"]',
      }),
      { target: { value: 'pw' } }
    )
    await act(async () => {
      fireEvent.submit(screen.getByLabelText(/username/i).closest('form')!)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockSwitchActive).toHaveBeenCalledWith('new-conn-id')
  })

  test('does NOT call switchActive when modal opened without initialProfile (chrome "+ Add another connection" flow)', async () => {
    // Same as the default flow — operator picked "+ Add another
    // connection" from the chrome dropdown. No specific profile
    // requested → add without switching (preserves the existing
    // multi-connection workflow where the user explicitly switches
    // afterwards if they want to).
    const onClose = jest.fn()
    renderModal(true, onClose, { initialProfile: undefined })
    await waitFor(() => {
      expect(
        screen.getByRole('combobox', { name: /connection/i })
      ).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'alice' },
    })
    fireEvent.change(
      screen.getByLabelText(/password/i, {
        selector: 'input[type="password"]',
      }),
      { target: { value: 'pw' } }
    )
    await act(async () => {
      fireEvent.submit(screen.getByLabelText(/username/i).closest('form')!)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockSwitchActive).not.toHaveBeenCalled()
  })
})
