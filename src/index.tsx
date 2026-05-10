import React from 'react'
import { createRoot } from 'react-dom/client'
import './monaco-bootstrap'
import './assets/fonts/fonts.css'
import App from './App'
import type { ConnectionState } from './api/connections'
import { FatalBootstrapError } from './components/FatalBootstrapError'

// PSR-F16 (#113): the SPA used to await getStoredConnections() before
// calling createRoot, which serialised safeStorage init + the secure-
// store file read on the critical path of first paint. Cold-start
// users stared at a blank window for the full IPC round-trip.
//
// Post-fix the React shell mounts synchronously with an empty initial
// connection map; ConnectionsProvider's `lazyHydrate` mode dispatches
// the populated state once getStoredConnections() resolves. The
// E2E backdoor still injects its seed list eagerly (so the addInitScript
// data is observable on first render) but production users see paint
// happen as soon as React, the bundle, and the GlobalStyle are ready.
// PSR-G06 (#83): bootstrap is exported so the regression test can drive
// it directly with a mocked DOM and a forced rejection inside the
// react-dom render path. The IIFE below is the production entrypoint;
// the export itself is harmless to bundle (it is just a symbol).
export function bootstrap(): void {
  const container = document.getElementById('root')
  if (!container) throw new Error('Root element not found')

  // E2E backdoor: Playwright's authedContext fixture seeds a JWT-bearing
  // connection here via addInitScript so ProtectedRoute (which gates on
  // useActiveConnection != null) doesn't redirect to /login. Production
  // code never sets this global; it is intentionally a separate channel
  // from electron-bridge so the test path doesn't pretend to be Electron.
  // The bracket access bypasses no-underscore-dangle on the leading
  // sentinel and makes the test-only origin of the field explicit.
  //
  // SECURITY (GAP-S2 / #115): the entire block is wrapped in a
  // `if (__E2E_ENABLED__)` build-time gate. `__E2E_ENABLED__` is a
  // webpack DefinePlugin constant (see webpack.common.js) that is the
  // literal `false` in every release build, so webpack + Terser
  // dead-code-eliminate the block. Only e2e-targeted builds (the e2e
  // Dockerfile sets `GEODE_E2E_BUILD=true`) leave the gate evaluating
  // to `true`. The eager-seed path is preserved here because Playwright
  // assertions race the lazy-hydrate effect; the seed list must be on
  // the first render for the test fixture to be observable.
  let eagerInitial: ConnectionState[] | undefined
  if (__E2E_ENABLED__) {
    const e2eKey = '__GEODE_E2E_INITIAL_CONNECTIONS__'
    const e2e = (
      window as unknown as Record<string, ConnectionState[] | undefined>
    )[e2eKey]
    if (e2e && e2e.length > 0) {
      eagerInitial = e2e
    }
  }

  const root = createRoot(container)
  root.render(
    <React.StrictMode>
      <App initialConnections={eagerInitial} lazyHydrate />
    </React.StrictMode>
  )
}

// PSR-G06 (#83): renderFatal mounts the FatalBootstrapError panel into
// whichever container we can find. Pre-fix the catch swallowed the
// error and the user got a blank page with an empty console; the
// post-fix path:
//   1. Logs the error via console.error so devtools / Sentry / Playwright
//      / electron-log can pick it up.
//   2. Tries to render the FatalBootstrapError panel into #root.
//   3. If #root itself is missing (the most-common cause), falls back
//      to <body> so the user sees something useful even when the SPA
//      shell is broken.
//   4. If even THAT fails (jsdom without document.body, etc.), the
//      console.error remains the surviving signal.
export function renderFatal(error: unknown): void {
  // The console.error is the primary signal for any monitoring layer;
  // do it first so a downstream throw can't suppress it.
  // eslint-disable-next-line no-console
  console.error('[geode-ui] bootstrap failed:', error)
  try {
    const target = document.getElementById('root') ?? document.body ?? null
    if (!target) return
    const root = createRoot(target)
    root.render(<FatalBootstrapError error={error} />)
  } catch {
    // Best-effort — the console.error above is the surviving signal.
  }
}

// Don't run bootstrap when the module is imported by jest (the test
// drives bootstrap()/renderFatal directly with controlled DOM state).
// In production the module is loaded once at runtime and the IIFE runs.
if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
  try {
    bootstrap()
  } catch (err) {
    renderFatal(err)
  }
}
