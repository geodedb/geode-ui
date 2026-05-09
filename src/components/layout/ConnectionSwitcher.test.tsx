/// <reference types="@testing-library/jest-dom" />
import React, { useEffect } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
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

test('shows all active connections; clicking a row switches active', () => {
  renderWithProviders(
    <>
      <Seed count={2} />
      <ConnectionSwitcher onAddRequested={() => undefined} />
    </>
  )
  // Open the dropdown — trigger button with the active profile name.
  const trigger = screen.getByRole('button', { name: /prof0/i })
  fireEvent.click(trigger)
  // Both rows visible.
  expect(
    screen.getByRole('menuitemradio', { name: /prof0/i })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('menuitemradio', { name: /prof1/i })
  ).toBeInTheDocument()

  // Click prof1 → setActive c1.
  fireEvent.click(screen.getByRole('menuitemradio', { name: /prof1/i }))
  // After the switch, the trigger label reflects the new active profile.
  expect(screen.getByRole('button', { name: /prof1/ })).toBeInTheDocument()
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
  fireEvent.click(screen.getByRole('button', { name: /prof0/i }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: /prof1/i }))
  expect(getLatestToken()).toBe('tok1')
})

test('renders an empty state when there are no active connections', () => {
  renderWithProviders(<ConnectionSwitcher onAddRequested={() => undefined} />)
  // The "No active connection" trigger button is the empty state. Use
  // a partial regex on the i18n value (en: "No active connection").
  expect(screen.getByText(/no active connection/i)).toBeInTheDocument()
})
