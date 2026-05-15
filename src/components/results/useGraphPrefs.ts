import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { allowedFeatures, type Tier } from './graph/scaleTier'

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

// Layouts available in GraphView. `cose` is the only force-directed
// option shipped with cytoscape core; `fcose` (cytoscape-fcose),
// `dagre` (cytoscape-dagre), and `spread` (cytoscape-spread, an
// anti-overlap pass) are registered as extensions at module load in
// GraphView.tsx. Kept in sync with GraphView's LAYOUTS const.
export type LayoutName =
  | 'cose'
  | 'fcose'
  | 'dagre'
  | 'breadthfirst'
  | 'circle'
  | 'concentric'
  | 'grid'
  | 'spread'

export const DEFAULT_LAYOUT: LayoutName = 'cose'

// The selected-element inspector on the graph tab can render the picked
// node/edge either as a structured key/value property view ('props',
// the default) or as the raw data-bag JSON ('json'). The choice is
// sticky so it survives a re-run remount and a page reload.
export type InspectorView = 'props' | 'json'

export const DEFAULT_INSPECTOR_VIEW: InspectorView = 'props'

// Canvas interaction mode for the graph tab. `pan` is Cytoscape's
// default (drag-pans the viewport); `box` enables box selection
// (drag-rectangle to multi-select) and disables panning while it's on.
export type SelectionMode = 'pan' | 'box'

export const DEFAULT_SELECTION_MODE: SelectionMode = 'pan'

// Which graph renderer to use. `cytoscape` is the incumbent canvas
// renderer (current default). `reagraph` is the WebGL challenger being
// validated under the cytoscape→reagraph migration (Phase 0). Sticky so
// switching survives a re-run remount and a page reload — the toggle
// lives in the graph toolbar and lets the user (and the perf harness)
// flip between renderers without changing code.
export type Renderer = 'cytoscape' | 'reagraph'

export const DEFAULT_RENDERER: Renderer = 'cytoscape'

// The graph sidebar renders five collapsible sections — Visibility,
// Display, Hidden, Collapsed, Inspector — and each remembers its
// open/closed state via this map. Sticky so the user's chosen layout
// survives a query re-run and a full page reload.
export type GraphSectionId =
  | 'visibility'
  | 'display'
  | 'hidden'
  | 'collapsed'
  | 'inspector'

export const DEFAULT_SECTIONS_OPEN: Record<GraphSectionId, boolean> = {
  visibility: true,
  display: true,
  hidden: true,
  collapsed: true,
  inspector: true,
}

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
  // Which inspector view the operator last picked ('props' | 'json').
  inspectorView: InspectorView
  // Canvas interaction mode ('pan' | 'box').
  selectionMode: SelectionMode
  // Whether nodes are grouped under per-label compound parent nodes.
  clusterByLabel: boolean
  // Whether node width/height scales with degree (log-scaled). When off,
  // nodes render at the legacy flat 38px. Sticky.
  degreeSizing: boolean
  // Number of hops to keep visible from the focal node when focus mode
  // is on. 0 = just the focal node; 1 = focal + neighbours; up to 3.
  focusHops: number
  // Whether the canvas overview / mini-map panel is mounted. Off by
  // default — it adds visual chrome and a second cytoscape attach to
  // the core, so users opt in via the toolbar toggle.
  miniMap: boolean
  // Whether lasso (cytoscape-lasso) area-selection is enabled. Off by
  // default — when on, drag-from-background draws a freeform polygon
  // and elements within it are selected on release.
  lasso: boolean
  // Whether nodes render as HTML (cytoscape-dom-node) cards. Off by
  // default — opt-in via the toolbar toggle. Slower at scale than the
  // native canvas-painted nodes; surfaces the CustomNodeTemplate React
  // tree per node which enables richer styling and future interactivity.
  domNodes: boolean
  // See Renderer type above. Sticky pref selecting which graph renderer
  // (cytoscape canvas vs reagraph WebGL) the dispatcher mounts.
  renderer: Renderer
  // Runtime-derived scale tier ('small' | 'mid' | 'large') based on the
  // current node count. NOT persisted — useGraphCytoscape writes it back
  // on each rebuild via setTier so feature gates (effective* below) can
  // gracefully degrade DOM nodes / cxtmenu / tooltips / badges past the
  // tier thresholds. See ./graph/scaleTier for the boundaries.
  tier: Tier
  // Whether layout computation runs off the main thread (Web Worker)
  // instead of inline on Cytoscape's core. Default on — the worker
  // entrypoint is delivered in a later task; until then the dispatcher
  // can still read this pref and decide.
  useWorkerLayout: boolean
  // Per-section open/closed state for the sidebar — see GraphSectionId.
  // Sticky.
  sectionsOpen: Record<GraphSectionId, boolean>
  setLayout: (l: LayoutName) => void
  toggleHiddenLabel: (label: string) => void
  setHiddenLabels: (next: Set<string>) => void
  setNodePref: (label: string, key: string) => void
  setEdgePref: (type: string, key: string) => void
  setInspectorView: (v: InspectorView) => void
  setSelectionMode: (m: SelectionMode) => void
  setClusterByLabel: (v: boolean) => void
  setDegreeSizing: (v: boolean) => void
  setFocusHops: (n: number) => void
  setMiniMap: (v: boolean) => void
  setLasso: (v: boolean) => void
  setDomNodes: (v: boolean) => void
  setRenderer: (r: Renderer) => void
  setTier: (t: Tier) => void
  setUseWorkerLayout: (v: boolean) => void
  toggleSection: (id: GraphSectionId) => void
  // Tier-gated effective views over the user prefs. effectiveDomNodes
  // returns true only when the user opted in AND the current tier allows
  // DOM-node rendering. The remaining three are pure tier reads — there
  // is no per-feature opt-out today, they degrade strictly by tier.
  effectiveDomNodes: () => boolean
  effectiveCxtMenu: () => boolean
  effectiveTooltips: () => boolean
  effectiveBadges: () => boolean
}

// Sets do not survive JSON.stringify, so the persisted shape stores
// hiddenLabels as a string[] and we round-trip it here.
type PersistedShape = {
  layout: LayoutName
  hiddenLabels: string[]
  nodeLabelPrefs: Record<string, string>
  edgeLabelPrefs: Record<string, string>
  inspectorView: InspectorView
  selectionMode: SelectionMode
  clusterByLabel: boolean
  degreeSizing: boolean
  focusHops: number
  miniMap: boolean
  lasso: boolean
  domNodes: boolean
  renderer: Renderer
  useWorkerLayout: boolean
  sectionsOpen: Record<GraphSectionId, boolean>
}

function coerceInspectorView(v: unknown): InspectorView {
  return v === 'json' ? 'json' : DEFAULT_INSPECTOR_VIEW
}

function coerceSelectionMode(v: unknown): SelectionMode {
  return v === 'box' ? 'box' : DEFAULT_SELECTION_MODE
}

// Coerces the persisted renderer back to 'cytoscape'.
//
// The reagraph branch is currently disabled at the GraphView
// dispatcher level (see GraphView.tsx for the React-18 vs
// react-three-fiber@9 compatibility note). A user who flipped the
// renderer to 'reagraph' on an older build has 'reagraph' persisted
// in localStorage; reading that back would keep them stuck on the
// disabled branch — except that the dispatcher ignores the pref now,
// so the effective renderer is always cytoscape. We additionally
// coerce 'reagraph' → 'cytoscape' on read so the rest of the store
// (and any future re-enabled dispatcher) sees a coherent value.
function coerceRenderer(): Renderer {
  return DEFAULT_RENDERER
}

export const useGraphPrefs = create<GraphPrefsState>()(
  persist(
    (set, get) => ({
      layout: DEFAULT_LAYOUT,
      hiddenLabels: new Set<string>(),
      nodeLabelPrefs: {},
      edgeLabelPrefs: {},
      inspectorView: DEFAULT_INSPECTOR_VIEW,
      selectionMode: DEFAULT_SELECTION_MODE,
      clusterByLabel: false,
      degreeSizing: true,
      focusHops: 1,
      miniMap: false,
      lasso: false,
      domNodes: false,
      renderer: DEFAULT_RENDERER,
      tier: 'small' as Tier,
      useWorkerLayout: true,
      sectionsOpen: { ...DEFAULT_SECTIONS_OPEN },
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
      setInspectorView: (v) => set({ inspectorView: v }),
      setSelectionMode: (m) => set({ selectionMode: m }),
      setClusterByLabel: (v) => set({ clusterByLabel: v }),
      setDegreeSizing: (v) => set({ degreeSizing: v }),
      setFocusHops: (n) => set({ focusHops: n }),
      setMiniMap: (v) => set({ miniMap: v }),
      setLasso: (v) => set({ lasso: v }),
      setDomNodes: (v) => set({ domNodes: v }),
      setRenderer: (r) => set({ renderer: r }),
      setTier: (t) => set({ tier: t }),
      setUseWorkerLayout: (v) => set({ useWorkerLayout: v }),
      toggleSection: (id) =>
        set((s) => ({
          sectionsOpen: { ...s.sectionsOpen, [id]: !s.sectionsOpen[id] },
        })),
      effectiveDomNodes: (): boolean => {
        const s = get()
        return s.domNodes && allowedFeatures(s.tier).domNodes
      },
      effectiveCxtMenu: (): boolean => allowedFeatures(get().tier).cxtmenu,
      effectiveTooltips: (): boolean => allowedFeatures(get().tier).tooltips,
      effectiveBadges: (): boolean => allowedFeatures(get().tier).badges,
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => window.localStorage),
      partialize: (s): PersistedShape => ({
        layout: s.layout,
        hiddenLabels: Array.from(s.hiddenLabels),
        nodeLabelPrefs: s.nodeLabelPrefs,
        edgeLabelPrefs: s.edgeLabelPrefs,
        inspectorView: s.inspectorView,
        selectionMode: s.selectionMode,
        clusterByLabel: s.clusterByLabel,
        degreeSizing: s.degreeSizing,
        focusHops: s.focusHops,
        miniMap: s.miniMap,
        lasso: s.lasso,
        domNodes: s.domNodes,
        renderer: s.renderer,
        useWorkerLayout: s.useWorkerLayout,
        sectionsOpen: s.sectionsOpen,
      }),
      // Rehydrate the persisted string[] back into a Set so consumers
      // always see a Set regardless of where the value came from. A
      // missing or garbage inspectorView / selectionMode coerces back to
      // the default; clusterByLabel coerces to a strict boolean.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PersistedShape>
        return {
          ...current,
          layout: p.layout ?? current.layout,
          hiddenLabels: new Set(p.hiddenLabels ?? []),
          nodeLabelPrefs: p.nodeLabelPrefs ?? current.nodeLabelPrefs,
          edgeLabelPrefs: p.edgeLabelPrefs ?? current.edgeLabelPrefs,
          inspectorView: coerceInspectorView(p.inspectorView),
          selectionMode: coerceSelectionMode(p.selectionMode),
          clusterByLabel: p.clusterByLabel === true,
          // Default to true for any missing/garbage persisted value so
          // a stale persisted shape (pre-degree-sizing) lights up sizing
          // on first read; only an explicit `false` opts out.
          degreeSizing: p.degreeSizing !== false,
          // Clamp focusHops into [0, 3] and default to 1 for any
          // missing / non-finite persisted value. Trunc so a stray
          // float (e.g. 1.7) lands on a whole hop count.
          focusHops: (() => {
            const v = p.focusHops
            if (typeof v !== 'number' || !Number.isFinite(v)) return 1
            if (v < 0) return 0
            if (v > 3) return 3
            return Math.trunc(v)
          })(),
          // Strict-true coercion — a missing/garbage persisted value
          // leaves the mini-map off (matches the default).
          miniMap: p.miniMap === true,
          // Same strict-true coercion for the lasso toggle — opt-in,
          // a missing/garbage persisted value keeps lasso off.
          lasso: p.lasso === true,
          // Same strict-true coercion for the HTML-nodes toggle — opt-in,
          // a missing/garbage persisted value keeps DOM-node rendering off.
          domNodes: p.domNodes === true,
          // Coerce the persisted renderer through the same defensive
          // helper used elsewhere — anything that isn't 'reagraph' (a
          // stale shape, a typo, a missing field) falls back to the
          // incumbent 'cytoscape' renderer so a bad persisted value
          // can never trap the user on a partial / broken renderer.
          renderer: coerceRenderer(),
          // useWorkerLayout defaults to true — only an explicit literal
          // `false` opts out. A missing/garbage persisted value (stale
          // shape from before this field existed) lights the worker on.
          useWorkerLayout: p.useWorkerLayout !== false,
          // sectionsOpen: each section defaults to expanded (true). Only
          // an explicit boolean `false` keeps a section collapsed. A
          // missing key from an old persisted shape (pre-sectionsOpen)
          // rehydrates to the default-expanded state so no section is
          // accidentally hidden on first load after an upgrade.
          sectionsOpen: (() => {
            const p2 = (p.sectionsOpen ?? {}) as Partial<
              Record<GraphSectionId, unknown>
            >
            return {
              visibility: p2.visibility !== false,
              display: p2.display !== false,
              hidden: p2.hidden !== false,
              collapsed: p2.collapsed !== false,
              inspector: p2.inspector !== false,
            }
          })(),
        }
      },
    }
  )
)
