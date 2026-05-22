// useQueryHistory — per-profile localStorage-backed log of recently-
// run queries.
//
// The Query page (sync + stream paths) calls `record(profileName, ...)`
// when a run completes (success or failure). The store keeps the
// newest entry first per profile, coalesces a re-run of the
// immediately preceding statement (same statement text + same
// ok/fail outcome) into a single entry instead of stacking
// duplicates, and caps each profile's log at MAX_HISTORY entries
// with FIFO eviction.
//
// 2026-05-22 bug-fix: the store was previously a single global
// array, so switching profiles in the ConnectionSwitcher leaked
// the prior profile's recent-queries view into the new profile's
// dashboard. Per-profile keying scopes the visible history to the
// active connection, which matches operator expectation that
// "recent queries on connection X" means queries actually run
// against X.
//
// Persisted shape is plain {profileName -> entries[]} objects with
// no Set round-tripping. Version bumped to 2 so the v1 flat-array
// shape gets discarded on first load — operators lose pre-fix
// history but the storage is local-only so blast radius is one
// browser tab.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const MAX_HISTORY = 20

export type QueryHistoryEntry = {
  statement: string
  ranAt: number
  rowCount: number | null
  ok: boolean
}

type RecordInput = {
  statement: string
  rowCount: number | null
  ok: boolean
  ranAt?: number
}

type QueryHistoryState = {
  // byProfile keys recent-query entries by the active profile name.
  // Empty-string key is reserved for "no active profile" — callers
  // that lack a profile context (e.g. tests, the first paint before
  // ConnectionsProvider lazy-hydrates) record under '' so the data
  // does not pollute a real profile's view, and clear('') wipes
  // that orphan bucket.
  byProfile: Record<string, QueryHistoryEntry[]>
  record: (profileName: string, e: RecordInput) => void
  clear: (profileName: string) => void
}

// entriesFor returns the recent-queries slice for the named profile
// or an empty array when nothing has been recorded yet. Exported as
// a selector helper so callers can `useQueryHistory((s) =>
// entriesFor(s, name))` without re-implementing the lookup.
export function entriesFor(
  s: QueryHistoryState,
  profileName: string
): QueryHistoryEntry[] {
  return s.byProfile[profileName] ?? []
}

export const useQueryHistory = create<QueryHistoryState>()(
  persist(
    (set, get) => ({
      byProfile: {},
      record: (profileName, { statement, rowCount, ok, ranAt }) => {
        const trimmed = statement.trim()
        if (!trimmed) return
        const now = ranAt ?? Date.now()
        const cur = get().byProfile[profileName] ?? []
        const first = cur[0]
        const next: QueryHistoryEntry = {
          statement: trimmed,
          ranAt: now,
          rowCount,
          ok,
        }
        const nextEntries =
          first && first.statement === trimmed && first.ok === ok
            ? [next, ...cur.slice(1)].slice(0, MAX_HISTORY)
            : [next, ...cur].slice(0, MAX_HISTORY)
        set({ byProfile: { ...get().byProfile, [profileName]: nextEntries } })
      },
      clear: (profileName) => {
        const cur = get().byProfile
        if (!(profileName in cur)) return
        const rest = Object.fromEntries(
          Object.entries(cur).filter(([k]) => k !== profileName)
        )
        set({ byProfile: rest })
      },
    }),
    {
      name: 'geode-ui.query-history',
      // Bumping the persist version retires the v1 flat-array shape.
      // The default migrate() returns the existing state when the
      // version is missing/old; we override it to return an empty
      // byProfile so a v1 payload doesn't get reinterpreted as a v2
      // byProfile object (which would type-mismatch and crash the
      // hydration). Operators lose pre-fix history; that's
      // acceptable for a local-only buffer.
      version: 2,
      migrate: () => ({ byProfile: {} }),
      partialize: (s) => ({ byProfile: s.byProfile }),
    }
  )
)
