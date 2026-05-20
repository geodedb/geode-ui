/**
 * @jest-environment jsdom
 */
import type { GeodeBridge } from '../types/electron'

// Why this test matters: pre-fix `resolveBaseUrl` returned
// window.location.origin unconditionally, which is `geode://app`
// under Electron. The geode:// origin tripped the generated client's
// URL whitelist ("base URL must use http or https"), unmounting the
// SPA before React rendered. The fixed resolver short-circuits on
// window.geode.serverUrl when running under the desktop wrapper, and
// falls back to http://localhost only when neither a bridge serverUrl
// nor an http(s) origin is available.

function setLocationOrigin(origin: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, origin, href: origin + '/' },
  })
}

function setBridge(serverUrl: string | undefined): void {
  const w = window as unknown as { geode?: GeodeBridge }
  if (serverUrl === undefined) {
    delete w.geode
    return
  }
  w.geode = { isElectron: true, serverUrl } as unknown as GeodeBridge
}

describe('client.resolveBaseUrl', () => {
  const importResolver = (): (() => string) => {
    let mod: { resolveBaseUrl: () => string } | undefined
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      mod = require('./client') as { resolveBaseUrl: () => string }
    })
    if (!mod) throw new Error('failed to import ./client')
    return mod.resolveBaseUrl
  }

  afterEach(() => setBridge(undefined))

  test('uses window.geode.serverUrl when running under Electron', () => {
    setLocationOrigin('geode://app')
    setBridge('http://localhost:9999')
    expect(importResolver()()).toBe('http://localhost:9999')
  })

  test('falls back to window.location.origin in the browser', () => {
    setBridge(undefined)
    setLocationOrigin('https://app.geodedb.com')
    expect(importResolver()()).toBe('https://app.geodedb.com')
  })

  test('skips a non-http origin even when the bridge is missing', () => {
    // Defensive: if a future build runs the SPA under Electron but
    // the preload fails to set serverUrl, the resolver must NOT echo
    // back `geode://app` (which would trip the URL whitelist again).
    // It should fall back to the http://localhost default instead.
    setBridge(undefined)
    setLocationOrigin('geode://app')
    expect(importResolver()()).toBe('http://localhost')
  })
})
