// Tests for the SPA CSRF helper (SEC-F7 / #62 S3c).
import {
  clearCsrfToken,
  getCsrfToken,
  isCsrfRequired,
  readCsrfCookie,
  refreshCsrfToken,
  resetCsrfTokenForTests,
} from './csrf'

const realFetch = global.fetch

beforeEach(() => {
  resetCsrfTokenForTests()
  // Clear cookies between tests — jsdom retains them per document.
  document.cookie =
    'geode-ui-csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
})

afterEach(() => {
  global.fetch = realFetch
})

test('readCsrfCookie returns null when no cookie is set', () => {
  expect(readCsrfCookie()).toBeNull()
})

test('readCsrfCookie reads the geode-ui-csrf value', () => {
  document.cookie = 'geode-ui-csrf=abcdef; path=/'
  expect(readCsrfCookie()).toBe('abcdef')
})

test('readCsrfCookie ignores unrelated cookies', () => {
  document.cookie = 'other=value; path=/'
  expect(readCsrfCookie()).toBeNull()
})

test('readCsrfCookie URL-decodes the value', () => {
  document.cookie = 'geode-ui-csrf=%2Bsigned%2B; path=/'
  expect(readCsrfCookie()).toBe('+signed+')
})

test('isCsrfRequired returns true for unsafe methods', () => {
  expect(isCsrfRequired('POST')).toBe(true)
  expect(isCsrfRequired('PUT')).toBe(true)
  expect(isCsrfRequired('PATCH')).toBe(true)
  expect(isCsrfRequired('DELETE')).toBe(true)
  expect(isCsrfRequired('post')).toBe(true)
})

test('isCsrfRequired returns false for safe methods', () => {
  expect(isCsrfRequired('GET')).toBe(false)
  expect(isCsrfRequired('HEAD')).toBe(false)
  expect(isCsrfRequired('OPTIONS')).toBe(false)
})

test('refreshCsrfToken parses the body token and caches it', async () => {
  const fetchMock = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ token: 'fresh-token' }),
    } as unknown as Response)
  )
  global.fetch = fetchMock as unknown as typeof fetch
  const tok = await refreshCsrfToken()
  expect(tok).toBe('fresh-token')
  expect(getCsrfToken()).toBe('fresh-token')
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/v1/csrf',
    expect.objectContaining({ method: 'GET' })
  )
})

test('refreshCsrfToken returns null on non-OK response', async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: false,
      json: () => Promise.resolve({}),
    } as unknown as Response)
  ) as unknown as typeof fetch
  const tok = await refreshCsrfToken()
  expect(tok).toBeNull()
  expect(getCsrfToken()).toBeNull()
})

test('refreshCsrfToken returns null on network error', async () => {
  global.fetch = jest.fn(() =>
    Promise.reject(new Error('net'))
  ) as unknown as typeof fetch
  const tok = await refreshCsrfToken()
  expect(tok).toBeNull()
})

test('getCsrfToken falls back to the cookie when cache is empty', () => {
  document.cookie = 'geode-ui-csrf=cookieval; path=/'
  expect(getCsrfToken()).toBe('cookieval')
})

test('clearCsrfToken empties the cache', async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ token: 'will-clear' }),
    } as unknown as Response)
  ) as unknown as typeof fetch
  await refreshCsrfToken()
  expect(getCsrfToken()).toBe('will-clear')
  clearCsrfToken()
  // After clear: cache is null. With no cookie set, getCsrfToken
  // returns null. (jsdom clears cookies on the path/expires header
  // we used in beforeEach.)
  expect(getCsrfToken()).toBeNull()
})
