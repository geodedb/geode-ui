import React from 'react'
import { createRoot } from 'react-dom/client'
import './monaco-bootstrap'
import './assets/fonts/fonts.css'
import App from './App'
import { getStoredConnections } from './api/electron-bridge'
import type { ConnectionState } from './api/connections'

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root')
  if (!container) throw new Error('Root element not found')

  // Hydrate the in-memory connection map from electron's secure store
  // BEFORE first render. Browser mode falls through with an empty list
  // (electron-bridge returns [] when window.geode is undefined).
  // Expired tokens are dropped at the bridge boundary (main.ts filters
  // by expiresAt > Date.now() before returning).
  const stored = await getStoredConnections()
  let initialConnections: ConnectionState[] = stored.map((c) => ({
    connectionId: c.connectionId,
    token: c.token,
    profileName: c.profileName,
    expiresAt: c.expiresAt,
  }))

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
  // to `true`. The runtime `initialConnections.length === 0` guard
  // remains as defense-in-depth so a populated stored-connections list
  // is never overridden by a stray seed.
  if (__E2E_ENABLED__) {
    if (initialConnections.length === 0) {
      const e2eKey = '__GEODE_E2E_INITIAL_CONNECTIONS__'
      const e2e = (
        window as unknown as Record<string, ConnectionState[] | undefined>
      )[e2eKey]
      if (e2e && e2e.length > 0) {
        initialConnections = e2e
      }
    }
  }

  const root = createRoot(container)
  root.render(
    <React.StrictMode>
      <App initialConnections={initialConnections} />
    </React.StrictMode>
  )
}

bootstrap().catch(() => {
  // bootstrap failures are unrecoverable; the blank page is the signal
})
