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
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error_description || `login failed (${res.status})`)
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
