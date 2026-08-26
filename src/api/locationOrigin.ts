// Leaf accessor for window.location.origin.
//
// jsdom 26 (jest-environment-jsdom v30) makes `window.location`
// non-configurable, so tests can no longer swap the Location object via
// Object.defineProperty. Reading the origin through this module gives
// tests a mockable seam (`jest.doMock('./locationOrigin', ...)`) without
// changing runtime behaviour.
export function locationOrigin(): string | undefined {
  if (typeof window !== 'undefined' && window.location) {
    return window.location.origin
  }
  return undefined
}
