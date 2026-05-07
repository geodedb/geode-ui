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
  signIn: (username: string, password: string, profile: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthCtx = createContext<AuthState | null>(null)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isAuthed, setIsAuthed] = useState<boolean>(readAuthHint())

  const setAuthed = useCallback((authed: boolean) => {
    writeAuthHint(authed)
    setIsAuthed(authed)
    if (!authed) clearCsrfToken()
  }, [])

  const signIn = useCallback(
    async (
      username: string,
      password: string,
      profile: string
    ): Promise<void> => {
      await apiLogin(username, password, profile)
      // After login the server set the auth cookie. Mint a CSRF token
      // so the first state-changing request has the matching pair.
      await refreshCsrfToken()
      writeAuthHint(true)
      setIsAuthed(true)
    },
    []
  )

  const signOut = useCallback(async (): Promise<void> => {
    await apiLogout()
    authStore.clearToken()
    clearCsrfToken()
    writeAuthHint(false)
    setIsAuthed(false)
  }, [])

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
    () => ({ isAuthed, setAuthed, signIn, signOut }),
    [isAuthed, setAuthed, signIn, signOut]
  )
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => {
  const v = useContext(AuthCtx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
