// Tests for the cookie-mode auth helper (SEC-F7 / #62 S3c).
import { auth, login, logout } from './auth'

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

test('auth.getToken returns null in cookie mode (default)', () => {
  // No legacy flag: cookie-mode is the default. The token never flows
  // through localStorage so getToken returns null.
  localStorage.setItem('geode-ui.access_token', 'should-be-ignored')
  expect(auth.getToken()).toBeNull()
})

test('auth.getToken returns stored token when legacy flag is set', () => {
  localStorage.setItem('geode-ui.legacy-auth', '1')
  localStorage.setItem('geode-ui.access_token', 'legacy-token')
  expect(auth.getToken()).toBe('legacy-token')
})

test('auth.clearToken removes the legacy bearer token', () => {
  localStorage.setItem('geode-ui.legacy-auth', '1')
  localStorage.setItem('geode-ui.access_token', 'legacy-token')
  expect(auth.getToken()).toBe('legacy-token')
  auth.clearToken()
  expect(auth.getToken()).toBeNull()
})

test('auth.setProfile + getProfile round-trip', () => {
  expect(auth.getProfile()).toBe('default')
  auth.setProfile('prod')
  expect(auth.getProfile()).toBe('prod')
})

test('auth.isLegacyMode returns false by default', () => {
  expect(auth.isLegacyMode()).toBe(false)
})

test('auth.isLegacyMode returns true when flag is set', () => {
  localStorage.setItem('geode-ui.legacy-auth', '1')
  expect(auth.isLegacyMode()).toBe(true)
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
        }),
    } as unknown as Response)
  )
  global.fetch = fetchMock as unknown as typeof fetch
  const r = await login('alice', 'p', 'default')
  expect(r.access_token).toBe('jwt-here')
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/v1/auth/login',
    expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
    })
  )
})

test('login does NOT write the token to localStorage in cookie mode', async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'jwt-here',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
    } as unknown as Response)
  ) as unknown as typeof fetch
  await login('alice', 'p', 'default')
  // Cookie mode (no legacy flag): localStorage must not retain the JWT.
  expect(localStorage.getItem('geode-ui.access_token')).toBeNull()
})

test('login writes the token to localStorage in legacy mode', async () => {
  localStorage.setItem('geode-ui.legacy-auth', '1')
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'jwt-here',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
    } as unknown as Response)
  ) as unknown as typeof fetch
  await login('alice', 'p', 'default')
  expect(localStorage.getItem('geode-ui.access_token')).toBe('jwt-here')
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

test('logout posts to the server and clears legacy storage', async () => {
  localStorage.setItem('geode-ui.legacy-auth', '1')
  localStorage.setItem('geode-ui.access_token', 'legacy-token')
  const fetchMock = jest.fn(() =>
    Promise.resolve({ ok: true } as unknown as Response)
  )
  global.fetch = fetchMock as unknown as typeof fetch
  await logout()
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/v1/auth/logout',
    expect.objectContaining({ method: 'POST', credentials: 'same-origin' })
  )
  expect(localStorage.getItem('geode-ui.access_token')).toBeNull()
})

test('logout swallows network errors (best effort)', async () => {
  global.fetch = jest.fn(() =>
    Promise.reject(new Error('net'))
  ) as unknown as typeof fetch
  await expect(logout()).resolves.toBeUndefined()
})
