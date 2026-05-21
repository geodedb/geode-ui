/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../services/i18n/config'
import { lightTheme } from '@geodedb/ui-core/theme'
import { ProfileFilter } from './ProfileFilter'

function wrap(ui: React.ReactElement): React.ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>{ui}</ThemeProvider>
    </I18nextProvider>
  )
}

const profiles = [
  { name: 'default', description: 'in-cluster geode' },
  { name: 'social', description: 'social graph fixture' },
  { name: 'staging', description: 'staging cluster' },
  { name: 'prod', description: 'production cluster' },
]

test('renders one row per profile', () => {
  render(
    wrap(
      <ProfileFilter profiles={profiles} value="default" onChange={() => {}} />
    )
  )
  profiles.forEach((p) => {
    expect(
      screen.getByTestId(`profile-filter-row-${p.name}`)
    ).toBeInTheDocument()
  })
})

test('filter input narrows the rendered rows (case-insensitive substring)', () => {
  render(
    wrap(
      <ProfileFilter profiles={profiles} value="default" onChange={() => {}} />
    )
  )
  const filter = screen.getByTestId('profile-filter-input') as HTMLInputElement
  // 'STAG' (lowercased to 'stag') is a substring of 'staging' — the
  // plan's verbatim snippet used 'STAGE', but 'stage' is NOT a
  // substring of 'staging' (no 'e' between 'g' and 'i'), so the
  // case-insensitive substring matcher correctly excluded it. Picked
  // 'STAG' as the minimal fix that still exercises the case-insensitive
  // path without weakening the matcher to prefix-only.
  fireEvent.change(filter, { target: { value: 'STAG' } })
  expect(screen.getByTestId('profile-filter-row-staging')).toBeInTheDocument()
  expect(screen.queryByTestId('profile-filter-row-default')).toBeNull()
  expect(screen.queryByTestId('profile-filter-row-social')).toBeNull()
})

test('filter matches against the description field too', () => {
  render(
    wrap(
      <ProfileFilter profiles={profiles} value="default" onChange={() => {}} />
    )
  )
  fireEvent.change(screen.getByTestId('profile-filter-input'), {
    target: { value: 'fixture' },
  })
  expect(screen.getByTestId('profile-filter-row-social')).toBeInTheDocument()
  expect(screen.queryByTestId('profile-filter-row-prod')).toBeNull()
})

test('clicking a row calls onChange with the row name', () => {
  const onChange = jest.fn()
  render(
    wrap(
      <ProfileFilter profiles={profiles} value="default" onChange={onChange} />
    )
  )
  fireEvent.click(screen.getByTestId('profile-filter-row-social'))
  expect(onChange).toHaveBeenCalledWith('social')
})

test('the currently-selected row carries aria-selected="true"', () => {
  render(
    wrap(
      <ProfileFilter profiles={profiles} value="social" onChange={() => {}} />
    )
  )
  expect(screen.getByTestId('profile-filter-row-social')).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(screen.getByTestId('profile-filter-row-default')).toHaveAttribute(
    'aria-selected',
    'false'
  )
})

test('shows an empty-state message when filter narrows to zero rows', () => {
  render(
    wrap(
      <ProfileFilter profiles={profiles} value="default" onChange={() => {}} />
    )
  )
  fireEvent.change(screen.getByTestId('profile-filter-input'), {
    target: { value: 'zzz' },
  })
  expect(screen.getByTestId('profile-filter-empty')).toBeInTheDocument()
})
