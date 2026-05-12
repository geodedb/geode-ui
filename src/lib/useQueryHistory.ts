// useQueryHistory — a small localStorage-backed log of recently-run
// queries.
//
// Both the Query page (sync + stream paths) and each workspace pane call
// `record(...)` when a run completes (success or failure). The store
// keeps the newest entry first, coalesces a re-run of the immediately
// preceding statement (same statement text + same ok/fail outcome) into
// a single entry instead of stacking duplicates, and caps the log at
// MAX_HISTORY entries with FIFO eviction.
//
// Persisted shape is just a plain array of plain objects, so there is no
// Set round-tripping to do (unlike useGraphPrefs). The zustand +
// `persist` curry style mirrors useGraphPrefs.ts.

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
  entries: QueryHistoryEntry[]
  record: (e: RecordInput) => void
  clear: () => void
}

export const useQueryHistory = create<QueryHistoryState>()(
  persist(
    (set, get) => ({
      entries: [],
      record: ({ statement, rowCount, ok, ranAt }) => {
        const trimmed = statement.trim()
        if (!trimmed) return
        const now = ranAt ?? Date.now()
        const cur = get().entries
        const first = cur[0]
        const next: QueryHistoryEntry = {
          statement: trimmed,
          ranAt: now,
          rowCount,
          ok,
        }
        if (first && first.statement === trimmed && first.ok === ok) {
          set({ entries: [next, ...cur.slice(1)].slice(0, MAX_HISTORY) })
          return
        }
        set({ entries: [next, ...cur].slice(0, MAX_HISTORY) })
      },
      clear: () => set({ entries: [] }),
    }),
    {
      name: 'geode-ui.query-history',
      partialize: (s) => ({ entries: s.entries }),
    }
  )
)
