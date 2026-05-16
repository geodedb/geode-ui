require('@testing-library/jest-dom')
// Ensure the i18n instance initializes once for every test file. Tests
// that don't render under <LocalizationProvider> still call useTranslation()
// inside Shell, LoginPage, etc. — without this side-effect import the
// hook would render raw keys like "common.skipToMain" instead of the
// translated strings.
require('../src/services/i18n/config')

// QUALITY #227: fail Jest on unexpected React `act(...)` / Suspense
// warnings. These have historically slipped past code review because
// jest still reports the suite as `PASS` while console.error fires
// a stack trace per warning. Adding the gate here means a regression
// (a new component that schedules a setState after a microtask
// without an awaiting test) reliably fails the suite instead of
// silently emitting noise.
//
// We patch `console.error` rather than `console.warn` because React's
// `warnIfUpdatesNotWrappedWithActDEV` / `warnIfSuspenseResolutionNotWrappedWithActDEV`
// both route through console.error. Filter is exact-string-match on
// the leading "Warning: …" segment so the gate stays robust against
// React's wording drift and doesn't accidentally catch app-emitted
// console.error calls.
const ACT_WARNING_PATTERNS = [
  'inside a test was not wrapped in act',
  'suspended resource finished loading inside a test',
]

const originalConsoleError = console.error
console.error = function actGate(...args) {
  const message = typeof args[0] === 'string' ? args[0] : ''
  const matched = ACT_WARNING_PATTERNS.some((p) => message.includes(p))
  if (matched) {
    // Fail loudly: throw inside the test so the suite reports a real
    // failure with the call stack of the offending setState. Throwing
    // is safer than emitting via process.exitCode — it surfaces in
    // jest's per-test output instead of being swallowed by a clean
    // PASS marker.
    throw new Error(`React act() / Suspense warning in test: ${message}`)
  }
  return originalConsoleError.apply(this, args)
}
