// Cookie-based authentication module (SEC-F7 / #62 S3c).
//
// Prior to S3c the SPA stored the JWT in localStorage and attached it
// as `Authorization: Bearer ...` on every fetch. That left the token
// reachable to any DOM-XSS — an inline script, a third-party widget,
// or a malicious npm transitive dependency could read it.
//
// Post S3c the SPA carries no token in JS-readable storage. The
// server's Login (handlers_auth.go) sets an HttpOnly + SameSite=Strict
// cookie `geode-ui-auth=<jwt>`, which the browser attaches to every
// same-origin request automatically. The SPA's auth signal becomes a
// client-side boolean derived from successful login + logout actions
// and verified via the server's auth-protected endpoints (a 401
// resets the boolean).
//
// Profile selection (which upstream Geode profile to authenticate
// against) is NOT a secret and remains in localStorage — losing it
// across reloads would just degrade UX, not security.
//
// Backout flag: setting `localStorage['geode-ui.legacy-auth'] = '1'`
// reactivates the legacy bearer token storage. Only intended as an
// emergency escape hatch for an operator chasing a regression while
// the cookie path is being rolled out — production traffic should
// never use this. The bearer token storage is only populated when
// the flag is set; otherwise getLegacyToken() returns null and the
// client + queryStream omit the Authorization header (cookie wins).

const PROFILE_KEY = 'geode-ui.profile'
const LEGACY_FLAG_KEY = 'geode-ui.legacy-auth'
const LEGACY_TOKEN_KEY = 'geode-ui.access_token'

export type LoginResult = {
  access_token: string
  token_type: string
  expires_in: number
  connection_id: string
}

export async function login(
  username: string,
  password: string,
  profile: string
): Promise<LoginResult> {
  const body = new URLSearchParams({ username, password, profile })
  const res = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    credentials: 'same-origin',
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string
      error_description?: string
      message?: string
    }
    // genapi's writeJSONError emits the body as {"error": "..."}; legacy
    // OAuth-style handlers used {"error_description": "..."}; some
    // future shim may use {"message": "..."}. Try all of them before
    // falling back to the bare status code so the operator gets the
    // specific server message ("password: too short" / "username: too
    // short" / rate-limit text) instead of an opaque "login failed
    // (400)".
    const detail = err.error || err.error_description || err.message
    throw new Error(detail || `login failed (${res.status})`)
  }
  const result = (await res.json()) as LoginResult
  // Legacy backout: if the operator has flipped the flag, also write
  // the token to localStorage so the bearer-header path keeps working.
  // Production traffic with the flag unset takes the cookie path that
  // the server already wrote in its Set-Cookie response.
  if (isLegacyMode()) {
    try {
      localStorage.setItem(LEGACY_TOKEN_KEY, result.access_token)
    } catch {
      /* localStorage may be unavailable (private mode); fall through */
    }
  }
  return result
}

// WhoAmIResult mirrors the server-side WhoAmIResponse shape.
//
// Bug 2 (2026-05-21 bug-fix bundle): cookie-driven session rehydration
// payload. Lets the SPA bootstrap reconstruct a ConnectionState after
// a browser refresh without echoing the JWT into JS-readable storage.
export type WhoAmIResult = {
  sub: string
  profile: string
  roles: string[]
  /** Unix seconds (server stamp). */
  expires_at: number
  /** May be empty for legacy single-session tokens. */
  connection_id?: string
}

/**
 * fetchWhoAmI asks the server "do I have a valid session?" using
 * whatever transport the browser carries — typically the HttpOnly
 * `geode-ui-auth` cookie. Returns the claims on success or `null` on
 * any 4xx/5xx (including the canonical 401 for "no token / expired
 * token"). The SPA bootstrap path uses this to decide whether to
 * synthesise an in-memory ConnectionState after a reload.
 *
 * Does NOT throw on 401 — the function distinguishes "authenticated"
 * (truthy result) from "not authenticated" (null) at the type level
 * so callers can branch without try/catch noise.
 */
export async function fetchWhoAmI(): Promise<WhoAmIResult | null> {
  try {
    const res = await fetch('/api/v1/auth/whoami', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    return (await res.json()) as WhoAmIResult
  } catch {
    return null
  }
}

// logout calls the server-side /api/v1/auth/logout to clear the cookie
// and removes any legacy localStorage token. Idempotent — safe to call
// when already logged out.
export async function logout(): Promise<void> {
  try {
    // CSRF header is required for cookie-authenticated state-changing
    // requests, but auth/logout is exempted on the server side because
    // a client that has lost its CSRF token must still be able to
    // clear its session. Sending the header if we have one is harmless.
    const csrf = readCsrfCookie()
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: csrf ? { 'X-CSRF-Token': csrf } : {},
    })
  } catch {
    /* best-effort — even on network failure we clear local state below */
  }
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY)
  } catch {
    /* private-mode browsers throw on access; continue */
  }
}

function isLegacyMode(): boolean {
  try {
    return localStorage.getItem(LEGACY_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null
  const found = document.cookie.split(';').find((part) => {
    const eq = part.indexOf('=')
    if (eq < 0) return false
    return part.slice(0, eq).trim() === 'geode-ui-csrf'
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

export type PublicProfile = {
  name: string
  description?: string
}

// fetchPublicProfiles asks the server for the bootstrap profile list
// (system-scope only, no auth required). Used by LoginPage to render
// the profile picker before the user has any active connection.
//
// Direct fetch (NOT through `client`) — the generated client's
// bearer-token guard short-circuits when no token is present, but
// this endpoint is unauthenticated and we shouldn't drag a fake
// Authorization header along.
export async function fetchPublicProfiles(): Promise<PublicProfile[]> {
  const res = await fetch('/api/v1/profiles/public', {
    method: 'GET',
    credentials: 'omit',
  })
  if (!res.ok) {
    throw new Error(`fetchPublicProfiles: ${res.status}`)
  }
  const body = (await res.json()) as { profiles?: PublicProfile[] }
  return body.profiles ?? []
}

export interface OnboardRequest {
  name: string
  dsn: string
  description?: string
  admin_username: string
  admin_password: string
}

export interface OnboardResponse {
  profile_id: string
  profile_name: string
  access_token: string
  token_type: string
  expires_in: number
  connection_id?: string
}

/**
 * onboardProfile creates a new system-scope profile against the
 * unauthenticated POST /api/v1/profiles/onboard endpoint. The server
 * validates the supplied admin credentials against the supplied DSN
 * before persisting; on success it returns a JWT so the SPA can roll
 * straight into an authenticated session.
 *
 * Direct fetch (NOT through the generated `client`) — the endpoint is
 * unauthenticated, so dragging the bearer-token guard along is wrong.
 */
export async function onboardProfile(
  req: OnboardRequest
): Promise<OnboardResponse> {
  const res = await fetch('/api/v1/profiles/onboard', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string
      error_description?: string
    }
    const detail = err.error_description || err.error
    throw new Error(detail || `onboardProfile failed (${res.status})`)
  }
  return (await res.json()) as OnboardResponse
}

export const auth = {
  // getToken returns the legacy bearer token only when the operator
  // has explicitly enabled the backout flag. In normal cookie-mode
  // operation it returns null; the cookie carries the JWT instead.
  getToken(): string | null {
    if (!isLegacyMode()) return null
    try {
      return localStorage.getItem(LEGACY_TOKEN_KEY)
    } catch {
      return null
    }
  },
  // clearToken removes the legacy bearer-token entry; harmless when
  // already absent. Called on logout for defense-in-depth.
  clearToken(): void {
    try {
      localStorage.removeItem(LEGACY_TOKEN_KEY)
    } catch {
      /* private-mode: ignore */
    }
  },
  setProfile(p: string) {
    try {
      localStorage.setItem(PROFILE_KEY, p)
    } catch {
      /* private-mode: ignore */
    }
  },
  getProfile(): string {
    try {
      return localStorage.getItem(PROFILE_KEY) || 'default'
    } catch {
      return 'default'
    }
  },
  // isLegacyMode is exposed for tests + the queryStream / client
  // adapters that need to decide whether to attach a bearer token to
  // a request.
  isLegacyMode,
}
