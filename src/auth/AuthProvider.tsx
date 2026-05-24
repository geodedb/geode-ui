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
import { login as apiLogin, logout as apiLogout } from '../api/auth'
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
    savePassword?: boolean,
    // 2026-05-22 bug-fix: when the caller (the ConnectionSwitcher →
    // AddConnectionModal flow) wants the freshly-connected profile to
    // become the active one, the activation MUST happen inside
    // performAuth's synchronous post-dispatch tick — calling
    // `switchActive(newId)` from the submit handler instead races a
    // stale React reducer snapshot (the closed-over `conns.connections`
    // predates the `add` dispatch) and silently no-ops. See
    // AddConnectionModal.activation.test.tsx.
    activate?: boolean
  ) => Promise<string>
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

  // activateConnection centralises every side-effect that "this
  // connection is now active" must produce: flip the reducer pointer,
  // update the module-level token latch (for the fetch wrapper), and
  // drop QueryPage's cross-route memory so the previous profile's
  // editor + submitted statement + cached result cannot bleed
  // through. Both performAuth (signIn always; connectMore when
  // activate=true) and switchActive call into this helper so the
  // two paths cannot drift apart — and so a future side-effect
  // (telemetry, focus, route reset) only needs to be added in one
  // place.
  //
  // Caller contract: the connection must already be present in the
  // reducer's byId map at the time of dispatch — either because the
  // caller just dispatched `add` for it (performAuth) or because
  // switchActive's guard read already confirmed it. We deliberately
  // accept the token as an explicit argument rather than re-reading
  // it from `conns.connections.get(connectionId)?.token`: the
  // performAuth caller holds the freshly-issued JWT directly and a
  // post-dispatch read against the closed-over React state may be
  // stale (see PSR-G06 / 2026-05-22 stale-closure repro).
  const activateConnection = useCallback(
    (connectionId: string, token: string): void => {
      conns.setActive(connectionId)
      setLatestToken(token)
      // Lazy import to avoid a static cycle between AuthProvider and
      // queryPageStore; matches the signOut + switchActive pattern.
      import('../lib/queryPageStore')
        .then((m) => m.useQueryPageStore.getState().reset())
        .catch(() => {
          /* store init can't fail in practice; ignore */
        })
    },
    [conns]
  )

  // performAuth is the shared body for signIn and connectMore. Both
  // wrap a successful apiLogin handshake with: register the new
  // connection, mint a fresh CSRF pair, flip the auth hint, refresh
  // the cached roles, and (optionally) persist the password through
  // the electron bridge. The two callers differ in three points:
  //
  //   - signIn ALWAYS promotes the new connection to active and
  //     writes its token into the in-memory latch (so subsequent
  //     fetches attach it as a Bearer header). connectMore promotes
  //     only when the caller opts in via `activate=true` (e.g. the
  //     ConnectionSwitcher → modal flow where the operator picked a
  //     SPECIFIC profile); the default keeps the existing active
  //     connection focused.
  //   - signIn parallelizes the CSRF refresh with the synchronous
  //     reducer/latch writes (PSR-F10 / #108): the round-trip starts
  //     immediately and is awaited at the end so the resolved
  //     promise still implies "next mutation has a valid double-
  //     submit pair". connectMore must serialize the CSRF refresh
  //     BEFORE adding the new connection (PSR-G03 / #80) so a
  //     stale double-submit pair from the rotated cookie does not
  //     race a follow-up mutation.
  //   - signIn fire-and-forgets storeSavedPassword (PSR-F10): the
  //     login navigation should not block on a synchronous IPC +
  //     safeStorage decrypt. connectMore awaits it because there is
  //     no navigation pending and the caller may want to know the
  //     write completed.
  //
  // GAP-Q08 (#100): pure refactor. Behaviour is preserved exactly
  // for both modes; the mode discriminator selects the
  // setActive/latch/CSRF-ordering shape rather than introducing any
  // new branching at the network layer.
  const performAuth = useCallback(
    async (params: {
      mode: 'signIn' | 'connectMore'
      profile: string
      username: string
      password: string
      savePassword?: boolean
      // 2026-05-22 bug-fix: `activate=true` for connectMore promotes
      // the freshly-minted connection to active INSIDE this function,
      // immediately after `conns.add` dispatches. This is the
      // only safe way to do post-add activation — a subsequent
      // `switchActive(newId)` from the caller would race a stale
      // closed-over `conns.connections` snapshot taken before the
      // dispatch landed. signIn implicitly activates (mode==='signIn'
      // branch below); connectMore preserves its "add without
      // displacing focus" default unless `activate=true`.
      activate?: boolean
    }): Promise<string> => {
      const { mode, profile, username, password, savePassword, activate } =
        params
      const result = await apiLogin(username, password, profile)

      // CSRF ordering depends on mode: signIn parallelises (F10),
      // connectMore serialises before any further state writes (G03).
      let csrfPromise: Promise<unknown> | null = null
      if (mode === 'signIn') {
        csrfPromise = refreshCsrfToken()
      } else {
        await refreshCsrfToken()
      }

      conns.add({
        connectionId: result.connection_id,
        token: result.access_token,
        profileName: profile,
        expiresAt: Date.now() + result.expires_in * 1000,
      })

      // Active-connection promotion + latch on signIn always; on
      // connectMore only when the caller opted in (activate=true). The
      // dispatch path mirrors signIn exactly — setActive is a pure
      // dispatch, setLatestToken updates the module-level latch, and
      // neither reads from the closed-over React state, so this is
      // safe to run in the same tick the `add` dispatch just ran in.
      // Critically we do NOT defer this to the caller via
      // `switchActive(newId)` — that path would read
      // `conns.connections.get(newId)` against the pre-dispatch
      // snapshot and silently no-op.
      //
      // `activateConnection` ALSO drops the cross-route
      // `useQueryPageStore` so the previous profile's editor /
      // submitted statement / cached result cannot bleed through the
      // switch (parity with `switchActive`'s existing behaviour). On
      // initial signIn the store is already at its defaults, so the
      // reset is a no-op; the cost of always running it is one
      // dynamic import + a single zustand `set({...})`.
      if (mode === 'signIn' || activate) {
        activateConnection(result.connection_id, result.access_token)
      }

      writeAuthHint(true)
      setIsAuthed(true)

      // PSR-G09: refresh role posture from the freshly-issued JWT for
      // both modes. connectMore picks up role grants that landed at
      // the upstream Geode since signIn.
      const fresh = extractRoles(result.access_token)
      writeStoredRoles(fresh)
      setRoles(fresh)

      // savePassword shape differs: signIn fire-and-forgets (PSR-F10)
      // because the login navigation should not block on safeStorage;
      // connectMore awaits because there is no navigation pending.
      if (savePassword) {
        if (mode === 'signIn') {
          storeSavedPassword(profile, username, password).catch(() => {
            /* swallow — saved-password write is best-effort */
          })
        } else {
          await storeSavedPassword(profile, username, password)
        }
      }

      if (csrfPromise) {
        // Await the parallelised CSRF round-trip so the resolved
        // signIn promise still implies "next mutation has a valid
        // double-submit pair".
        await csrfPromise
      }
      // Return the freshly-minted connectionId. signIn callers
      // ignore the value (signIn already setActive's via the
      // mode === 'signIn' branch above). connectMore callers that
      // opted into `activate=true` also do not need the id because
      // performAuth already promoted the connection above — the id
      // is still returned for connectMore callers that want to
      // record the new connection for non-activation purposes
      // (analytics, follow-up navigation keyed by id, etc.).
      return result.connection_id
    },
    [conns, activateConnection]
  )

  const signIn = useCallback(
    async (
      username: string,
      password: string,
      profile: string,
      savePassword?: boolean
    ): Promise<void> => {
      // signIn returns void — the caller doesn't need the connection
      // id because performAuth's signIn-mode branch has already
      // setActive'd it and latched its token.
      await performAuth({
        mode: 'signIn',
        profile,
        username,
        password,
        savePassword,
      })
    },
    [performAuth]
  )

  const signOut = useCallback(async (): Promise<void> => {
    // APP-07: the legacy bearer-token clearToken() call was retired —
    // cookie-mode is unconditional, no JS-readable token exists.
    await apiLogout()
    clearCsrfToken()
    conns.clear()
    setLatestToken(null)
    writeAuthHint(false)
    setIsAuthed(false)
    // PSR-G09: drop the cached roles list on logout so the next
    // login starts from a known-empty role posture.
    writeStoredRoles(null)
    setRoles([])
    // Drop QueryPage's cross-route memory (editor text, last result,
    // tab/streamMode/expand). The store is a module-level singleton
    // and survives router navigation by design; signOut is one of
    // exactly two legitimate reset points (the other is switchActive
    // below). Lazy-imported via require so a cycle between AuthProvider
    // and queryPageStore.ts can't form at module-load time.
    import('../lib/queryPageStore')
      .then((m) => m.useQueryPageStore.getState().reset())
      .catch(() => {
        /* store init can't fail in practice; ignore */
      })
    // S9 (#122): saved passwords intentionally PERSIST past signOut.
    // This mirrors the browser-password-manager analog called out in
    // Plan E §8 — logging out should not silently nuke the user's
    // stored credential. The user controls forgetting via Settings →
    // "Forget Saved Password" (TODO #122: surface the Settings UI
    // affordance; the underlying `clearStoredPassword` IPC + API helper
    // already exist). Do NOT add a `clearStoredPassword` call here
    // without re-reading Plan E §8 and SECURITY_GAP_ANALYSIS.md S9 —
    // this is sec::accepted-risk, not an oversight.
  }, [conns])

  const connectMore = useCallback(
    (
      username: string,
      password: string,
      profile: string,
      savePassword?: boolean,
      activate?: boolean
    ): Promise<string> =>
      performAuth({
        mode: 'connectMore',
        profile,
        username,
        password,
        savePassword,
        activate,
      }),
    [performAuth]
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
      // Delegates to activateConnection so the dispatch + token latch +
      // QueryPage reset stay in lockstep with the performAuth activate
      // path. Pre-refactor these two callers had drifted (the activate
      // branch had no queryPageStore reset) and the operator-visible
      // symptom was "the chrome label moved but the page still shows
      // the previous profile". See AddConnectionModal.activation.test.tsx.
      activateConnection(connectionId, target.token)
    },
    [conns, activateConnection]
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
