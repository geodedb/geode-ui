import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

import { testTheme as theme } from '../../test-utils/theme'
import { Field } from './Field'

const wrap = (ui: React.ReactNode) =>
  render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)

test('renders hint text and wires it into aria-describedby when there is no error', () => {
  wrap(
    <Field label="Display name" htmlFor="name" hint="Visible to others.">
      <input id="name" />
    </Field>
  )
  const input = screen.getByRole('textbox')
  const hint = screen.getByText('Visible to others.')
  expect(hint).toHaveAttribute('id', 'name-hint')
  expect(input).toHaveAttribute('aria-describedby', 'name-hint')
})

test('renders an error with role=alert and wires it into aria-describedby', () => {
  wrap(
    <Field
      label="Password"
      htmlFor="pw"
      error="Must be at least 12 characters."
    >
      <input id="pw" type="password" />
    </Field>
  )
  const error = screen.getByRole('alert')
  expect(error).toHaveTextContent('Must be at least 12 characters.')
  expect(error).toHaveAttribute('id', 'pw-error')
  expect(screen.getByLabelText('Password')).toHaveAttribute(
    'aria-describedby',
    'pw-error'
  )
})

test('suppresses the hint when an error is present and does not dangle its id in aria-describedby (regression)', () => {
  // Regression for: hintId was computed whenever hint+htmlFor were
  // present, regardless of whether the hint <div> actually rendered
  // (it only renders when hint && !error). With both hint and error
  // supplied, aria-describedby used to reference an id with no
  // corresponding DOM node — a dangling ARIA reference.
  wrap(
    <Field
      label="Password"
      htmlFor="pw2"
      hint="At least 12 characters."
      error="Too short."
    >
      <input id="pw2" type="password" />
    </Field>
  )
  expect(screen.queryByText('At least 12 characters.')).not.toBeInTheDocument()
  const input = screen.getByLabelText('Password')
  expect(input).toHaveAttribute('aria-describedby', 'pw2-error')
  // The hint id must never appear in aria-describedby once the hint
  // element itself stops rendering.
  expect(input.getAttribute('aria-describedby')).not.toMatch(/pw2-hint/)
  // And the id that IS referenced must exist in the DOM.
  expect(document.getElementById('pw2-error')).not.toBeNull()
})

test('renders a required asterisk alongside the control', () => {
  wrap(
    <Field label="Full name" htmlFor="fullname" required>
      <input id="fullname" />
    </Field>
  )
  expect(screen.getByLabelText('Full name')).toBeInTheDocument()
  const asterisk = screen.getByText('*')
  expect(asterisk).toHaveAttribute('aria-hidden', 'true')
})
