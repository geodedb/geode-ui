/// <reference types="@testing-library/jest-dom" />
import React, { useEffect } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../services/i18n/config'
import { testTheme as lightTheme } from '../../test-utils/theme'
import {
  ConnectionsProvider,
  useConnections,
  getLatestToken,
  setLatestToken,
} from '../../api/connections'
import { AuthProvider } from '../../auth/AuthProvider'
import { ConnectionSwitcher } from './ConnectionSwitcher'

// Mock the public-profiles fetch the ConnectionSwitcher fans out to
// via usePublicProfilesWithStoredPasswords. Tests that only care
// about the active-connections shape leave this returning an empty
// list; the "configured profiles" tests below override per-test.
jest.mock('../../api/auth', () => ({
  ...jest.requireActual('../../api/auth'),
  fetchPublicProfiles: jest.fn(async () => []),
}))

const Seed: React.FC<{ count: number }> = ({ count }) => {
  const { add, setActive } = useConnections()
  useEffect(() => {
    for (let i = 0; i < count; i += 1) {
      add({
        connectionId: `c${i}`,
        token: `tok${i}`,
        profileName: `prof${i}`,
        expiresAt: Date.now() + 3_600_000,
      })
    }
    if (count > 0) {
      setActive('c0')
      setLatestToken('tok0')
    }
  }, []) // deps intentionally omitted — seed runs once on mount
  return null
}

const renderWithProviders = (ui: React.ReactElement) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>
        <ConnectionsProvider>
          <AuthProvider>{ui}</AuthProvider>
        </ConnectionsProvider>
      </ThemeProvider>
    </I18nextProvider>
  )

// Simulate the user picking an item in the <wa-dropdown>. The
// dropdown's internal click handler lives in its shadow DOM and is
// not reliably triggered by fireEvent.click(slottedItem) in jsdom
// (the shadow root's `<div id="menu"> @click=…` binding doesn't
// always activate because jsdom's web component slot retargeting
// behaviour is incomplete). Dispatching the `wa-select` CustomEvent
// directly on the wa-dropdown element is the supported integration
// surface — it's exactly what WaDropdown.makeSelection() does in
// production code (see chunk.SYGTJ7EA.js makeSelection()).
const selectDropdownItem = (item: HTMLElement) => {
  const dropdown = item.closest('wa-dropdown') as HTMLElement | null
  if (!dropdown) {
    throw new Error('selectDropdownItem: item is not inside a wa-dropdown')
  }
  // The wa-select listener is attached by @lit/react via
  // useLayoutEffect. Wrap the dispatch in `act` so React flushes any
  // state updates the handler triggers (switchActive → provider state
  // → re-render) before the surrounding test makes assertions.
  act(() => {
    dropdown.dispatchEvent(
      new CustomEvent('wa-select', { detail: { item }, bubbles: true })
    )
  })
}

test('shows all active connections; clicking a row switches active', () => {
  renderWithProviders(
    <>
      <Seed count={2} />
      <ConnectionSwitcher onAddRequested={() => undefined} />
    </>
  )
  // The trigger button shows the active profile name.
  expect(screen.getByTestId('connection-trigger')).toHaveTextContent('prof0')
  // Both rows are rendered as wa-dropdown-item children.
  const row0 = screen.getByTestId('connection-row-c0')
  const row1 = screen.getByTestId('connection-row-c1')
  expect(row0).toBeInTheDocument()
  expect(row1).toBeInTheDocument()

  // Selecting prof1 switches the active connection. The trigger
  // label reflects the new active profile on re-render.
  selectDropdownItem(row1)
  expect(screen.getByTestId('connection-trigger')).toHaveTextContent('prof1')
})

test('clicking a row updates the latch to the new active token', () => {
  renderWithProviders(
    <>
      <Seed count={2} />
      <ConnectionSwitcher onAddRequested={() => undefined} />
    </>
  )
  // After Seed, active is c0 → latch holds tok0.
  expect(getLatestToken()).toBe('tok0')
  selectDropdownItem(screen.getByTestId('connection-row-c1'))
  expect(getLatestToken()).toBe('tok1')
})

test('clicking × on a row disconnects without switching active', () => {
  renderWithProviders(
    <>
      <Seed count={2} />
      <ConnectionSwitcher onAddRequested={() => undefined} />
    </>
  )
  // Active is c0; disconnecting c1 should remove it from the
  // dropdown but leave c0 active (the trigger keeps showing prof0).
  fireEvent.click(screen.getByTestId('connection-disconnect-c1'))
  expect(screen.queryByTestId('connection-row-c1')).toBeNull()
  expect(screen.getByTestId('connection-trigger')).toHaveTextContent('prof0')
})

test('selecting the add-connection item invokes onAddRequested', () => {
  const onAddRequested = jest.fn()
  renderWithProviders(
    <>
      <Seed count={1} />
      <ConnectionSwitcher onAddRequested={onAddRequested} />
    </>
  )
  selectDropdownItem(screen.getByTestId('connection-add'))
  expect(onAddRequested).toHaveBeenCalledTimes(1)
})

test('renders an empty state when there are no active connections', () => {
  renderWithProviders(<ConnectionSwitcher onAddRequested={() => undefined} />)
  // The "No active connection" trigger button is the empty state. Use
  // a partial regex on the i18n value (en: "No active connection").
  expect(screen.getByText(/no active connection/i)).toBeInTheDocument()
})

// 2026-05-22 bug report: dropdown only shows the active profile +
// "Add another connection" — the operator can't see, let alone
// switch into, configured-but-not-yet-connected profiles. The
// switcher should list EVERY configured profile (active or not) so
// switching connection is a one-click affordance and the operator
// doesn't have to discover "Add another connection" → "pick from a
// hidden dropdown inside a modal".
describe('lists configured (public) profiles, not just active connections', () => {
  // Two configured profiles in the fixture — only one of which is
  // currently active per Seed. The other must show up as an
  // inactive, click-to-connect row in the dropdown.
  beforeEach(() => {
    const mod = jest.requireMock('../../api/auth') as {
      fetchPublicProfiles: jest.Mock
    }
    mod.fetchPublicProfiles.mockResolvedValue([
      { name: 'prof0', description: 'p0' },
      { name: 'unused-profile', description: 'configured but not connected' },
    ])
  })

  // findByTestId is the recommended async-aware locator for content
  // that arrives via a useEffect-driven fetch.
  test('renders one dropdown row per configured profile, even when not yet connected', async () => {
    renderWithProviders(
      <>
        <Seed count={1} />
        <ConnectionSwitcher onAddRequested={() => undefined} />
      </>
    )
    // Active connection row (prof0) — already covered by existing
    // tests above.
    expect(await screen.findByTestId('connection-row-c0')).toBeInTheDocument()
    // The configured-but-not-connected profile must surface as a row
    // the operator can click to start a connect flow. Test-id is
    // keyed on the profile name (not connection id, because there is
    // no connection id yet — that's the whole point).
    expect(
      await screen.findByTestId('connection-row-profile-unused-profile')
    ).toBeInTheDocument()
  })

  test('clicking an inactive configured profile fires onAddRequested with the profile name', async () => {
    const onAddRequested = jest.fn()
    renderWithProviders(
      <>
        <Seed count={1} />
        <ConnectionSwitcher onAddRequested={onAddRequested} />
      </>
    )
    const row = await screen.findByTestId(
      'connection-row-profile-unused-profile'
    )
    selectDropdownItem(row)
    // The Shell wires onAddRequested into AddConnectionModal's
    // `initialProfile` prop so the modal opens pre-selected to the
    // profile the operator picked. The arg must be the profile name.
    expect(onAddRequested).toHaveBeenCalledWith('unused-profile')
  })

  test('inactive configured profile rows DO NOT render the disconnect × affordance', async () => {
    renderWithProviders(
      <>
        <Seed count={1} />
        <ConnectionSwitcher onAddRequested={() => undefined} />
      </>
    )
    await screen.findByTestId('connection-row-profile-unused-profile')
    // The × button only makes sense on active connections — there's
    // nothing to disconnect from an inactive profile. The test-id for
    // disconnect on a not-yet-connected profile must not exist.
    expect(
      screen.queryByTestId('connection-disconnect-profile-unused-profile')
    ).toBeNull()
  })

  test('configured profiles that ARE active dedupe to a single row keyed by connection id', async () => {
    // The active profile (prof0 via Seed) is also in the public
    // profiles fixture; the dropdown must NOT render two rows for it
    // (one keyed by connection id, one by profile name). The
    // connection-id row wins because it carries the disconnect
    // affordance + the role=menuitemradio active state.
    renderWithProviders(
      <>
        <Seed count={1} />
        <ConnectionSwitcher onAddRequested={() => undefined} />
      </>
    )
    expect(await screen.findByTestId('connection-row-c0')).toBeInTheDocument()
    // Wait for the public-profiles fetch to resolve so any
    // double-render path would have already fired the duplicate row.
    await screen.findByTestId('connection-row-profile-unused-profile')
    expect(screen.queryByTestId('connection-row-profile-prof0')).toBeNull()
  })
})
