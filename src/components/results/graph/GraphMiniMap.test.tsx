/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { GraphMiniMap } from './GraphMiniMap'

// PERF #316: GraphMiniMap now lazy-imports cytoscape-navigator + the
// plugin's CSS sidecar via `import('cytoscape-navigator')` inside
// `ensureNavigatorPlugin()`. Tests that exercise the navigator-init
// path therefore must `await waitFor(...)` to flush the dynamic-
// import microtask before asserting on the cy.navigator() call shape.

jest.mock('cytoscape-navigator', () => ({
  __esModule: true,
  default: jest.fn(),
}))
// Also mock the CSS sidecar imported by the same dynamic-import
// factory — the prod path uses webpack's CSS loader, but in jest the
// moduleNameMapper for `\\.css$` already returns an empty stub for
// static imports. The dynamic form goes through the same mapper, so
// this is belt-and-braces.
jest.mock('cytoscape-navigator/cytoscape.js-navigator.css', () => ({}), {
  virtual: true,
})

describe('GraphMiniMap', () => {
  it('mounts a container with the test-id and calls .navigator on the core', async () => {
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
    await waitFor(() => expect(navigator).toHaveBeenCalled())
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

  it('imports the cytoscape-navigator stylesheet (smoke check)', async () => {
    // The stylesheet's existence is what makes the viewport rectangle +
    // panner handle visible. We can't query loaded stylesheets reliably
    // in jsdom, so we assert via the side-effect that the cytoscape
    // collection method `.navigator()` returns an instance (the import
    // registers the extension). Failing to import the CSS does not stop
    // registration, but the regression we care about is that someone
    // removes the import — pair this with the e2e visibility test
    // in 24-graph-power-features.spec.ts.
    //
    // PERF #316: post-lazy-load the CSS import is co-located with the
    // plugin module inside the dynamic-import factory. waitFor flushes
    // both microtasks before asserting.
    const navigator = jest.fn(() => ({ destroy: jest.fn() }))
    const cy = { navigator } as unknown as { navigator: jest.Mock }
    const cyRef = { current: cy as never }
    render(
      <ThemeProvider theme={theme}>
        <GraphMiniMap cyRef={cyRef as never} />
      </ThemeProvider>
    )
    await waitFor(() => expect(navigator).toHaveBeenCalled())
  })

  it('subscribes to cy.layoutstop so it can refresh the thumbnail once layout finishes', async () => {
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
    // A handler must be registered for layoutstop. Await the lazy-
    // import resolution first so the bind has happened.
    await waitFor(() => {
      const layoutstopCalls = onSpy.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('layoutstop')
      )
      expect(layoutstopCalls.length).toBeGreaterThan(0)
    })
    // On unmount the handler is torn down (no leak across navigator
    // re-mounts after sig change).
    unmount()
    const layoutstopOff = offSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('layoutstop')
    )
    expect(layoutstopOff.length).toBeGreaterThan(0)
  })

  it('initialises the navigator once cyRef.current becomes non-null (build is debounced)', async () => {
    // BUG: useGraphCytoscape debounces the cy build by 250 ms. When the
    // user opens a page with sticky `miniMap: true`, GraphMiniMap mounts
    // BEFORE the cy core is constructed (cyRef.current === null). The
    // pre-fix useEffect early-returned at `if (!cy)` and never re-ran —
    // its deps `[cyRef, sig]` are stable references, so the navigator
    // was never initialised. The fix polls cyRef.current with a 50 ms
    // retry (same pattern as useNodeTooltip) until the core appears.
    //
    // PERF #316: real timers + waitFor instead of fake timers — the
    // lazy-import resolves on the microtask queue which fake timers
    // don't advance. The poll itself uses setTimeout(50) inside the
    // effect; under real timers the poll fires for real on the next
    // tick and the waitFor below settles once the navigator runs.
    const navigator = jest.fn(() => ({ destroy: jest.fn() }))
    const cyRef: { current: { navigator: jest.Mock } | null } = {
      current: null,
    }
    render(
      <ThemeProvider theme={theme}>
        <GraphMiniMap cyRef={cyRef as never} />
      </ThemeProvider>
    )
    // Pre-condition: navigator hasn't been called yet (cy still null).
    expect(navigator).not.toHaveBeenCalled()
    // Simulate the debounced build landing: cy core appears on the ref.
    cyRef.current = { navigator }
    await waitFor(() => expect(navigator).toHaveBeenCalled())
  })

  it('passes a string CSS-selector to cy.navigator (not the raw HTMLElement)', async () => {
    const navigator = jest.fn(() => ({ destroy: jest.fn() }))
    const cy = { navigator } as unknown as { navigator: jest.Mock }
    const cyRef = { current: cy as never }
    render(
      <ThemeProvider theme={theme}>
        <GraphMiniMap cyRef={cyRef as never} />
      </ThemeProvider>
    )
    await waitFor(() => expect(navigator).toHaveBeenCalled())
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
