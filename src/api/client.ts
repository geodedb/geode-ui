// eslint-disable-next-line import/no-unresolved
import { createClient } from '@api'
import { auth } from './auth'
import { getLatestToken } from './connections'
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
// COOKIE_MODE_PLACEHOLDER satisfies the generated client's non-empty
// bearer-token guard (gen/client/react/client.ts: `if (!token) throw
// new Error("missing bearer token")`). The wrapper strips the resulting
// Authorization header before the request leaves the SPA — the server
// reads the JWT from the geode-ui-auth cookie instead. The structural
// fix belongs in genapi (cookie-auth as a first-class auth mode);
// tracked as the genapi follow-up to SEC-F7.
const COOKIE_MODE_PLACEHOLDER = '__cookie_mode_placeholder__'

function makeFetchImpl(): typeof fetch {
  const native = fetch.bind(globalThis)
  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const needsCsrf = isCsrfRequired(method)
    let headers = new Headers(init?.headers ?? {})

    // Plan B: when an in-memory active connection has a token, attach
    // it as Bearer. The cookie path still works in parallel; the
    // server's AuthJWT prefers the header when both are present.
    const liveToken = getLatestToken()
    if (liveToken) {
      headers.set('Authorization', 'Bearer ' + liveToken)
    } else if (!auth.getToken()) {
      // Cookie-mode (no in-memory token, no legacy bearer): strip the
      // generated client's placeholder Authorization so the server
      // falls through to the cookie.
      headers.delete('Authorization')
    }

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
      // CSRF token may have expired; refresh once and retry.
      const fresh = await refreshCsrfToken()
      if (fresh) {
        headers = new Headers(init?.headers ?? {})
        const live = getLatestToken()
        if (live) {
          headers.set('Authorization', 'Bearer ' + live)
        } else if (!auth.getToken()) {
          headers.delete('Authorization')
        }
        headers.set('X-CSRF-Token', fresh)
        res = await native(input, { ...reqInit, headers })
      }
    }
    return res
  }
}

export const client = createClient({
  baseUrl: resolveBaseUrl(),
  // In cookie-mode auth.getToken() is null; the generated client refuses
  // to send a request without a non-empty bearer, so we hand it a
  // placeholder that the fetchImpl wrapper strips before the request
  // leaves the SPA. In legacy backout mode the real JWT flows through
  // and the Authorization header is kept.
  bearerToken: () => auth.getToken() ?? COOKIE_MODE_PLACEHOLDER,
  fetchImpl: makeFetchImpl(),
})
