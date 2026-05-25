// Regression tests for the Electron login bug:
//
//   "Unexpected token '<', \"<!doctype \"... is not valid JSON"
//
// Repro: the renderer is hosted on the privileged `geode://app/` scheme.
// `auth.ts` was using bare relative URLs (`/api/v1/auth/login`,
// `/api/v1/auth/whoami`, etc.) which the browser resolved against the
// `geode://` origin. The custom protocol handler's SPA fallback
// (electron/main.ts) returned `index.html` for any non-file path, so
// the response body was `<!doctype html>` and `await res.json()` threw.
//
// These tests fix the contract: when `window.geode.serverUrl` is set
// (Electron), every auth-module fetch must target the absolute
// `${serverUrl}/api/v1/...` form so it bypasses the geode:// protocol
// handler and lands on the real geode-ui server.
import type { GeodeBridge } from '../types/electron'
import {
  fetchPublicProfiles,
  fetchWhoAmI,
  login,
  logout,
  onboardProfile,
} from './auth'

const realFetch = global.fetch
const SERVER_URL = 'http://localhost:9999'

function setBridge(serverUrl: string | undefined): void {
  const w = window as unknown as { geode?: GeodeBridge }
  if (serverUrl === undefined) {
    delete w.geode
    return
  }
  w.geode = {
    isElectron: true,
    serverUrl,
    platform: 'linux',
  } as unknown as GeodeBridge
}

beforeEach(() => {
  setBridge(SERVER_URL)
})

afterEach(() => {
  setBridge(undefined)
  global.fetch = realFetch
})

function firstFetchUrl(): string {
  const calls = (global.fetch as jest.Mock).mock.calls
  expect(calls.length).toBeGreaterThan(0)
  const arg = calls[0][0]
  return typeof arg === 'string' ? arg : (arg as URL).toString()
}

test('login fetches an absolute URL on Electron (window.geode.serverUrl)', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      access_token: 'jwt',
      token_type: 'Bearer',
      expires_in: 3600,
      connection_id: 'cid',
    }),
  })) as unknown as typeof fetch

  await login('alice', 'pw', 'default')

  // Pre-fix the URL was '/api/v1/auth/login' — a relative path that
  // resolved against the geode:// origin and hit the SPA fallback,
  // returning '<!doctype html>'. Post-fix it must be the absolute
  // form against the bridge-supplied origin.
  expect(firstFetchUrl()).toBe(`${SERVER_URL}/api/v1/auth/login`)
})

test('fetchWhoAmI fetches an absolute URL on Electron', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      sub: 'alice',
      profile: 'default',
      roles: [],
      expires_at: 0,
    }),
  })) as unknown as typeof fetch

  await fetchWhoAmI()

  expect(firstFetchUrl()).toBe(`${SERVER_URL}/api/v1/auth/whoami`)
})

test('logout fetches an absolute URL on Electron', async () => {
  global.fetch = jest.fn(async () => ({ ok: true })) as unknown as typeof fetch

  await logout()

  expect(firstFetchUrl()).toBe(`${SERVER_URL}/api/v1/auth/logout`)
})

test('fetchPublicProfiles fetches an absolute URL on Electron', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ profiles: [] }),
  })) as unknown as typeof fetch

  await fetchPublicProfiles()

  expect(firstFetchUrl()).toBe(`${SERVER_URL}/api/v1/profiles/public`)
})

test('onboardProfile fetches an absolute URL on Electron', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      profile_id: 'pid',
      profile_name: 'prod',
      access_token: 'jwt',
      token_type: 'Bearer',
      expires_in: 3600,
    }),
  })) as unknown as typeof fetch

  await onboardProfile({
    name: 'prod',
    dsn: 'quic://prod:3141',
    admin_username: 'alice',
    admin_password: 'pw', // pragma: allowlist secret -- test stub literal
  })

  expect(firstFetchUrl()).toBe(`${SERVER_URL}/api/v1/profiles/onboard`)
})
