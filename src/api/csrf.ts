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
export async function refreshCsrfToken(): Promise<string | null> {
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
// subsequent re-login starts with a fresh token.
export function clearCsrfToken(): void {
  cachedToken = null
}

// resetCsrfTokenForTests is a test-only helper to reset the cache
// between tests. It's exported so the Jest suite can call it from a
// beforeEach without going through the real fetch path.
export function resetCsrfTokenForTests(): void {
  cachedToken = null
}

// isCsrfRequired reports whether a given request method needs a CSRF
// header. Mirrors the server's csrfMiddleware.isSafeMethod check.
export function isCsrfRequired(method: string): boolean {
  const m = method.toUpperCase()
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS'
}
