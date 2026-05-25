// eslint-disable-next-line import/no-unresolved
import { createClient } from '@api'
import { resolveBaseUrl } from './baseUrl'
import { getLatestToken, getTokenForConnection } from './connections'
import { getCsrfToken, isCsrfRequired, refreshCsrfToken } from './csrf'

// Re-exported so the existing public surface (resolveBaseUrl imported
// from `./client` in metrics.ts + client.test.ts) keeps working without
// churn. The implementation now lives in `./baseUrl` so `csrf.ts` and
// `auth.ts` can pull the same helper without dragging the generated
// client + the csrf module into a cycle.
export { resolveBaseUrl }

// APP-08 (2026-05-24 appsec): the fetch wrapper accepts an optional
// `connectionId` field on `RequestInit`. Call sites that target a
// specific connection (e.g. profile-scoped reads) plumb the id through
// the init object; the wrapper resolves the bearer via
// `getTokenForConnection(id)` rather than `getLatestToken()`. The
// module-level latch stays as the legacy fallback for call sites that
// don't yet thread a connection id.
type ConnectionScopedInit = RequestInit & { connectionId?: string }

function resolveBearer(init?: ConnectionScopedInit): string | null {
  const id = init?.connectionId
  if (typeof id === 'string' && id.length > 0) {
    const explicit = getTokenForConnection(id)
    if (explicit) return explicit
  }
  return getLatestToken()
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
    const scoped = init as ConnectionScopedInit | undefined
    const method = (init?.method ?? 'GET').toUpperCase()
    const needsCsrf = isCsrfRequired(method)
    let headers = new Headers(init?.headers ?? {})

    // APP-07: cookie-mode is unconditional. When the caller targets a
    // specific connection (init.connectionId — APP-08) or the in-
    // memory latch holds a token, attach it as Bearer. Otherwise
    // strip the generated client's placeholder Authorization so the
    // server falls through to the HttpOnly cookie. The server's
    // AuthJWT prefers the header when both are present.
    const liveToken = resolveBearer(scoped)
    if (liveToken) {
      headers.set('Authorization', 'Bearer ' + liveToken)
    } else {
      headers.delete('Authorization')
    }

    if (needsCsrf) {
      const tok = getCsrfToken()
      if (tok) headers.set('X-CSRF-Token', tok)
    }
    // Strip `connectionId` before handing the init to the native
    // fetch; it is not a valid RequestInit field and Chromium will
    // ignore it, but cleanliness is cheap. Build the passthrough init
    // explicitly to keep eslint's no-unused-vars rule happy without an
    // explicit ignore.
    const passthroughInit: RequestInit = init ? { ...init } : {}
    delete (passthroughInit as ConnectionScopedInit).connectionId
    const reqInit: RequestInit = {
      ...passthroughInit,
      headers,
      credentials: passthroughInit.credentials ?? 'same-origin',
    }
    let res = await native(input, reqInit)
    if (needsCsrf && res.status === 403) {
      // CSRF token may have expired; refresh once and retry.
      const fresh = await refreshCsrfToken()
      if (fresh) {
        headers = new Headers(init?.headers ?? {})
        const live = resolveBearer(scoped)
        if (live) {
          headers.set('Authorization', 'Bearer ' + live)
        } else {
          headers.delete('Authorization')
        }
        headers.set('X-CSRF-Token', fresh)
        res = await native(input, { ...reqInit, headers })
      }
    }
    return res
  }
}

// Test-only seam — exposed so `src/api/client.test.ts` can exercise
// the wrapper without standing up the genapi-generated client. Never
// import from production code (the `client` singleton below already
// uses the wrapper via its `fetchImpl` option).
export const makeFetchImplForTests = makeFetchImpl

export const client = createClient({
  baseUrl: resolveBaseUrl(),
  // APP-07: cookie-mode is unconditional. The generated client refuses
  // to send a request without a non-empty bearer; hand it a placeholder
  // that the fetchImpl wrapper strips before the request leaves the
  // SPA. The server reads the JWT from the HttpOnly cookie instead.
  bearerToken: () => COOKIE_MODE_PLACEHOLDER,
  fetchImpl: makeFetchImpl(),
})
