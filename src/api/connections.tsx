import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react'
import { getStoredConnections, storeConnections } from './electron-bridge'
import { fetchWhoAmI } from './auth'

// ConnectionState is the per-connection bookkeeping the SPA holds in
// memory. The token is the JWT minted by /api/v1/auth/login; we
// deliberately do NOT persist it (no localStorage, no cookie that JS
// can read) — DOM-XSS would otherwise lift it. The HttpOnly auth
// cookie path stays on for legacy compatibility, but Bearer-mode is
// the canonical multi-session transport.
export interface ConnectionState {
  connectionId: string
  token: string
  profileName: string
  expiresAt: number // epoch ms
}

interface State {
  byId: Map<string, ConnectionState>
  activeId: string | null
  // PSR-F9 (#106): persist-effect dep. Bumped only when the persisted
  // shape actually changes (add a real new entry, remove an existing
  // entry, clear, or transition activeId). Pre-fix the persist effect
  // depended on `state.byId` whose identity churned on every reducer
  // tick — including no-op `setActive` to the same id and `add` of a
  // connection with the same payload — sending an IPC + safeStorage
  // encrypt round-trip per tick. The version int is the minimal stable
  // dep that captures "something the renderer needs to persist
  // actually changed".
  version: number
}

type Action =
  | { type: 'add'; conn: ConnectionState }
  | { type: 'remove'; id: string }
  | { type: 'setActive'; id: string | null }
  | { type: 'clear' }
  // PSR-F16 (#113): hydrate replaces the entire byId map + activeId in
  // a single action so the lazy bootstrap path doesn't have to fan out
  // into N `add` dispatches (each one would re-bump the persist
  // version and IPC-write the same shape back to disk we just read it
  // from). The version still bumps once so the persist effect runs.
  // An empty payload is a no-op for the persisted shape — we use it
  // to mean "hydration finished, but there was nothing on disk" so
  // the loading flag flips off without spurious disk traffic.
  | { type: 'hydrate'; conns: ConnectionState[] }

const initialState: State = { byId: new Map(), activeId: null, version: 0 }

function sameConn(a: ConnectionState, b: ConnectionState): boolean {
  // Token + expiresAt + profileName fully describe the persisted shape;
  // connectionId is the Map key so it's already known equal at this
  // call site. A re-add with identical fields is a no-op for the
  // persist effect.
  return (
    a.token === b.token &&
    a.expiresAt === b.expiresAt &&
    a.profileName === b.profileName
  )
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'add': {
      // GAP-046: dedupe by profileName, not by connectionId. Re-running
      // signIn against the same profile mints a fresh server-issued
      // connectionId, so the old by-connectionId lookup never matched
      // a re-connect and the switcher rendered two indistinguishable
      // rows for the same profile (each holding a different JWT — one
      // approaching expiry).
      //
      // The contract: at most ONE entry per `profileName`. A re-add
      // for an existing profile replaces the token / expiresAt / id
      // in-place and shifts the active pointer to the fresh row so
      // the user lands on the freshest JWT without seeing duplicates.
      const existingByProfile = [...s.byId.values()].find(
        (c) => c.profileName === a.conn.profileName
      )
      if (existingByProfile) {
        // Same connectionId + same payload = no-op (avoids needless
        // persist churn when the same JWT round-trips through hydrate
        // and then a redundant `add` from a stale caller).
        if (
          existingByProfile.connectionId === a.conn.connectionId &&
          sameConn(existingByProfile, a.conn) &&
          s.activeId === a.conn.connectionId
        ) {
          return s
        }
        const next = new Map(s.byId)
        // Drop the stale entry under the old connectionId, then insert
        // the fresh one. Map key changes (connectionIds differ) so we
        // can't just `set` — we must delete + set.
        next.delete(existingByProfile.connectionId)
        next.set(a.conn.connectionId, a.conn)
        return {
          byId: next,
          activeId: a.conn.connectionId,
          version: s.version + 1,
        }
      }
      // First connection for this profile. First connection overall
      // auto-activates; subsequent first-time-for-profile additions
      // don't steal focus (Plan C will add explicit switching UI).
      const nextActive = s.activeId ?? a.conn.connectionId
      const next = new Map(s.byId)
      next.set(a.conn.connectionId, a.conn)
      return { byId: next, activeId: nextActive, version: s.version + 1 }
    }
    case 'remove': {
      // Removing an absent id is a no-op for the persisted shape.
      if (!s.byId.has(a.id)) return s
      const next = new Map(s.byId)
      next.delete(a.id)
      const activeId = s.activeId === a.id ? null : s.activeId
      return { byId: next, activeId, version: s.version + 1 }
    }
    case 'setActive': {
      // No-op transition to the same active id stays at the same
      // version. The persist effect doesn't actually depend on which
      // connection is active (the persisted shape is the connection
      // list), but we still bump on real changes so callers can
      // observe activeId-only changes via a separate dep if needed.
      if (s.activeId === a.id) return s
      return { ...s, activeId: a.id, version: s.version + 1 }
    }
    case 'clear':
      // Clearing an empty store doesn't need to fire the persist
      // effect — the disk image is already absent (or already empty).
      if (s.byId.size === 0 && s.activeId === null) return s
      return { ...initialState, version: s.version + 1 }
    case 'hydrate': {
      // Bulk replace from disk. If nothing came back AND the in-memory
      // map is already empty, this is a no-op (avoids gratuitously
      // bumping the version and re-writing an empty file). Otherwise
      // we install the new map and mark active to the first entry, so
      // ProtectedRoute sees a non-null active connection.
      if (a.conns.length === 0 && s.byId.size === 0) return s
      const byId = new Map<string, ConnectionState>(
        a.conns.map((c) => [c.connectionId, c])
      )
      const activeId =
        s.activeId && byId.has(s.activeId)
          ? s.activeId
          : (a.conns[0]?.connectionId ?? null)
      return { byId, activeId, version: s.version + 1 }
    }
    default:
      return s
  }
}

interface ContextValue {
  connections: ReadonlyMap<string, ConnectionState>
  activeId: string | null
  // PSR-F16 (#113): true while the secure-store hydration round-trip
  // is in flight. ProtectedRoute treats `loading=true` as "wait, do
  // not redirect" so a hydrated session doesn't briefly bounce to
  // /login before the byId map is populated. Eagerly-hydrated callers
  // (test mounts that pass initialConnections, browser mode where
  // storeConnections is a noop) start with loading=false because
  // there is nothing to wait for.
  loading: boolean
  add: (conn: ConnectionState) => void
  remove: (id: string) => void
  setActive: (id: string | null) => void
  clear: () => void
}

const Ctx = createContext<ContextValue | null>(null)

export const ConnectionsProvider: React.FC<{
  children: React.ReactNode
  // initialConnections is the eager-hydration path: callers that
  // already have the connection list (every Jest test mount + the
  // legacy bootstrap that awaited the bridge) pass it through and
  // skip the lazy hydration round-trip below.
  initialConnections?: ConnectionState[]
  // lazyHydrate=true switches the provider into the post-mount
  // hydration mode (PSR-F16 / #113). The provider mounts immediately
  // with an empty map and `loading=true`, then dispatches a `hydrate`
  // action once getStoredConnections() resolves. This is the production
  // path: src/index.tsx no longer awaits the bridge before calling
  // createRoot, so first paint happens before the safeStorage decrypt
  // round-trip.
  lazyHydrate?: boolean
}> = ({ children, initialConnections, lazyHydrate }) => {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    if (!initialConnections || initialConnections.length === 0) {
      return initialState
    }
    const byId = new Map<string, ConnectionState>(
      initialConnections.map((c) => [c.connectionId, c])
    )
    const first = initialConnections[0]
    if (first) setLatestToken(first.token)
    // Hydrated state starts at version 1 so the persist effect runs
    // once on mount (matching the pre-fix behaviour of mirroring the
    // hydrated list back to disk on first paint).
    return { byId, activeId: first?.connectionId ?? null, version: 1 }
  })

  // PSR-F16 (#113): when lazyHydrate is requested AND no eager
  // initialConnections were supplied, mount with loading=true and let
  // the post-mount effect populate the map. Eagerly-hydrated mounts
  // (initialConnections provided OR lazyHydrate=false) are already
  // settled, so loading starts false.
  const wantsLazy =
    lazyHydrate === true &&
    (!initialConnections || initialConnections.length === 0)
  const [loading, setLoading] = useState<boolean>(wantsLazy)

  useEffect(() => {
    if (!wantsLazy) return
    let cancelled = false
    const hydrate = async (): Promise<void> => {
      try {
        const stored = await getStoredConnections()
        if (cancelled) return
        // Map the persisted records to the in-memory ConnectionState
        // shape and dispatch a single hydrate action. Latching the
        // first connection's token here keeps the fetch wrapper
        // (which reads getLatestToken outside of React) in sync.
        const conns: ConnectionState[] = stored.map((c) => ({
          connectionId: c.connectionId,
          token: c.token,
          profileName: c.profileName,
          expiresAt: c.expiresAt,
        }))

        // Bug 2 (2026-05-21 bug-fix bundle): cookie-driven session
        // rehydration. When the Electron secure-store has no records
        // (the typical browser-mode path, since electron-bridge.ts
        // short-circuits getStoredConnections to []), the HttpOnly
        // `geode-ui-auth` cookie may still carry a valid session
        // from a prior login. Ask the server who we are; on a 200,
        // synthesise a placeholder ConnectionState so ProtectedRoute
        // does NOT redirect to /login on every page reload.
        //
        // The synthesised state carries `token=""` so client.ts
        // strips the Authorization header and the server falls
        // through to reading the cookie (its preferred transport
        // anyway). We deliberately do NOT echo the JWT back into
        // the SPA — SEC-F7 (#62) closed that DOM-XSS exfil channel
        // and this rehydration must not re-open it.
        if (conns.length === 0) {
          const who = await fetchWhoAmI()
          if (cancelled) return
          if (who) {
            const synth: ConnectionState = {
              connectionId: who.connection_id || `cookie:${who.sub}`,
              token: '',
              profileName: who.profile,
              // Server-side stamp is unix seconds; ConnectionState
              // expects epoch ms.
              expiresAt: who.expires_at * 1000,
            }
            conns.push(synth)
          }
        }

        if (conns[0]) setLatestToken(conns[0].token)
        dispatch({ type: 'hydrate', conns })
      } catch {
        // Bridge / whoami failure is non-fatal: the SPA falls
        // through to the unauthenticated path. ProtectedRoute will
        // redirect to /login because no active connection is set.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    hydrate().catch(() => {
      /* defensive: hydrate already swallows its own errors */
    })
    return () => {
      cancelled = true
    }
    // wantsLazy is captured at mount time and doesn't change for the
    // life of the provider.
  }, [wantsLazy])

  // Persist on every real state change. Browser mode (storeConnections
  // is a noop fallback) is unaffected; Electron mode mirrors the
  // in-memory map to disk via the safeStorage-backed secure store.
  //
  // PSR-F9 (#106): the dep is the int `state.version` — NOT the Map
  // identity. Pre-fix every reducer tick produced a fresh Map and
  // re-fired the IPC even on no-op transitions. Post-fix the version
  // only bumps on a real shape change (see reducer above), so a tight
  // burst of redundant `add`/`setActive` dispatches no longer fans out
  // into N safeStorage encrypt + atomic file rename operations on the
  // electron main side.
  useEffect(() => {
    const list = [...state.byId.values()].map((c) => ({
      connectionId: c.connectionId,
      token: c.token,
      profileName: c.profileName,
      expiresAt: c.expiresAt,
    }))
    storeConnections(list).catch(() => undefined)
    // APP-08: keep the per-connection token accessor in lockstep with
    // the reducer. Rebuilding from the byId map (rather than diffing
    // adds/removes) is the cheapest correct way to keep `add` /
    // `remove` / `hydrate` / `clear` all consistent under one effect.
    internalSyncConnectionTokens(
      [...state.byId.values()].map((c) => [c.connectionId, c.token])
    )
  }, [state.version])

  const value = useMemo<ContextValue>(
    () => ({
      connections: state.byId,
      activeId: state.activeId,
      loading,
      add: (conn) => dispatch({ type: 'add', conn }),
      remove: (id) => dispatch({ type: 'remove', id }),
      setActive: (id) => dispatch({ type: 'setActive', id }),
      clear: () => dispatch({ type: 'clear' }),
    }),
    [state, loading]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useConnections(): ContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useConnections outside ConnectionsProvider')
  return v
}

export function useActiveConnection(): ConnectionState | null {
  const { connections, activeId } = useConnections()
  if (!activeId) return null
  return connections.get(activeId) ?? null
}

// getLatestToken is a plain (non-hook) accessor used by the fetch
// wrapper in client.ts, which can't take a hook dependency. The
// AuthProvider keeps this module-level latch in sync via setLatestToken
// on every state transition.
let latestActiveToken: string | null = null

export function setLatestToken(token: string | null): void {
  latestActiveToken = token
}

export function getLatestToken(): string | null {
  return latestActiveToken
}

// APP-08 (2026-05-24 appsec): per-connection bearer accessor. The
// module-level latch is fragile — between two fetches against
// connection A, a synchronous switch to B by the reducer would attach
// B's token to A's in-flight request. Call sites that target a
// specific connection should now plumb the connectionId through their
// fetch `init`, and the wrapper in `src/api/client.ts` resolves the
// bearer via this accessor rather than `getLatestToken`.
//
// The accessor reads from a process-internal map kept in lockstep with
// the reducer: every `add` populates it, every `remove` evicts, every
// `hydrate` rebuilds, every `clear` empties it. The map is module-
// local (not exposed) so a renderer compromise cannot enumerate it
// directly — it must still satisfy the reducer's add/remove
// invariants.
const tokensByConnectionId = new Map<string, string>()

export function getTokenForConnection(connectionId: string): string | null {
  return tokensByConnectionId.get(connectionId) ?? null
}

// Internal helpers — the ConnectionsProvider's persist + reducer paths
// import these so the per-connection map stays in sync with the React
// reducer state without leaking the mutation surface to renderers.
export function setConnectionTokenForTests(
  connectionId: string,
  token: string
): void {
  tokensByConnectionId.set(connectionId, token)
}

export function clearConnectionTokensForTests(): void {
  tokensByConnectionId.clear()
}

// internalSyncConnectionTokens replaces the per-connection token map
// in one shot. The ConnectionsProvider's persist effect calls this
// every time the reducer's version int bumps, so the accessor stays
// in lockstep with the React state without leaking the per-entry
// mutation surface.
export function internalSyncConnectionTokens(
  entries: Iterable<[string, string]>
): void {
  tokensByConnectionId.clear()
  // forEach to keep the lint rule happy — the entries iterable is
  // small (capped by STORE_CONNECTIONS_MAX) so allocation isn't a
  // concern.
  Array.from(entries).forEach(([id, token]) => {
    tokensByConnectionId.set(id, token)
  })
}
