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

// jsdom 26 (jest 30) makes window.location non-configurable, so the old
// Object.defineProperty(window, 'location', ...) swap throws. The
// resolver now reads the origin through the ./locationOrigin leaf
// module precisely so tests can stub it per-case.
let stubbedOrigin: string | undefined
jest.mock('./locationOrigin', () => ({
  __esModule: true,
  locationOrigin: (): string | undefined => stubbedOrigin,
}))

function setLocationOrigin(origin: string): void {
  stubbedOrigin = origin
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

// APP-08 (2026-05-24 appsec): the fetch wrapper accepts an optional
// `connectionId` field on `init` and uses `getTokenForConnection(id)`
// to pick the bearer, falling back to the module-level latch. The
// per-connection plumbing prevents a confused-deputy race where a
// switch from A to B between two fetches against A would attach
// B's token.
describe('client fetch wrapper — APP-08 per-connection bearer', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  test('honors init.connectionId over the module-level latch', async () => {
    // eslint-disable-next-line global-require
    const conns = require('./connections') as {
      setLatestToken: (t: string | null) => void
      setConnectionTokenForTests: (id: string, token: string) => void
      clearConnectionTokensForTests: () => void
    }
    conns.clearConnectionTokensForTests()
    conns.setLatestToken('tok-A-from-latch')
    conns.setConnectionTokenForTests('cid-B', 'tok-B-explicit')

    // The wrapper binds the native fetch at construction time, so
    // install the jest mock BEFORE building the wrapper.
    let capturedAuth: string | null = null
    global.fetch = jest.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedAuth = new Headers(init?.headers ?? {}).get('authorization')
        return {
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({}),
        } as unknown as Response
      }
    ) as unknown as typeof fetch
    // eslint-disable-next-line global-require
    const { makeFetchImplForTests } = require('./client') as {
      makeFetchImplForTests: () => typeof fetch
    }
    const fetchImpl = makeFetchImplForTests()

    await fetchImpl('http://localhost/api/v1/probe', {
      connectionId: 'cid-B',
    } as RequestInit & { connectionId: string })
    expect(capturedAuth).toBe('Bearer tok-B-explicit')
    conns.clearConnectionTokensForTests()
    conns.setLatestToken(null)
  })

  test('falls back to the module-level latch when init.connectionId is unset', async () => {
    // eslint-disable-next-line global-require
    const conns = require('./connections') as {
      setLatestToken: (t: string | null) => void
      clearConnectionTokensForTests: () => void
    }
    conns.clearConnectionTokensForTests()
    conns.setLatestToken('tok-latch-only')

    let capturedAuth: string | null = null
    global.fetch = jest.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedAuth = new Headers(init?.headers ?? {}).get('authorization')
        return {
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({}),
        } as unknown as Response
      }
    ) as unknown as typeof fetch
    // eslint-disable-next-line global-require
    const { makeFetchImplForTests } = require('./client') as {
      makeFetchImplForTests: () => typeof fetch
    }
    const fetchImpl = makeFetchImplForTests()

    await fetchImpl('http://localhost/api/v1/probe')
    expect(capturedAuth).toBe('Bearer tok-latch-only')
    conns.setLatestToken(null)
  })
})
