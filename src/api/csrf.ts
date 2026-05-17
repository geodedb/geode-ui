// CSRF token management for the SPA (SEC-F7 / #62 S3c).
//
// The server's GET /api/v1/csrf endpoint returns a fresh token in both
// the response body and a NON-HttpOnly cookie. The SPA reads the
// cookie and echoes it on the X-CSRF-Token header for every
// state-changing request. The server compares the header to the cookie
// via a constant-time compare; mismatch -> 403.
//
// We cache the token in module memory after the first read so we
// don't re-fetch on every request. On a 403 the caller can call
// refreshCsrfToken() to mint a new one.

const CSRF_COOKIE_NAME = 'geode-ui-csrf'
const CSRF_ENDPOINT = '/api/v1/csrf'

let cachedToken: string | null = null

// PERF #257: singleflight Promise for the in-flight refresh. When the
// CSRF cookie expires, every concurrent mutation gets a 403 and each
// calls refreshCsrfToken(). Without this guard we'd issue N parallel
// /api/v1/csrf fetches for the same effect. The promise is set on the
// first call, returned to every concurrent caller, and cleared in a
// finally{} so the *next* refresh window (after settle) does fetch
// again. Sharing the Promise reference means all callers see the same
// token (or null) without any extra coordination.
let inflightRefresh: Promise<string | null> | null = null

// readCsrfCookie pulls the CSRF token out of document.cookie. Returns
// null when no cookie is present (e.g. before /api/v1/csrf has been
// fetched on this session).
export function readCsrfCookie(): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null
  const found = document.cookie.split(';').find((part) => {
    const eq = part.indexOf('=')
    if (eq < 0) return false
    return part.slice(0, eq).trim() === CSRF_COOKIE_NAME
  })
  if (!found) return null
  const eq = found.indexOf('=')
  const v = found.slice(eq + 1).trim()
  if (!v) return null
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

// refreshCsrfToken fetches a new token from the server, updates the
// in-memory cache, and returns the value. The SPA calls this once
// after login (so the first state-changing request has a token) and
// again on any 403 that might indicate an expired CSRF.
//
// PERF #257: concurrent callers (e.g. N in-flight mutations that all
// just received a 403) share a single in-flight refresh via
// inflightRefresh. The actual fetch fires at most once per refresh
// window; the in-flight Promise is cleared in finally{} so the next
// caller after settle does refresh again. This eliminates the
// thundering-herd /api/v1/csrf load when the cookie expires mid-burst.
export function refreshCsrfToken(): Promise<string | null> {
  if (inflightRefresh) return inflightRefresh
  inflightRefresh = doRefreshCsrfToken().finally(() => {
    inflightRefresh = null
  })
  return inflightRefresh
}

async function doRefreshCsrfToken(): Promise<string | null> {
  try {
    const res = await fetch(CSRF_ENDPOINT, {
      method: 'GET',
      credentials: 'same-origin',
    })
    if (!res.ok) {
      cachedToken = null
      return null
    }
    const body = (await res.json().catch(() => ({}))) as {
      token?: string
    }
    cachedToken = body.token ?? readCsrfCookie()
    return cachedToken
  } catch {
    cachedToken = null
    return null
  }
}

// getCsrfToken returns the current token without forcing a network
// fetch. Prefers the in-memory cache; falls back to the cookie
// (covering page-reload-after-login where the cache is empty but the
// browser still has the cookie). Returns null when neither source has
// it; callers should refreshCsrfToken() in that case.
export function getCsrfToken(): string | null {
  if (cachedToken) return cachedToken
  const fromCookie = readCsrfCookie()
  if (fromCookie) {
    cachedToken = fromCookie
    return fromCookie
  }
  return null
}

// clearCsrfToken empties the in-memory cache. Called on logout so a
// subsequent re-login starts with a fresh token. Does NOT cancel an
// in-flight refresh — if logout races with a refresh the resolved
// token will land in `cachedToken` after this returns; the next
// getCsrfToken() call still sees it. Operators that want a hard
// reset should call refreshCsrfToken() post-logout to mint a new one.
export function clearCsrfToken(): void {
  cachedToken = null
}

// resetCsrfTokenForTests is a test-only helper to reset the cache
// between tests. It's exported so the Jest suite can call it from a
// beforeEach without going through the real fetch path. Also clears
// the singleflight in-flight reference so a test that aborted mid-
// refresh doesn't poison the next test.
export function resetCsrfTokenForTests(): void {
  cachedToken = null
  inflightRefresh = null
}

// isCsrfRequired reports whether a given request method needs a CSRF
// header. Mirrors the server's csrfMiddleware.isSafeMethod check.
export function isCsrfRequired(method: string): boolean {
  const m = method.toUpperCase()
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS'
}
