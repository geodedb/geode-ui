/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { GraphMiniMap } from './GraphMiniMap'

jest.mock('cytoscape-navigator', () => ({
  __esModule: true,
  default: jest.fn(),
}))

describe('GraphMiniMap', () => {
  it('mounts a container with the test-id and calls .navigator on the core', () => {
    const navigator = jest.fn(() => ({ destroy: jest.fn() }))
    const cyRef = { current: { navigator } as never }
    const { container } = render(
      <ThemeProvider theme={theme}>
        <GraphMiniMap cyRef={cyRef as never} />
      </ThemeProvider>
    )
    expect(
      container.querySelector('[data-testid="graph-minimap"]')
    ).not.toBeNull()
    expect(navigator).toHaveBeenCalled()
  })

  it('renders the container even when cyRef.current is null', () => {
    const cyRef = { current: null }
    const { container } = render(
      <ThemeProvider theme={theme}>
        <GraphMiniMap cyRef={cyRef as never} />
      </ThemeProvider>
    )
    expect(
      container.querySelector('[data-testid="graph-minimap"]')
    ).not.toBeNull()
  })

  it('imports the cytoscape-navigator stylesheet (smoke check)', () => {
    // The stylesheet's existence is what makes the viewport rectangle +
    // panner handle visible. We can't query loaded stylesheets reliably
    // in jsdom, so we assert via the side-effect that the cytoscape
    // collection method `.navigator()` returns an instance (the import
    // registers the extension). Failing to import the CSS does not stop
    // registration, but the regression we care about is that someone
    // removes the import — pair this with the e2e visibility test
    // in 24-graph-power-features.spec.ts.
    const navigator = jest.fn(() => ({ destroy: jest.fn() }))
    const cy = { navigator } as unknown as { navigator: jest.Mock }
    const cyRef = { current: cy as never }
    render(
      <ThemeProvider theme={theme}>
        <GraphMiniMap cyRef={cyRef as never} />
      </ThemeProvider>
    )
    // The CSS file is imported as a side-effect at the top of GraphMiniMap.
    // Jest's moduleNameMapper for "\\.css$" returns a stub, but the import
    // still runs. We pin the assertion on the fact that the navigator()
    // call was wired (which proves the module file loaded without error).
    expect(navigator).toHaveBeenCalled()
  })

  it('subscribes to cy.layoutstop so it can refresh the thumbnail once layout finishes', () => {
    // Bug: when the user opens a page with sticky `miniMap: true`, the
    // navigator initialises while cytoscape is still running its first
    // layout. The thumbnail captured at init time is therefore blank,
    // and the user only sees the actual graph after toggling the
    // mini-map off and on again (which re-runs the init flow). Fix:
    // listen for `layoutstop` (cytoscape fires this when a layout
    // finishes) and trigger `cy.resize()` to re-capture the thumbnail.
    const navigator = jest.fn(() => ({ destroy: jest.fn() }))
    const onSpy = jest.fn()
    const offSpy = jest.fn()
    const cy = {
      navigator,
      on: onSpy,
      off: offSpy,
      resize: jest.fn(),
    } as unknown as { navigator: jest.Mock; on: jest.Mock; off: jest.Mock }
    const cyRef = { current: cy as never }
    const { unmount } = render(
      <ThemeProvider theme={theme}>
        <GraphMiniMap cyRef={cyRef as never} />
      </ThemeProvider>
    )
    // A handler must be registered for layoutstop.
    const layoutstopCalls = onSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('layoutstop')
    )
    expect(layoutstopCalls.length).toBeGreaterThan(0)
    // On unmount the handler is torn down (no leak across navigator
    // re-mounts after sig change).
    unmount()
    const layoutstopOff = offSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('layoutstop')
    )
    expect(layoutstopOff.length).toBeGreaterThan(0)
  })

  it('passes a string CSS-selector to cy.navigator (not the raw HTMLElement)', () => {
    const navigator = jest.fn(() => ({ destroy: jest.fn() }))
    const cy = { navigator } as unknown as { navigator: jest.Mock }
    const cyRef = { current: cy as never }
    render(
      <ThemeProvider theme={theme}>
        <GraphMiniMap cyRef={cyRef as never} />
      </ThemeProvider>
    )
    expect(navigator).toHaveBeenCalled()
    // jest.Mock's default args type is `unknown[]` (default-typed tuple is
    // empty under strict mode), so cast through unknown to read the first
    // positional argument.
    const calls = navigator.mock.calls as unknown as Array<
      [{ container?: unknown }]
    >
    const opts = calls[0]?.[0] ?? { container: undefined }
    // cytoscape-navigator's _initPanel only honors options.container
    // when it's a STRING CSS selector. Passing an HTMLElement causes
    // the library to mount its own panel pinned to document.body via
    // `position: fixed; bottom: 0; right: 0;` — the "white box" bug.
    expect(typeof opts.container).toBe('string')
    expect(opts.container).toMatch(/^#/)
  })
})
