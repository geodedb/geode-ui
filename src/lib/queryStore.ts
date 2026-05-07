import { create } from 'zustand'

// queryStore is a tiny cross-route channel used by the schema explorer
// to hand a pre-built statement to QueryPage. SchemaPage's label/edge
// buttons call setStaged() and navigate to '/'. QueryPage reads
// stagedStatement on mount, copies it into its editor state, and clears
// the slot so a subsequent route change doesn't replay the same query.
type QueryStoreState = {
  stagedStatement: string | null
  setStaged: (s: string | null) => void
}

export const useQueryStore = create<QueryStoreState>((set) => ({
  stagedStatement: null,
  setStaged: (s) => set({ stagedStatement: s }),
}))
