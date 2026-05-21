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

test('the View raw JSON anchor is sized to its text, not stretched full-width', () => {
  // 2026-05-21 bug-fix: pre-fix the summary carried `d-block text-end`,
  // which stretched it to the full column width with the link text
  // floated right — the entire gutter became a click target and the
  // visual implied a button bar. Post-fix the summary renders as an
  // inline-block sized to the text; right-alignment lives on the
  // parent <details> via text-align: right so the <pre> body's text
  // stays left-aligned.
  renderToggle({ event: 'login', fields: { user: 'alice' } })
  const summary = screen.getByTestId('audit-json-summary')
  const details = screen.getByTestId('audit-json-details')
  // No more full-width Bootstrap classes on the summary itself.
  expect(summary.className).not.toContain('d-block')
  expect(summary.className).not.toContain('text-end')
  // Summary is content-sized via display: inline-block (jsdom reads
  // this off the styled-components emit through the cascade).
  expect(window.getComputedStyle(summary).display).toBe('inline-block')
  // Right-alignment moved to the parent <details>.
  expect(window.getComputedStyle(details).textAlign).toBe('right')
})
