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
