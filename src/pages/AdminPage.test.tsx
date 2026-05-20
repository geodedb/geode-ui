/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// GAP-050: per-tab capability gate. When admin_writable.policies is
// false, the Policies tab MUST render as a disabled <span> (not a
// <Link>) with aria-disabled="true" and the upcoming-feature title.
// Same contract applies to users / roles / grants — every Admin
// sub-page funnels through the capability gate.
//
// Mock useCapabilities so each test can set the matrix without
// touching the network.
const useCapabilitiesMock = jest.fn()
jest.mock('../hooks/useCapabilities', () => ({
  useCapabilities: () => useCapabilitiesMock(),
}))

import { AdminPage } from './AdminPage'
import { LocalizationProvider } from '../services/i18n'
import { testTheme as theme } from '../test-utils/theme'

function renderAdmin(): void {
  render(
    <MemoryRouter initialEntries={['/admin/users']}>
      <LocalizationProvider>
        <ThemeProvider theme={theme}>
          <Routes>
            <Route path="/admin" element={<AdminPage />}>
              <Route path="users" element={<span>users-body</span>} />
            </Route>
          </Routes>
        </ThemeProvider>
      </LocalizationProvider>
    </MemoryRouter>
  )
}

beforeEach(() => useCapabilitiesMock.mockReset())

test('GAP-050: disables the Policies tab when admin_writable.policies is false', async () => {
  useCapabilitiesMock.mockReturnValue({
    adminWritable: { users: true, roles: true, policies: false, grants: true },
    geodeVersion: 'v0.5.19',
    loading: false,
    loaded: true,
  })
  renderAdmin()
  await waitFor(() => {
    expect(
      screen.getByTestId('admin-tab-disabled-policies')
    ).toBeInTheDocument()
  })
  const disabled = screen.getByTestId('admin-tab-disabled-policies')
  expect(disabled).toHaveAttribute('aria-disabled', 'true')
  expect(disabled.tagName.toLowerCase()).toBe('span')
})

test('GAP-050: surfaces the upcoming-feature copy on the disabled tab', () => {
  useCapabilitiesMock.mockReturnValue({
    adminWritable: {
      users: false,
      roles: false,
      policies: false,
      grants: false,
    },
    geodeVersion: 'v0.5.19',
    loading: false,
    loaded: true,
  })
  renderAdmin()
  const disabled = screen.getByTestId('admin-tab-disabled-policies')
  // title surfaces the "scheduled for a future release" copy so a
  // hover-then-tooltip surfaces the reason; tooltip text comes from
  // the i18n key `admin.featureUpcoming`.
  expect(disabled.getAttribute('title')).toMatch(/future Geode release/i)
})

test('GAP-050: every supported family renders as a <Link>', () => {
  useCapabilitiesMock.mockReturnValue({
    adminWritable: { users: true, roles: true, policies: true, grants: true },
    geodeVersion: 'v0.5.19',
    loading: false,
    loaded: true,
  })
  renderAdmin()
  // No disabled tabs in the all-supported state.
  expect(screen.queryByTestId('admin-tab-disabled-users')).toBeNull()
  expect(screen.queryByTestId('admin-tab-disabled-roles')).toBeNull()
  expect(screen.queryByTestId('admin-tab-disabled-policies')).toBeNull()
  expect(screen.queryByTestId('admin-tab-disabled-grants')).toBeNull()
})

test('GAP-050: shows tabs as enabled while capabilities are loading', () => {
  // During the in-flight probe the gate cannot yet judge any family;
  // default to enabled so the eventual gate doesn't flash an enabled
  // tab then disable it. Same posture useCapabilities() takes for the
  // CTA buttons under existing admin sub-pages.
  useCapabilitiesMock.mockReturnValue({
    adminWritable: {
      users: false,
      roles: false,
      policies: false,
      grants: false,
    },
    geodeVersion: '',
    loading: true,
    loaded: false,
  })
  renderAdmin()
  expect(screen.queryByTestId('admin-tab-disabled-policies')).toBeNull()
})
