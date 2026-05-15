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
jest.mock('./ConnectionSwitcher', () => ({
  ConnectionSwitcher: () => <div data-testid="connection-switcher" />,
}))
jest.mock('./AddConnectionModal', () => ({
  AddConnectionModal: ({ open }: { open: boolean }) => {
    return open ? <div data-testid="add-modal" /> : null
  },
}))

const renderShell = (initialPath = '/') =>
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/" element={<Shell />}>
            <Route index element={<div>main</div>} />
            <Route path="schema" element={<div>schema</div>} />
            <Route path="admin/*" element={<div>admin</div>} />
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

test('marks the current view in the nav via aria-current', () => {
  // Two copies of each nav link exist (desktop bar + mobile drawer);
  // both should carry aria-current="page" for the active route and
  // none for the others.
  renderShell('/schema')
  const schemaLinks = screen.getAllByRole('link', { name: 'Schema' })
  expect(schemaLinks.length).toBeGreaterThan(0)
  schemaLinks.forEach((l) => expect(l).toHaveAttribute('aria-current', 'page'))
  // The Query link (to="/") must NOT be active on /schema thanks to `end`.
  screen
    .getAllByRole('link', { name: 'Query' })
    .forEach((l) => expect(l).not.toHaveAttribute('aria-current'))
})

test('Query nav link is active only on the index route, not on nested routes', () => {
  renderShell('/')
  screen
    .getAllByRole('link', { name: 'Query' })
    .forEach((l) => expect(l).toHaveAttribute('aria-current', 'page'))
  screen
    .getAllByRole('link', { name: 'Schema' })
    .forEach((l) => expect(l).not.toHaveAttribute('aria-current'))
})

test('a section nav link stays active on its nested routes', () => {
  renderShell('/admin/users')
  screen
    .getAllByRole('link', { name: 'Admin' })
    .forEach((l) => expect(l).toHaveAttribute('aria-current', 'page'))
  // And Query (to="/" end) is not active on /admin/users.
  screen
    .getAllByRole('link', { name: 'Query' })
    .forEach((l) => expect(l).not.toHaveAttribute('aria-current'))
})

test('logout button calls signOut', () => {
  renderShell()
  // Two logout buttons exist in the DOM (desktop + mobile drawer);
  // either firing signOut is correct, so we just take the first.
  const buttons = screen.getAllByRole('button', { name: 'Logout' })
  fireEvent.click(buttons[0]!)
  expect(signOut).toHaveBeenCalled()
})

describe('Shell <Body> flex chain', () => {
  it('the body region is a flex column that grows to fill the viewport', () => {
    const { container } = renderShell()
    const main = container.querySelector('main#main-content') as HTMLElement
    expect(main).not.toBeNull()
    const cs = getComputedStyle(main)
    // jsdom doesn't compute layout, but the styled-rule strings ARE
    // serialised — assert the declarations exist.
    expect(cs.display).toBe('flex')
    expect(cs.flexDirection).toBe('column')
    expect(cs.minHeight).toMatch(/100dvh|100vh/)
  })
})
