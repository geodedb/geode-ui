import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from 'react'
import { storeConnections } from './electron-bridge'

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
      const existing = s.byId.get(a.conn.connectionId)
      // First connection auto-activates; subsequent additions don't
      // steal focus (Plan C will add explicit switching UI).
      const nextActive = s.activeId ?? a.conn.connectionId
      // Re-adding the same payload is a no-op — skip the Map clone and
      // the version bump so the persist effect stays quiet.
      if (existing && sameConn(existing, a.conn) && nextActive === s.activeId) {
        return s
      }
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
    default:
      return s
  }
}

interface ContextValue {
  connections: ReadonlyMap<string, ConnectionState>
  activeId: string | null
  add: (conn: ConnectionState) => void
  remove: (id: string) => void
  setActive: (id: string | null) => void
  clear: () => void
}

const Ctx = createContext<ContextValue | null>(null)

export const ConnectionsProvider: React.FC<{
  children: React.ReactNode
  initialConnections?: ConnectionState[]
}> = ({ children, initialConnections }) => {
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
  }, [state.version])

  const value = useMemo<ContextValue>(
    () => ({
      connections: state.byId,
      activeId: state.activeId,
      add: (conn) => dispatch({ type: 'add', conn }),
      remove: (id) => dispatch({ type: 'remove', id }),
      setActive: (id) => dispatch({ type: 'setActive', id }),
      clear: () => dispatch({ type: 'clear' }),
    }),
    [state]
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
