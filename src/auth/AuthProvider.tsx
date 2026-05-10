// AuthProvider — cookie-mode auth context (SEC-F7 / #62 S3c).
//
// Pre-S3c the context exposed a `token` string read from localStorage.
// Post-S3c the JWT lives in an HttpOnly cookie that the SPA cannot
// see. The context now exposes a boolean `isAuthed` derived from the
// success of login/logout actions, plus the login + logout helpers
// callers used to wire by hand.
//
// On initial mount the provider probes the cookie's existence by
// looking for the cookie name in document.cookie. The auth cookie is
// HttpOnly so it WON'T appear there — instead we use a session-storage
// flag that login() sets and logout() clears as a UI hint. If the
// hint says we're logged in but the server disagrees, the next API
// call will 401 and the caller flips the hint off.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  auth as authStore,
  login as apiLogin,
  logout as apiLogout,
} from '../api/auth'
import { clearCsrfToken, refreshCsrfToken } from '../api/csrf'
import { useConnections, setLatestToken } from '../api/connections'
import { storeSavedPassword } from '../api/electron-bridge'
import { extractRoles } from './jwt-claims'

const AUTH_HINT_KEY = 'geode-ui.session-hint'
// PSR-G09 (#86): persist the roles claim across reloads. The HttpOnly
// cookie carries the JWT (so the server still authenticates the next
// page load), but the SPA cannot read it; without a sessionStorage
// echo the React tree would briefly render with `roles=[]` after every
// reload and admin actions would flicker. The storage cleared on
// logout/setAuthed(false) so a stale roles list never outlives a
// session.
const AUTH_ROLES_KEY = 'geode-ui.session-roles'

function readAuthHint(): boolean {
  try {
    return sessionStorage.getItem(AUTH_HINT_KEY) === '1'
  } catch {
    return false
  }
}

function writeAuthHint(authed: boolean): void {
  try {
    if (authed) sessionStorage.setItem(AUTH_HINT_KEY, '1')
    else sessionStorage.removeItem(AUTH_HINT_KEY)
  } catch {
    /* private-mode browsers throw — best-effort */
  }
}

// PSR-G09 (#86): role persistence helpers. We deliberately store the
// resolved string array (not the raw JWT) so a future widening of the
// JWT shape doesn't require migrating sessionStorage; rotating the
// roles list is a fresh login.
function readStoredRoles(): string[] {
  try {
    const raw = sessionStorage.getItem(AUTH_ROLES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((r): r is string => typeof r === 'string')
  } catch {
    return []
  }
}

function writeStoredRoles(roles: readonly string[] | null): void {
  try {
    if (roles && roles.length > 0) {
      sessionStorage.setItem(AUTH_ROLES_KEY, JSON.stringify([...roles]))
    } else {
      sessionStorage.removeItem(AUTH_ROLES_KEY)
    }
  } catch {
    /* private-mode browsers throw — best-effort */
  }
}

type AuthState = {
  isAuthed: boolean
  // setAuthed lets the API layer mark the SPA logged-out on a 401 from
  // a presumed-authenticated request. Direct mutation rather than
  // login/logout so the call site doesn't trigger a redundant
  // /auth/logout request.
  setAuthed: (a: boolean) => void
  // PSR-G09 (#86): the role list extracted from the JWT's `roles`
  // claim at last login. Empty when logged out or when the cookie
  // existed across a reload but the SPA never saw the access token
  // (the storage echo bridges that gap; see AUTH_ROLES_KEY). Use
  // `hasRole('admin')` for the common authority check rather than
  // hand-rolling `.includes()` so future role-aliasing or wildcards
  // can land in one place.
  roles: readonly string[]
  hasRole: (role: string) => boolean
  isAdmin: boolean
  signIn: (
    username: string,
    password: string,
    profile: string,
    savePassword?: boolean
  ) => Promise<void>
  signOut: () => Promise<void>
  connectMore: (
    username: string,
    password: string,
    profile: string,
    savePassword?: boolean
  ) => Promise<void>
  disconnect: (connectionId: string) => void
  switchActive: (connectionId: string) => void
}

const AuthCtx = createContext<AuthState | null>(null)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const conns = useConnections()
  const [isAuthed, setIsAuthed] = useState<boolean>(readAuthHint())
  // PSR-G09 (#86): `roles` is hydrated from sessionStorage on mount so
  // a page reload immediately renders with the same admin/non-admin
  // posture the user had before the reload. signIn/connectMore
  // refreshes it from the freshly-issued JWT; setAuthed(false) /
  // signOut clears it.
  const [roles, setRoles] = useState<readonly string[]>(() => readStoredRoles())

  const setAuthed = useCallback(
    (authed: boolean) => {
      writeAuthHint(authed)
      setIsAuthed(authed)
      if (!authed) {
        clearCsrfToken()
        conns.clear()
        setLatestToken(null)
        // Drop the role echo so a logged-out tab never carries a stale
        // admin posture into its next session.
        writeStoredRoles(null)
        setRoles([])
      }
    },
    [conns]
  )

  const signIn = useCallback(
    async (
      username: string,
      password: string,
      profile: string,
      savePassword?: boolean
    ): Promise<void> => {
      const result = await apiLogin(username, password, profile)
      // PSR-F10 (#108): apiLogin is on the critical path (the server
      // can't issue a CSRF token before it sets the auth cookie), so
      // it stays serial. Everything that follows is independent of
      // the CSRF round-trip's *response* and can run in parallel:
      //   - refreshCsrfToken (network round-trip to /api/v1/csrf)
      //   - conns.add + setActive + setLatestToken + auth-hint flip
      //     (all synchronous reducer dispatches and module-level
      //     latch writes)
      // Pre-fix awaited refreshCsrfToken before touching the
      // connections state, so the active-connection latch was
      // unnecessarily gated behind one full HTTP round-trip. Post-fix
      // the synchronous state-machine work happens immediately while
      // refreshCsrfToken is in flight; we await the CSRF promise at
      // the end so signIn's resolved promise still implies the CSRF
      // double-submit pair is ready for the first mutation.
      const csrfPromise = refreshCsrfToken()
      conns.add({
        connectionId: result.connection_id,
        token: result.access_token,
        profileName: profile,
        expiresAt: Date.now() + result.expires_in * 1000,
      })
      conns.setActive(result.connection_id)
      setLatestToken(result.access_token)
      writeAuthHint(true)
      setIsAuthed(true)
      // PSR-G09: extract the JWT roles claim so role-gated UI (e.g.
      // ProfilesPage) can render without the previous DSN-visibility
      // heuristic. Persist to sessionStorage so a page reload keeps
      // the same posture (the cookie still authenticates the next
      // request, but JS can't read the cookie).
      const fresh = extractRoles(result.access_token)
      writeStoredRoles(fresh)
      setRoles(fresh)
      // storeSavedPassword is fire-and-forget by design (PSR-F10):
      // it's a best-effort safeStorage write that is safe to background
      // after the SPA hands off control to the post-login route. A
      // failure here is non-fatal — the user can re-enter their
      // password on the next sign-in. Awaiting it would block the
      // login navigation on a synchronous IPC + safeStorage decrypt
      // round-trip that has nothing to do with the auth handshake's
      // success.
      if (savePassword) {
        storeSavedPassword(profile, username, password).catch(() => {
          /* swallow — saved-password write is best-effort */
        })
      }
      // Await the CSRF round-trip so the resolved signIn promise
      // implies "the next mutation has a valid double-submit pair".
      // This call is concurrent with all the synchronous state work
      // above, so it costs at most one HTTP RTT (down from one for
      // CSRF + the storeSavedPassword IPC pre-fix).
      await csrfPromise
    },
    [conns]
  )

  const signOut = useCallback(async (): Promise<void> => {
    await apiLogout()
    authStore.clearToken()
    clearCsrfToken()
    conns.clear()
    setLatestToken(null)
    writeAuthHint(false)
    setIsAuthed(false)
    // PSR-G09: drop the cached roles list on logout so the next
    // login starts from a known-empty role posture.
    writeStoredRoles(null)
    setRoles([])
  }, [conns])

  const connectMore = useCallback(
    async (
      username: string,
      password: string,
      profile: string,
      savePassword?: boolean
    ): Promise<void> => {
      const result = await apiLogin(username, password, profile)
      // PSR-G03 (GitLab #80): the access cookie was just rotated by
      // apiLogin, so the in-memory CSRF latch points at the previous
      // session. Mint a fresh CSRF pair before any subsequent state-
      // changing request can fire — otherwise the next mutation 403s
      // with a stale double-submit cookie/header pair. Mirrors the
      // refreshCsrfToken call that signIn issues on the same line.
      await refreshCsrfToken()
      conns.add({
        connectionId: result.connection_id,
        token: result.access_token,
        profileName: profile,
        expiresAt: Date.now() + result.expires_in * 1000,
      })
      // Do NOT setActive — keep the existing active connection.
      // Do NOT setLatestToken — same reason.
      // Defensive: ensure isAuthed boolean is true.
      writeAuthHint(true)
      setIsAuthed(true)
      // PSR-G09: connectMore mints a fresh JWT (apiLogin above) so the
      // returned token's roles claim is authoritative for the new
      // session. Refresh the role list so a privilege change at the
      // upstream Geode (e.g. user just got the admin role) is reflected
      // without a full re-login.
      const fresh = extractRoles(result.access_token)
      writeStoredRoles(fresh)
      setRoles(fresh)
      if (savePassword) {
        await storeSavedPassword(profile, username, password)
      }
    },
    [conns]
  )

  const disconnect = useCallback(
    (connectionId: string): void => {
      const wasActive = conns.activeId === connectionId
      // Snapshot remaining BEFORE the remove call (Map mutation).
      const remaining = [...conns.connections.values()].filter(
        (c) => c.connectionId !== connectionId
      )
      conns.remove(connectionId)
      if (wasActive) {
        const next = remaining[0]
        if (next) {
          conns.setActive(next.connectionId)
          setLatestToken(next.token)
        } else {
          // Last connection just disconnected — clear latch + legacy
          // cookie + session hint.
          setLatestToken(null)
          apiLogout().catch(() => undefined)
          clearCsrfToken()
          writeAuthHint(false)
          setIsAuthed(false)
        }
      }
    },
    [conns]
  )

  const switchActive = useCallback(
    (connectionId: string): void => {
      const target = conns.connections.get(connectionId)
      if (!target) return
      conns.setActive(connectionId)
      setLatestToken(target.token)
    },
    [conns]
  )

  // On mount, if the hint says we're logged in, refresh the CSRF
  // token so subsequent mutations have one. Skip the network call
  // when the hint says logged out. We deliberately depend only on
  // isAuthed transitioning to true; calling refreshCsrfToken extra
  // times is harmless (it just mints a fresh token).
  useEffect(() => {
    if (!isAuthed) return
    refreshCsrfToken().catch(() => {
      /* swallow — non-fatal, the next mutation will retry */
    })
  }, [isAuthed])

  // PSR-G09: convenience selectors derived from `roles`. `hasRole` is
  // the canonical check; `isAdmin` is a thin wrapper for the
  // overwhelmingly-common admin gate so consumers don't repeat the
  // string literal everywhere.
  const hasRole = useCallback(
    (role: string): boolean => roles.includes(role),
    [roles]
  )
  const isAdmin = roles.includes('admin')

  const value = useMemo<AuthState>(
    () => ({
      isAuthed,
      setAuthed,
      roles,
      hasRole,
      isAdmin,
      signIn,
      signOut,
      connectMore,
      disconnect,
      switchActive,
    }),
    [
      isAuthed,
      setAuthed,
      roles,
      hasRole,
      isAdmin,
      signIn,
      signOut,
      connectMore,
      disconnect,
      switchActive,
    ]
  )
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => {
  const v = useContext(AuthCtx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
