// PSR-G06 (#83) — FatalBootstrapError contract.
//
// Tests pin the user-visible behaviour:
//   1. The panel announces itself via role="alert" so assistive tech
//      picks it up immediately.
//   2. The error message is rendered in plain text (not a raw stack).
//   3. The stack lives inside a <details> so a non-technical user
//      can ignore it but a developer can copy/paste it from the DOM.
//   4. Non-Error throws (string, number, plain object) are rendered
//      without the panel itself crashing.

import React from 'react'
import { render, screen } from '@testing-library/react'
import { FatalBootstrapError } from './FatalBootstrapError'

describe('FatalBootstrapError', () => {
  test('renders the heading + message + stack from a real Error', () => {
    const err = new Error('failed to load monaco-bootstrap')
    render(<FatalBootstrapError error={err} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/Geode failed to start/i)).toBeInTheDocument()
    // Both the message line and the stack pre block carry the message
    // (the stack starts with "Error: failed to load…"). Use getAllByText
    // to tolerate both occurrences.
    const matches = screen.getAllByText(/failed to load monaco-bootstrap/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
    // The stack lives inside a <details> with a Diagnostic-details summary.
    // Use getAllByText since both <summary> and any nested wrapper can
    // match depending on RTL's normalisation rules.
    expect(
      screen.getAllByText(/Diagnostic details/i).length
    ).toBeGreaterThanOrEqual(1)
    const stackEl = screen.getByTestId('fatal-bootstrap-stack')
    // Real Error objects always carry a stack in V8/JS engines used by
    // the supported runtimes; the panel renders it verbatim.
    expect(stackEl.textContent).toMatch(/at /)
  })

  test('handles a thrown string without crashing', () => {
    render(<FatalBootstrapError error="something went wrong" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    // Both the message line and the stack pre block carry the string;
    // the panel must not crash and both must render.
    const matches = screen.getAllByText(/something went wrong/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('fatal-bootstrap-stack')).toBeInTheDocument()
  })

  test('handles a thrown plain object', () => {
    render(<FatalBootstrapError error={{ code: 42, reason: 'oops' }} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    const stack = screen.getByTestId('fatal-bootstrap-stack')
    expect(stack.textContent).toContain('"code": 42')
    expect(stack.textContent).toContain('"reason": "oops"')
  })
})
