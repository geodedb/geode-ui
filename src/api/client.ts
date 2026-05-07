// eslint-disable-next-line import/no-unresolved
import { createClient } from '@api'
import { auth } from './auth'
import { getCsrfToken, isCsrfRequired, refreshCsrfToken } from './csrf'

function resolveBaseUrl(): string {
  if (
    typeof window !== 'undefined' &&
    window.location &&
    window.location.origin
  ) {
    return window.location.origin
  }
  return 'http://localhost'
}

// makeFetchImpl wraps the global fetch with two cross-cutting concerns
// (SEC-F7 / #62 S3c):
//
//   1. credentials: 'same-origin' (the default for same-origin fetches
//      already, but we set it explicitly so the cookie path is
//      independent of any host that overrides the global default).
//   2. X-CSRF-Token header injection on state-changing requests. The
//      generated client does not know about CSRF; it is wrapped here
//      so the server's csrfMiddleware sees the matching pair.
//
// On a 403 from a state-changing request we attempt one auto-refresh
// of the CSRF token and retry. This handles the case where the cookie
// expired between page load and the next mutation.
function makeFetchImpl(): typeof fetch {
  const native = fetch.bind(globalThis)
  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const needsCsrf = isCsrfRequired(method)
    let headers = new Headers(init?.headers ?? {})
    if (needsCsrf) {
      const tok = getCsrfToken()
      if (tok) headers.set('X-CSRF-Token', tok)
    }
    const reqInit: RequestInit = {
      ...init,
      headers,
      credentials: init?.credentials ?? 'same-origin',
    }
    let res = await native(input, reqInit)
    if (needsCsrf && res.status === 403) {
      // CSRF token may have expired; refresh once and retry. This is a
      // recoverable failure mode for long-lived SPA sessions.
      const fresh = await refreshCsrfToken()
      if (fresh) {
        headers = new Headers(init?.headers ?? {})
        headers.set('X-CSRF-Token', fresh)
        res = await native(input, { ...reqInit, headers })
      }
    }
    return res
  }
}

export const client = createClient({
  baseUrl: resolveBaseUrl(),
  // Bearer token is only present in legacy backout mode (SEC-F7 backout
  // flag). In normal cookie-mode operation auth.getToken() returns null
  // and the bearer header is not attached — the cookie carries the JWT
  // instead.
  bearerToken: () => auth.getToken() ?? '',
  fetchImpl: makeFetchImpl(),
})
