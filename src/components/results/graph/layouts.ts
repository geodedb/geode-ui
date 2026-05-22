import type cytoscape from 'cytoscape'
import type { LayoutName } from '../useGraphPrefs'

// Layouts offered in the picker. `cose` is the only force-directed
// option shipped with cytoscape core; `fcose` (faster force layout,
// handles compound/clustered graphs), `dagre` (layered DAG layout for
// directed / hierarchical shapes), and `spread` (anti-overlap pass)
// are registered as extensions at module load in GraphView.tsx. The
// rest are core layouts useful for known shapes (chains, clusters,
// time-ordered scans). LayoutName / DEFAULT_LAYOUT live in
// useGraphPrefs (the sticky-prefs store).
export const LAYOUTS: readonly LayoutName[] = [
  'cose',
  'fcose',
  'dagre',
  'breadthfirst',
  'circle',
  'concentric',
  'grid',
  'spread',
]

// Above this element count the heavy layouts (anything that runs an
// iterative simulation, hierarchy walk, or all-pairs distance) become
// noticeably sluggish — cose / fcose / dagre / breadthfirst /
// concentric / spread can lock the tab for tens of seconds on the
// main thread. The auto-downgrade in useGraphSigReset uses this
// threshold to swap into `grid` so the page stays responsive; the
// operator can still pick a heavy layout explicitly via the dropdown
// after the downgrade.
export const COSE_NODE_LIMIT = 400

// HEAVY_LAYOUTS — the layouts the auto-downgrade should rescue from
// at large element counts. Anything not in this set is already
// O(N) per render (grid, circle) and doesn't need the downgrade.
// The fcose worker path in runLayout.ts moves fcose off the main
// thread above WORKER_MIN_N, but that's still gated on the user's
// `useWorkerLayout` preference; the auto-downgrade is the
// defense-in-depth that keeps the tab responsive when the worker
// path isn't available (worker pref off, layout != fcose, or build
// took the synchronous fallback). Operator report 2026-05-22:
// 2500-edge "follows" graph froze the UI when fcose was the picked
// layout — covered by useGraphSigReset.test.ts.
export const HEAVY_LAYOUTS: ReadonlySet<LayoutName> = new Set<LayoutName>([
  'cose',
  'fcose',
  'dagre',
  'breadthfirst',
  'concentric',
  'spread',
])

// Static dispatch — keeps the validate-translations script happy by
// using literal graph.layout.* keys instead of a template-literal
// lookup the AST-free script can't trace.
export function layoutLabel(
  name: LayoutName,
  t: (key: string) => string
): string {
  switch (name) {
    case 'cose':
      return t('graph.layout.cose')
    case 'fcose':
      return t('graph.layout.fcose')
    case 'dagre':
      return t('graph.layout.dagre')
    case 'breadthfirst':
      return t('graph.layout.breadthfirst')
    case 'circle':
      return t('graph.layout.circle')
    case 'concentric':
      return t('graph.layout.concentric')
    case 'grid':
      return t('graph.layout.grid')
    case 'spread':
      return t('graph.layout.spread')
    default:
      return name
  }
}

// Per-layout option object passed to cytoscape({ layout }) and
// cy.layout(...). The fcose/dagre branches set the extension-specific
// tuning knobs; everything else gets the shared base. The casts to
// cytoscape.LayoutOptions are needed because @types/cytoscape doesn't
// know about the extension layouts' option shapes.
export function layoutConfig(name: LayoutName): cytoscape.LayoutOptions {
  const base = { animate: false, padding: 24, fit: true } as const
  switch (name) {
    case 'fcose':
      return {
        name: 'fcose',
        ...base,
        quality: 'default',
        nodeSeparation: 75,
        idealEdgeLength: 80,
        nestingFactor: 0.1,
      } as unknown as cytoscape.LayoutOptions
    case 'dagre':
      return {
        name: 'dagre',
        ...base,
        rankDir: 'TB',
        nodeSep: 40,
        rankSep: 60,
      } as unknown as cytoscape.LayoutOptions
    case 'cose':
      return { name: 'cose', ...base } as cytoscape.LayoutOptions
    case 'spread':
      // cytoscape-spread is an anti-overlap pass — minDist sets the
      // minimum gap (px) it tries to enforce between any pair of node
      // bounding boxes; padding is the viewport margin shared with
      // every other layout.
      return {
        name: 'spread',
        animate: false,
        minDist: 24,
        padding: 24,
      } as unknown as cytoscape.LayoutOptions
    default:
      return { name, ...base } as cytoscape.LayoutOptions
  }
}
