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
  const initialConnections: ConnectionState[] = stored.map((c) => ({
    connectionId: c.connectionId,
    token: c.token,
    profileName: c.profileName,
    expiresAt: c.expiresAt,
  }))

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
