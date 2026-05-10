// Polyfills for test environment
if (typeof globalThis.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util')
  globalThis.TextEncoder = TextEncoder
  globalThis.TextDecoder = TextDecoder
}

// jsdom does not provide fetch; the generated client snapshots a reference at
// construction time, so provide a stub so module-load-time client creation
// doesn't blow up. Tests that exercise network calls should mock as needed.
if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = () =>
    Promise.reject(
      new Error('fetch is not implemented in the test environment')
    )
}

// __E2E_ENABLED__ is a webpack DefinePlugin constant injected at build
// time (see webpack.common.js). Jest doesn't run webpack, so we install
// the production default here: `false`. Tests that want to exercise the
// backdoor path can override globalThis.__E2E_ENABLED__ inside a
// describe-scoped beforeEach/afterEach pair.
//
// SECURITY: pinning the default to `false` mirrors the production
// build; without it, `if (__E2E_ENABLED__)` would throw ReferenceError
// in jsdom and silently mask coverage gaps around the gating block.
if (typeof globalThis.__E2E_ENABLED__ === 'undefined') {
  globalThis.__E2E_ENABLED__ = false
}

// react-window v2 uses ResizeObserver to track its container size.
// jsdom doesn't ship one, so install a no-op stub. The component
// falls back to defaultHeight/defaultWidth when no observed size is
// reported, which is what we want in unit tests.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
