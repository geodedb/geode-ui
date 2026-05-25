// Tests for the SPA CSRF helper (SEC-F7 / #62 S3c).
import type { GeodeBridge } from '../types/electron'
import {
  clearCsrfToken,
  getCsrfToken,
  isCsrfRequired,
  readCsrfCookie,
  refreshCsrfToken,
  resetCsrfTokenForTests,
} from './csrf'

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

const realFetch = global.fetch

beforeEach(() => {
  resetCsrfTokenForTests()
  // Clear cookies between tests — jsdom retains them per document.
  document.cookie =
    'geode-ui-csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
})

afterEach(() => {
  global.fetch = realFetch
  setBridge(undefined)
})

// Regression for the Electron login bug: a bare relative URL resolves
// against the geode:// origin and hits the SPA-fallback branch of the
// custom protocol handler, which returns `index.html` rather than the
// CSRF JSON. Under Electron the fetch URL must be the absolute form
// against the bridge-supplied server origin.
test('refreshCsrfToken targets the bridge-supplied origin on Electron', async () => {
  setBridge('http://localhost:9999')
  const fetchMock = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ token: 'tok' }),
    } as unknown as Response)
  )
  global.fetch = fetchMock as unknown as typeof fetch
  await refreshCsrfToken()
  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:9999/api/v1/csrf',
    expect.objectContaining({ method: 'GET' })
  )
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
    'http://localhost/api/v1/csrf',
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

// PERF #257: when the CSRF cookie expires every in-flight mutation
// gets a 403, and each of those mutations independently calls
// refreshCsrfToken(). Without dedup that's N concurrent /api/v1/csrf
// fetches for the same effect (the server mints a new token and the
// caller only needs one). The fix wraps refreshCsrfToken in a
// singleflight: concurrent callers share the same in-flight Promise,
// so the underlying fetch is issued at most once per refresh window.
test('refreshCsrfToken deduplicates concurrent callers (singleflight)', async () => {
  let resolveFetch: (value: Response) => void = () => {}
  const fetchMock = jest.fn(
    () =>
      new Promise<Response>((res) => {
        resolveFetch = res
      })
  )
  global.fetch = fetchMock as unknown as typeof fetch

  // Fire five concurrent refresh requests BEFORE resolving the
  // pending fetch. All five should share the same in-flight Promise
  // and the underlying fetch should be invoked exactly once.
  const refreshes = [
    refreshCsrfToken(),
    refreshCsrfToken(),
    refreshCsrfToken(),
    refreshCsrfToken(),
    refreshCsrfToken(),
  ]
  // Resolve the singleton fetch.
  resolveFetch({
    ok: true,
    json: () => Promise.resolve({ token: 'singleflight-tok' }),
  } as unknown as Response)
  const results = await Promise.all(refreshes)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  // Every caller observes the same token.
  results.forEach((tok) => {
    expect(tok).toBe('singleflight-tok')
  })
  expect(getCsrfToken()).toBe('singleflight-tok')
})

test('refreshCsrfToken singleflight resets after settle (next call re-fetches)', async () => {
  // First call mints token A.
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ token: 'tok-A' }),
    } as unknown as Response)
  ) as unknown as typeof fetch
  expect(await refreshCsrfToken()).toBe('tok-A')

  // Second call (after the first settled) mints token B — a singleflight
  // window leaking across settle would still return 'tok-A'.
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ token: 'tok-B' }),
    } as unknown as Response)
  ) as unknown as typeof fetch
  expect(await refreshCsrfToken()).toBe('tok-B')
})
