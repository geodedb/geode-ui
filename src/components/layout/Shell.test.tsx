import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from 'styled-components'

import { testTheme as theme } from '../../test-utils/theme'
import { Shell } from './Shell'

const signOut = jest.fn().mockResolvedValue(undefined)
jest.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    signOut,
    user: { username: 'alice' },
    isAuthenticated: true,
  }),
}))
jest.mock('./ConnectionPicker', () => ({
  ConnectionPicker: () => <div data-testid="connection-picker" />,
}))

const renderShell = () =>
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Shell />}>
            <Route index element={<div>main</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )

beforeEach(() => signOut.mockClear())

test('exposes a skip-link and labelled primary nav', () => {
  renderShell()
  expect(
    screen.getByRole('link', { name: /Skip to main content/ })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('navigation', { name: 'Primary' })
  ).toBeInTheDocument()
})

test('mobile toggle controls the drawer via aria-expanded', () => {
  renderShell()
  // The toggle is display:none in desktop CSS so getByRole hides it from
  // the accessibility tree; we look it up by aria-controls instead.
  const toggle = document.querySelector(
    '[aria-controls="primary-drawer"]'
  ) as HTMLElement
  expect(toggle).not.toBeNull()
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(toggle).toHaveAttribute('aria-label', 'Close menu')
})

test('logout button calls signOut', () => {
  renderShell()
  // Two logout buttons exist in the DOM (desktop + mobile drawer);
  // either firing signOut is correct, so we just take the first.
  const buttons = screen.getAllByRole('button', { name: 'Logout' })
  fireEvent.click(buttons[0]!)
  expect(signOut).toHaveBeenCalled()
})
