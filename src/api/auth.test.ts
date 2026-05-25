// Tests for the cookie-mode auth helper (SEC-F7 / #62 S3c).
// APP-07 retired the legacy-bearer-token backout flag — cookie-mode is
// now unconditional. The legacy flag, the legacy token storage, and the
// auth.{getToken,clearToken,isLegacyMode} surface no longer exist.
import { auth, fetchPublicProfiles, login, logout } from './auth'

const realFetch = global.fetch

beforeEach(() => {
  localStorage.clear()
  // Clear the CSRF cookie jsdom retains across tests.
  document.cookie =
    'geode-ui-csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
})

afterEach(() => {
  global.fetch = realFetch
})

test('auth has no getToken / clearToken / isLegacyMode surface', () => {
  // APP-07: the legacy bearer-token surface was retired. The flag,
  // the localStorage token slot, and the auth.{getToken,clearToken,
  // isLegacyMode} helpers must not exist on the public surface so a
  // future caller cannot accidentally re-introduce the JS-readable
  // JWT exfil channel SEC-F7 closed.
  const surface = auth as unknown as Record<string, unknown>
  expect(surface.getToken).toBeUndefined()
  expect(surface.clearToken).toBeUndefined()
  expect(surface.isLegacyMode).toBeUndefined()
})

test('auth.setProfile + getProfile round-trip', () => {
  expect(auth.getProfile()).toBe('default')
  auth.setProfile('prod')
  expect(auth.getProfile()).toBe('prod')
})

test('login posts credentials and returns the parsed body', async () => {
  const fetchMock = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'jwt-here',
          token_type: 'Bearer',
          expires_in: 3600,
          connection_id: 'mock-cid',
        }),
    } as unknown as Response)
  )
  global.fetch = fetchMock as unknown as typeof fetch
  const r = await login('alice', 'p', 'default')
  expect(r.access_token).toBe('jwt-here')
  // resolveBaseUrl() returns window.location.origin in jsdom
  // (http://localhost). Pre-fix the URL was the bare relative path;
  // post-fix every auth fetch goes through apiUrl(), which prepends
  // the bridge/browser origin so the Electron renderer (running under
  // a geode:// origin) hits the real geode-ui server.
  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost/api/v1/auth/login',
    expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
    })
  )
})

test('login does NOT write the token to localStorage (cookie-mode is unconditional)', async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'jwt-here',
          token_type: 'Bearer',
          expires_in: 3600,
          connection_id: 'mock-cid',
        }),
    } as unknown as Response)
  ) as unknown as typeof fetch
  await login('alice', 'p', 'default')
  // Cookie mode is unconditional after APP-07: localStorage must never
  // retain the JWT regardless of the (now-retired) legacy flag.
  expect(localStorage.getItem('geode-ui.access_token')).toBeNull()
})

test('login ignores the retired legacy-auth flag', async () => {
  // APP-07: setting the old escape-hatch flag must NOT re-enable the
  // bearer-token branch. localStorage stays clean even if the flag is
  // somehow present (left over from a previous build, or set by a
  // compromised renderer that does not yet know the flag was retired).
  localStorage.setItem('geode-ui.legacy-auth', '1')
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'jwt-here',
          token_type: 'Bearer',
          expires_in: 3600,
          connection_id: 'mock-cid',
        }),
    } as unknown as Response)
  ) as unknown as typeof fetch
  await login('alice', 'p', 'default')
  expect(localStorage.getItem('geode-ui.access_token')).toBeNull()
})

test('login throws on non-OK response', async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error_description: 'bad credentials' }),
    } as unknown as Response)
  ) as unknown as typeof fetch
  await expect(login('alice', 'wrong', 'default')).rejects.toThrow(
    /bad credentials/
  )
})

test('logout posts to the server (no legacy storage to clear)', async () => {
  const fetchMock = jest.fn(() =>
    Promise.resolve({ ok: true } as unknown as Response)
  )
  global.fetch = fetchMock as unknown as typeof fetch
  await logout()
  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost/api/v1/auth/logout',
    expect.objectContaining({ method: 'POST', credentials: 'same-origin' })
  )
})

test('logout swallows network errors (best effort)', async () => {
  global.fetch = jest.fn(() =>
    Promise.reject(new Error('net'))
  ) as unknown as typeof fetch
  await expect(logout()).resolves.toBeUndefined()
})

test('fetchPublicProfiles parses the body', async () => {
  const orig = global.fetch
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      profiles: [{ name: 'prod' }, { name: 'staging', description: 's' }],
    }),
  })) as unknown as typeof fetch
  try {
    const got = await fetchPublicProfiles()
    expect(got).toEqual([
      { name: 'prod' },
      { name: 'staging', description: 's' },
    ])
  } finally {
    global.fetch = orig
  }
})

test('fetchPublicProfiles throws on non-ok status', async () => {
  const orig = global.fetch
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 503,
    json: async () => ({}),
  })) as unknown as typeof fetch
  try {
    await expect(fetchPublicProfiles()).rejects.toThrow(/503/)
  } finally {
    global.fetch = orig
  }
})
