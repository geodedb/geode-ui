/// <reference types="@testing-library/jest-dom" />
//
// Operator-reported UX gap (2026-05-22): "when querying the query box
// should become read-only and support a cancel option". Pre-fix
// GqlEditor never set Monaco's options.readOnly, so the operator
// could edit (and even type a new statement into) the same buffer
// while the prior run was still in flight. The race produced two
// confusing outcomes:
//   - the in-flight query's `runStmt` snapshot diverges from the
//     editor's live text;
//   - clicking Run again could fire a SECOND query against a
//     half-typed statement before the first one resolved.
//
// The fix exposes a `readOnly?: boolean` prop on GqlEditor and
// forwards it into Monaco's `options.readOnly`. QueryPage drives it
// from its `busy` state.

import React from 'react'
import { render } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../test-utils/theme'

jest.mock('../../monaco-bootstrap', () => ({}))

// Capture the options prop that reaches Monaco so the test can
// assert on options.readOnly.
const editorProps: Array<{
  options?: { readOnly?: boolean; [k: string]: unknown }
}> = []

jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: (props: {
    options?: { readOnly?: boolean; [k: string]: unknown }
    value?: string
  }) => {
    editorProps.push({ options: props.options })
    return (
      <div
        data-testid="monaco-editor-stub"
        data-read-only={String(props.options?.readOnly ?? false)}
      >
        {props.value}
      </div>
    )
  },
}))

describe('GqlEditor readOnly forwarding', () => {
  beforeEach(() => {
    editorProps.length = 0
  })

  it('forwards readOnly=true into Monaco options when the prop is set', async () => {
    const mod = await import('./GqlEditor')
    render(
      <ThemeProvider theme={theme}>
        <mod.GqlEditor
          value="MATCH (n) RETURN n"
          onChange={() => undefined}
          onRun={() => undefined}
          readOnly
        />
      </ThemeProvider>
    )
    const last = editorProps[editorProps.length - 1]
    expect(last?.options?.readOnly).toBe(true)
  })

  it('forwards readOnly=false (or absent) into Monaco options by default', async () => {
    const mod = await import('./GqlEditor')
    render(
      <ThemeProvider theme={theme}>
        <mod.GqlEditor
          value=""
          onChange={() => undefined}
          onRun={() => undefined}
        />
      </ThemeProvider>
    )
    const last = editorProps[editorProps.length - 1]
    // Either explicitly false or undefined — both are non-readonly
    // by Monaco's contract. We assert the negation so the wrapper
    // can pick whichever shape is cleanest.
    expect(last?.options?.readOnly === true).toBe(false)
  })
})
