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

const AUTH_HINT_KEY = 'geode-ui.session-hint'

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

type AuthState = {
  isAuthed: boolean
  // setAuthed lets the API layer mark the SPA logged-out on a 401 from
  // a presumed-authenticated request. Direct mutation rather than
  // login/logout so the call site doesn't trigger a redundant
  // /auth/logout request.
  setAuthed: (a: boolean) => void
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

  const setAuthed = useCallback(
    (authed: boolean) => {
      writeAuthHint(authed)
      setIsAuthed(authed)
      if (!authed) {
        clearCsrfToken()
        conns.clear()
        setLatestToken(null)
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
      // After login the server set the auth cookie. Mint a CSRF token
      // so the first state-changing request has the matching pair.
      await refreshCsrfToken()
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
      if (savePassword) {
        await storeSavedPassword(profile, username, password)
      }
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

  const value = useMemo<AuthState>(
    () => ({
      isAuthed,
      setAuthed,
      signIn,
      signOut,
      connectMore,
      disconnect,
      switchActive,
    }),
    [
      isAuthed,
      setAuthed,
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
