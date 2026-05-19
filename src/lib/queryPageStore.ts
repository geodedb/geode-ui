import { create } from 'zustand'
import type { QueryResp } from '@api'
import type { ResultTab } from '../components/results/ResultPanel'

// queryPageStore is the cross-route memory for QueryPage's editor and
// result state. Routes mount + unmount as the user navigates between
// /, /schema, /admin, etc — React's per-page useState bag is lost on
// every unmount, which means "open QueryPage → run a query → click
// Schema → click Query" wiped out the editor text + result.
//
// This is an in-memory zustand store (NO persist middleware): a
// module-level singleton that lives for the lifetime of the JS bundle.
// The state survives route navigation by virtue of NOT being tied to
// React's component tree. The lifecycle reset points that DO clear it
// are explicit:
//
//   - AuthProvider.signOut()      — fresh session on next login
//   - AuthProvider.switchActive() — new active connection / profile
//
// Both call `useQueryPageStore.getState().reset()`. There is no
// localStorage / sessionStorage backing — the largest fields (`resp`,
// `submittedStmt`) could easily exceed the 5 MB storage budget on a
// big result, and the user-visible value of persisting across a page
// reload is much smaller than the simplicity / correctness win of
// keeping it RAM-only.
//
// Streaming state (the `stream` reducer in QueryPage) intentionally
// stays local to the page — the WebSocket handle behind it can't
// outlive an unmount anyway, so persisting the half-complete reducer
// snapshot would lie about the live connection. A user who navigates
// away mid-stream just re-runs the query when they come back.

export interface QueryPageState {
  /** Editor text. Survives route changes. */
  stmt: string
  /** The statement that was last SUBMITTED via Run (sync or stream). */
  submittedStmt: string
  /** Last completed sync query response, or null. */
  resp: QueryResp | null
  /** Last query error message, or null. */
  err: string | null
  /** Active result tab (table / json / graph / matrix). */
  tab: ResultTab
  /** Whether stream mode is enabled. */
  streamMode: boolean
  /** Whether graph-cell expansion is on. */
  expand: boolean

  setStmt: (s: string) => void
  setSubmittedStmt: (s: string) => void
  setResp: (r: QueryResp | null) => void
  setErr: (e: string | null) => void
  setTab: (t: ResultTab) => void
  setStreamMode: (v: boolean) => void
  setExpand: (v: boolean) => void

  /**
   * Drop every per-session field back to its default. Wired from
   * AuthProvider.signOut() and AuthProvider.switchActive() — the only
   * two events that legitimately invalidate the prior session's
   * editor buffer and query results.
   */
  reset: () => void
}

const DEFAULT_STMT = 'MATCH (n) RETURN n LIMIT 25'

export const useQueryPageStore = create<QueryPageState>((set) => ({
  stmt: DEFAULT_STMT,
  submittedStmt: '',
  resp: null,
  err: null,
  tab: 'table',
  streamMode: false,
  expand: true,

  setStmt: (s) => set({ stmt: s }),
  setSubmittedStmt: (s) => set({ submittedStmt: s }),
  setResp: (r) => set({ resp: r }),
  setErr: (e) => set({ err: e }),
  setTab: (t) => set({ tab: t }),
  setStreamMode: (v) => set({ streamMode: v }),
  setExpand: (v) => set({ expand: v }),

  reset: () =>
    set({
      stmt: DEFAULT_STMT,
      submittedStmt: '',
      resp: null,
      err: null,
      tab: 'table',
      streamMode: false,
      expand: true,
    }),
}))
