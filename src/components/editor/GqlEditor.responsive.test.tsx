/// <reference types="@testing-library/jest-dom" />
//
// Reproduction test for the mobile responsive bug in GqlEditor.
//
// Today GqlEditor renders the @monaco-editor/react Editor with a
// fixed `height={240}` prop. On a 375x812 mobile viewport that consumes
// roughly 30% of vertical chrome and pushes the result region below the
// fold. The fix should make the editor's effective height shrink to
// <= 200 px when the host is narrower than the `md` breakpoint
// (768 px) -- either by reacting to a media query, by accepting a
// responsive `height` prop the page wires from useMediaQuery, or by
// using a viewport-aware default.
//
// This test mocks `@monaco-editor/react` so we observe exactly what
// `height` prop reaches it. Today the test fails because GqlEditor
// hardcodes 240 regardless of viewport. After the fix it should pass.

import React from 'react'
import { render } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../test-utils/theme'

// Side-effect import bootstrap is stubbed so monaco's giant module
// graph never loads in jest.
jest.mock('../../monaco-bootstrap', () => ({}))

// Capture the props passed to the underlying Editor so we can read
// the `height` value the parent forwarded.
const editorProps: Array<{ height?: number | string }> = []
jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: (props: { height?: number | string; value?: string }) => {
    editorProps.push({ height: props.height })
    return (
      <div data-testid="monaco-editor-stub" data-height={String(props.height)}>
        {props.value}
      </div>
    )
  },
}))

// matchMedia stub: we want the production GqlEditor (or its imminent
// post-fix variant) to be able to query `(max-width: 767.98px)` and
// receive `matches: true` so the responsive code path fires.
function installMatchMediaMock(maxWidthPx: number): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => {
      // Naive parser: extract `max-width: N` and compare to maxWidthPx.
      const m = query.match(/max-width:\s*([0-9.]+)px/)
      const limit = m && m[1] ? parseFloat(m[1]) : Infinity
      return {
        matches: maxWidthPx <= limit,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }
    },
  })
}

describe('GqlEditor responsive height (mobile bug)', () => {
  beforeEach(() => {
    editorProps.length = 0
  })

  it('renders the editor at <= 200px height on a mobile-class viewport', async () => {
    // Simulate a 375 px (mobile) viewport.
    installMatchMediaMock(375)
    // Lazy-import after mocks so the module picks up our matchMedia stub.
    const mod = await import('./GqlEditor')

    render(
      <ThemeProvider theme={theme}>
        <mod.GqlEditor value="" onChange={() => {}} onRun={() => {}} />
      </ThemeProvider>
    )

    // The Editor wrapper should have received a height the user can
    // visually fit on a 375 px viewport. Bug: defaults to 240.
    expect(editorProps.length).toBeGreaterThan(0)
    const lastHeight = editorProps[editorProps.length - 1]?.height
    let numeric: number
    if (typeof lastHeight === 'number') numeric = lastHeight
    else if (typeof lastHeight === 'string') numeric = parseFloat(lastHeight)
    else numeric = NaN
    expect(Number.isNaN(numeric)).toBe(false)
    // BEFORE fix: numeric === 240, this fails.
    // AFTER fix: numeric should drop to <= 200 on mobile.
    expect(numeric).toBeLessThanOrEqual(200)
  })

  it('keeps a usable default editor height on a desktop-class viewport', async () => {
    // Simulate a 1280 px (desktop) viewport.
    installMatchMediaMock(1280)
    const mod = await import('./GqlEditor')

    render(
      <ThemeProvider theme={theme}>
        <mod.GqlEditor value="" onChange={() => {}} onRun={() => {}} />
      </ThemeProvider>
    )

    const lastHeight = editorProps[editorProps.length - 1]?.height
    let numeric: number
    if (typeof lastHeight === 'number') numeric = lastHeight
    else if (typeof lastHeight === 'string') numeric = parseFloat(lastHeight)
    else numeric = NaN
    expect(Number.isNaN(numeric)).toBe(false)
    // On desktop the editor should remain at its 240 default (or any
    // value >= 200) -- i.e. the mobile shrink must not regress desktop.
    expect(numeric).toBeGreaterThanOrEqual(200)
  })
})
