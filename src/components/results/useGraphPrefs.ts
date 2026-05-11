import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// GraphView's display options (layout algorithm, node-label visibility
// toggles, per-bucket label-field overrides, per-type edge-field
// overrides) used to live in component-local useState. QueryPage's
// resetRunState() sets activeResp to null on every "Run", which
// collapses the {activeResp && <GraphView/>} subtree and *unmounts*
// GraphView — so on remount each useState re-initialised to its default
// and the operator lost their display configuration on every re-run.
//
// These prefs are now a small localStorage-backed zustand store that
// outlives the GraphView mount (and a full page reload). Result-scoped
// state (selected element, build error, live counts, the Cytoscape
// zoom/pan) stays component-local — only the sticky display prefs are
// lifted here.

// Layouts shipped with cytoscape core (no extra plugin needed). Kept in
// sync with GraphView's LayoutName.
export type LayoutName =
  | 'cose'
  | 'breadthfirst'
  | 'circle'
  | 'concentric'
  | 'grid'

export const DEFAULT_LAYOUT: LayoutName = 'cose'

const STORAGE_KEY = 'geode-ui.graph-prefs'

type GraphPrefsState = {
  layout: LayoutName
  // Node-label buckets the user has hidden (e.g. 'Movie', 'Person').
  hiddenLabels: Set<string>
  // Per-bucket override of which property to render as the node label.
  // A missing key means "use the default" (resolveNodeLabel handles it).
  nodeLabelPrefs: Record<string, string>
  // Per-type override of which property to render as the edge label.
  edgeLabelPrefs: Record<string, string>
  setLayout: (l: LayoutName) => void
  toggleHiddenLabel: (label: string) => void
  setHiddenLabels: (next: Set<string>) => void
  setNodePref: (label: string, key: string) => void
  setEdgePref: (type: string, key: string) => void
}

// Sets do not survive JSON.stringify, so the persisted shape stores
// hiddenLabels as a string[] and we round-trip it here.
type PersistedShape = {
  layout: LayoutName
  hiddenLabels: string[]
  nodeLabelPrefs: Record<string, string>
  edgeLabelPrefs: Record<string, string>
}

export const useGraphPrefs = create<GraphPrefsState>()(
  persist(
    (set) => ({
      layout: DEFAULT_LAYOUT,
      hiddenLabels: new Set<string>(),
      nodeLabelPrefs: {},
      edgeLabelPrefs: {},
      setLayout: (l) => set({ layout: l }),
      toggleHiddenLabel: (label) =>
        set((s) => {
          const next = new Set(s.hiddenLabels)
          if (next.has(label)) {
            next.delete(label)
          } else {
            next.add(label)
          }
          return { hiddenLabels: next }
        }),
      setHiddenLabels: (next) => set({ hiddenLabels: new Set(next) }),
      setNodePref: (label, key) =>
        set((s) => ({ nodeLabelPrefs: { ...s.nodeLabelPrefs, [label]: key } })),
      setEdgePref: (type, key) =>
        set((s) => ({ edgeLabelPrefs: { ...s.edgeLabelPrefs, [type]: key } })),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => window.localStorage),
      partialize: (s): PersistedShape => ({
        layout: s.layout,
        hiddenLabels: Array.from(s.hiddenLabels),
        nodeLabelPrefs: s.nodeLabelPrefs,
        edgeLabelPrefs: s.edgeLabelPrefs,
      }),
      // Rehydrate the persisted string[] back into a Set so consumers
      // always see a Set regardless of where the value came from.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PersistedShape>
        return {
          ...current,
          layout: p.layout ?? current.layout,
          hiddenLabels: new Set(p.hiddenLabels ?? []),
          nodeLabelPrefs: p.nodeLabelPrefs ?? current.nodeLabelPrefs,
          edgeLabelPrefs: p.edgeLabelPrefs ?? current.edgeLabelPrefs,
        }
      },
    }
  )
)
