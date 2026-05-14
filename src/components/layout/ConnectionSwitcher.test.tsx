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
