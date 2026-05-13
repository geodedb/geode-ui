import type cytoscape from 'cytoscape'
import type { LayoutName } from '../useGraphPrefs'

// Layouts offered in the picker. `cose` is the only force-directed
// option shipped with cytoscape core; `fcose` (faster force layout,
// handles compound/clustered graphs) and `dagre` (layered DAG layout
// for directed / hierarchical shapes) are registered as extensions at
// module load above. The rest are core layouts useful for known shapes
// (chains, clusters, time-ordered scans). LayoutName / DEFAULT_LAYOUT
// live in useGraphPrefs (the sticky-prefs store).
export const LAYOUTS: readonly LayoutName[] = [
  'cose',
  'fcose',
  'dagre',
  'breadthfirst',
  'circle',
  'concentric',
  'grid',
]

// Above this node count the cose force-directed layout becomes
// noticeably sluggish (O(N²) repulsion sums). Fall back to grid as a
// safer auto default; users can still pick cose explicitly via the
// dropdown.
export const COSE_NODE_LIMIT = 400

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
    default:
      return { name, ...base } as cytoscape.LayoutOptions
  }
}
