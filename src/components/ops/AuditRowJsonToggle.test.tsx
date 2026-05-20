/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

import { AuditRowJsonToggle } from './AuditRowJsonToggle'
import { LocalizationProvider } from '../../services/i18n'
import { testTheme as theme } from '../../test-utils/theme'

function renderToggle(entry: object): void {
  render(
    <LocalizationProvider>
      <ThemeProvider theme={theme}>
        <AuditRowJsonToggle entry={entry} />
      </ThemeProvider>
    </LocalizationProvider>
  )
}

test('renders a closed <details> by default', () => {
  renderToggle({ event: 'login', fields: { user: 'alice' } })
  const det = screen.getByTestId('audit-json-details') as HTMLDetailsElement
  expect(det.open).toBe(false)
})

test('clicking the summary opens the raw JSON pre block', () => {
  renderToggle({ event: 'login', fields: { user: 'alice' } })
  const det = screen.getByTestId('audit-json-details') as HTMLDetailsElement
  fireEvent.click(screen.getByTestId('audit-json-summary'))
  expect(det.open).toBe(true)
  expect(screen.getByTestId('audit-json-body')).toHaveTextContent(
    /"event":\s*"login"/
  )
})

test('the raw JSON body pretty-prints with two-space indent', () => {
  renderToggle({ event: 'login', fields: { user: 'alice', cid: 'c1' } })
  fireEvent.click(screen.getByTestId('audit-json-summary'))
  expect(screen.getByTestId('audit-json-body').textContent).toMatch(
    /\n {2}"event"/
  )
})

test('the View raw JSON anchor is right-aligned via Bootstrap utilities', () => {
  renderToggle({ event: 'login', fields: { user: 'alice' } })
  const summary = screen.getByTestId('audit-json-summary')
  // Right-aligned within its column via Bootstrap's d-block + text-end
  // responsive utility stack — these classes apply at every breakpoint
  // so the toggle hugs the right edge on mobile and desktop alike.
  expect(summary.className).toContain('d-block')
  expect(summary.className).toContain('text-end')
})
