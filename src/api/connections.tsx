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
}

type Action =
  | { type: 'add'; conn: ConnectionState }
  | { type: 'remove'; id: string }
  | { type: 'setActive'; id: string | null }
  | { type: 'clear' }

const initialState: State = { byId: new Map(), activeId: null }

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'add': {
      const next = new Map(s.byId)
      next.set(a.conn.connectionId, a.conn)
      // First connection auto-activates; subsequent additions don't
      // steal focus (Plan C will add explicit switching UI).
      const activeId = s.activeId ?? a.conn.connectionId
      return { byId: next, activeId }
    }
    case 'remove': {
      const next = new Map(s.byId)
      next.delete(a.id)
      const activeId = s.activeId === a.id ? null : s.activeId
      return { byId: next, activeId }
    }
    case 'setActive':
      return { ...s, activeId: a.id }
    case 'clear':
      return initialState
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
    return { byId, activeId: first?.connectionId ?? null }
  })

  // Persist on every state change. Browser mode (storeConnections is a
  // noop fallback) is unaffected; Electron mode mirrors the in-memory
  // map to disk via the safeStorage-backed secure store.
  useEffect(() => {
    const list = [...state.byId.values()].map((c) => ({
      connectionId: c.connectionId,
      token: c.token,
      profileName: c.profileName,
      expiresAt: c.expiresAt,
    }))
    storeConnections(list).catch(() => undefined)
  }, [state.byId])

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
