/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

// Mock the generated client BEFORE importing ConnectionPicker so the
// useEffect-driven fetch resolves against the canned profile list.
// The mock returns two profiles whose `name` fields are `default` and
// `prod`; the picker must render both as <option> elements after the
// async effect settles.
jest.mock('../../api/client', () => ({
  client: {
    getProfiles: jest.fn().mockResolvedValue({
      profiles: [{ name: 'default' }, { name: 'prod' }],
    }),
  },
}))

import { ConnectionPicker } from './ConnectionPicker'

import { testTheme as theme } from '../../test-utils/theme'

beforeEach(() => {
  localStorage.clear()
})

test('renders the persisted profile from localStorage as the initial value', async () => {
  // auth.getProfile() reads geode-ui.profile; seed it before mounting.
  localStorage.setItem('geode-ui.profile', 'prod')
  render(
    <ThemeProvider theme={theme}>
      <ConnectionPicker />
    </ThemeProvider>
  )
  // Initial state hydrates from auth.getProfile() before the async
  // /api/v1/profiles fetch resolves, so 'prod' is the displayed value.
  expect(screen.getByDisplayValue('prod')).toBeInTheDocument()
  // Wait for the async fetch to settle so the test doesn't leak a
  // pending state update that React reports as an act() warning.
  await waitFor(() => {
    const opts = screen.getByRole('combobox').querySelectorAll('option')
    expect(opts.length).toBe(2)
  })
  // The persisted 'prod' is in the server list, so it remains active.
  expect(screen.getByDisplayValue('prod')).toBeInTheDocument()
})

test('hydrates the option list from the server response', async () => {
  render(
    <ThemeProvider theme={theme}>
      <ConnectionPicker />
    </ThemeProvider>
  )
  // After the mocked client.profiles() promise resolves, the picker
  // replaces the single-element list ([auth.getProfile()]) with the
  // server-reported names.
  await waitFor(() => {
    const opts = screen.getByRole('combobox').querySelectorAll('option')
    expect(opts.length).toBe(2)
  })
  const opts = Array.from(
    screen.getByRole('combobox').querySelectorAll('option')
  ).map((o) => o.value)
  expect(opts).toEqual(['default', 'prod'])
})
