import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cytoscape, { Core, ElementDefinition } from 'cytoscape'
import fcose from 'cytoscape-fcose'
import dagre from 'cytoscape-dagre'
import styled, { useTheme } from 'styled-components'
import { createCytoscapeStyle, labelToColor } from './cytoscapeStyle'
import {
  collapseNode,
  expandCollapsed,
  hideNode,
  mergeSubgraph,
  restoreNode,
} from './graphActions'
import { client } from '../../api/client'
import {
  DEFAULT_LAYOUT,
  InspectorView,
  LayoutName,
  useGraphPrefs,
} from './useGraphPrefs'
import { formatPropValue } from './propFormat'
import {
  EDGE_TYPE_DEFAULT,
  NODE_LABEL_DEFAULT,
  QueryRespLike,
  buildCompoundElements,
  extractElements,
  labelOptions,
  resolveEdgeLabel,
  resolveNodeLabel,
  typeOptions,
} from '../../lib/graphResult'

// Register the layout extensions once, at module load. cytoscape.use is
// idempotent in cytoscape@3 — a double-register (e.g. a test re-import)
// is a no-op. fcose is a faster force layout that also handles compound
// (clustered) graphs; dagre is a layered DAG layout for directed /
// hierarchical shapes. Both are surfaced in the layout picker (Task 1.2)
// and fcose is the auto-pick when group-by-label clustering is on
// (Task 1.4).
cytoscape.use(fcose)
cytoscape.use(dagre)

type Selected = { kind: 'node' | 'edge'; data: Record<string, unknown> }

// Layouts offered in the picker. `cose` is the only force-directed
// option shipped with cytoscape core; `fcose` (faster force layout,
// handles compound/clustered graphs) and `dagre` (layered DAG layout
// for directed / hierarchical shapes) are registered as extensions at
// module load above. The rest are core layouts useful for known shapes
// (chains, clusters, time-ordered scans). LayoutName / DEFAULT_LAYOUT
// live in useGraphPrefs (the sticky-prefs store).

const LAYOUTS: readonly LayoutName[] = [
  'cose',
  'fcose',
  'dagre',
  'breadthfirst',
  'circle',
  'concentric',
  'grid',
]

// Static dispatch — keeps the validate-translations script happy by
// using literal graph.layout.* keys instead of a template-literal
// lookup the AST-free script can't trace.
function layoutLabel(name: LayoutName, t: (key: string) => string): string {
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
function layoutConfig(name: LayoutName): cytoscape.LayoutOptions {
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

// Above this node count the cose force-directed layout becomes
// noticeably sluggish (O(N²) repulsion sums). Fall back to grid as a
// safer auto default; users can still pick cose explicitly via the
// dropdown.
const COSE_NODE_LIMIT = 400

// ----- "Explore neighbours" (Phase 2 / Task 2.4) -----
//
// The selected node's 1-hop subgraph is fetched by re-querying the
// connected graph. Geode GQL supports the `id(n)` predicate (see the
// geode docs / shell test suite — e.g. `MATCH (e:Employee) WHERE id(e) =
// nodeId`), so the statement is the id-keyed form below. Only valid for
// nodes that carry a real (numeric) Geode id — synthesised nodes from a
// scalar-only RETURN don't have one, so the inspector disables the
// action for them.

// True when `id` looks like a real Geode node id (a non-negative
// integer in string form, which is what extractElements emits for
// graph_summary nodes and edge-endpoint placeholders).
function isRealNodeId(id: string): boolean {
  return /^\d+$/.test(id)
}

// Build the 1-hop subgraph statement for a real node id. Undirected
// match (`-[r]-`) so both incoming and outgoing edges come back.
function buildExploreStatement(nodeId: string): string {
  return `MATCH (n)-[r]-(m) WHERE id(n) = ${nodeId} RETURN n, r, m LIMIT 100;`
}

// Pull the graph name out of a leading `USE GRAPH <name>;` so the
// explore query targets the same graph. Returns undefined when the
// original query has no such prefix (server falls back to the default).
function graphNameOf(query: string | undefined): string | undefined {
  if (!query) return undefined
  const m = query.match(/^\s*USE\s+GRAPH\s+([A-Za-z_][\w-]*)\s*;/i)
  return m ? m[1] : undefined
}

// Props.resp is a QueryRespLike from the row stream, which under streaming
// is a freshly minted object every row. Building a Cytoscape Core +
// running cose layout per row is catastrophic (O(N) teardown / re-layouts
// for an N-row stream). The component intentionally debounces the
// (re)build so streaming converges to a single mount once the row count
// settles. See PERF-F9 / issue #53.
type Props = {
  resp: QueryRespLike & { row_count?: number }
  // Original query text. Used to recover variable bindings and
  // synthesise nodes/edges when the response is scalar-only (no
  // NODE/EDGE columns ⇒ empty graph_summary).
  query?: string
  height?: number
  // fillHeight: when true (set by QueryPage's maximized result overlay)
  // the canvas grows to fill the available viewport, the sidebar
  // stacks below the canvas (so the canvas gets the full width), and
  // the Cytoscape core is resized + re-fitted after the box grows. The
  // 480 px default + side-by-side layout is kept for the inline view.
  fillHeight?: boolean
}

const REBUILD_DEBOUNCE_MS = 250

// P-NEW-2 / Q-NEW-3: cap the datalist option count rendered by the
// keyboard pickers. A 5k-node graph would otherwise materialise 5k
// <option> elements unconditionally, wasting DOM, retained memory,
// and an extra style/layout pass on every <input> focus. Datalists
// behave like type-ahead suggestions: 1000 entries is more than any
// human will scroll, and the input still accepts an exact id beyond
// the cap (the lookup Maps are NOT capped, so resolving a typed-in id
// always works).
const ID_PICKER_OPTION_CAP = 1000

const Wrap = styled.div<{ $fill: boolean; $sidebarCollapsed: boolean }>`
  display: grid;
  /* In fill mode the sidebar stacks below the canvas (single column)
     so the graph canvas claims the full width of the overlay. The
     side-by-side 1fr/280px layout — and its below-md collapse — is
     kept for the inline result panel. When the sidebar is collapsed
     the grid is a single 1fr column regardless of mode (the Side isn't
     rendered) so the canvas takes the whole width. */
  grid-template-columns: ${({ $fill, $sidebarCollapsed }) => {
    return $sidebarCollapsed || $fill ? '1fr' : '1fr 280px'
  }};
  gap: ${({ theme }) => theme.spacing.sm};
  ${({ $fill }) => ($fill ? 'height: 100%;' : '')}

  @media (max-width: ${({ theme }) => theme.breakpoints.md - 0.02}px) {
    grid-template-columns: 1fr;
  }
`
// Holds the Cytoscape canvas plus any absolutely-positioned overlays
// (empty-graph state, build-error banner). Position-relative so the
// overlay can stack on top of the canvas without entering Cytoscape's
// internal DOM tree.
const CanvasArea = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`
const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.secondary};

  .group {
    display: flex;
    align-items: center;
    gap: ${({ theme }) => theme.spacing.xxs};
  }

  .label {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    color: ${({ theme }) => theme.text.muted};
  }

  select,
  button {
    font-family: inherit;
    font-size: ${({ theme }) => theme.font.sizes.xs};
    color: ${({ theme }) => theme.text.primary};
    background: ${({ theme }) => theme.bg.canvas};
    border: 1px solid ${({ theme }) => theme.border.default};
    border-radius: ${({ theme }) => theme.radii.sm};
    padding: 2px 8px;
    line-height: 1.6;
    cursor: pointer;
  }

  button {
    min-width: 28px;
  }

  button:hover:not(:disabled) {
    border-color: ${({ theme }) => theme.border.strong};
    background: ${({ theme }) => theme.bg.subtle};
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  select:focus-visible,
  button:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
    border-color: ${({ theme }) => theme.border.focus};
  }

  .stats {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    color: ${({ theme }) => theme.text.muted};
  }
`
const Canvas = styled.div<{ $height: number }>`
  height: ${({ $height }) => $height}px;
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  background: ${({ theme }) => theme.bg.graphCanvas};
`
// Path-mode status line — shown under the toolbar while path mode is
// active ("Click the start node" / "Click the end node" / the result).
const PathStatus = styled.div`
  padding: ${({ theme }) => theme.spacing.xxs}
    ${({ theme }) => theme.spacing.sm};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.secondary};
  background: ${({ theme }) => theme.bg.subtle};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.sm};
`
const Overlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.md};
  pointer-events: none;
  color: ${({ theme }) => theme.text.muted};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  font-style: italic;
  text-align: center;
`
const ErrorBanner = styled.div`
  position: absolute;
  inset: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.sm}
    auto;
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.colors.danger};
  border-left-width: 3px;
  color: ${({ theme }) => theme.text.danger};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  box-shadow: ${({ theme }) => theme.shadows.sm};
`
const Side = styled.aside<{ $height: number; $fill: boolean }>`
  /* In fill mode the sidebar is stacked below the (full-width) canvas,
     so a fixed canvas-tall height would be wasted space — cap it
     instead and let it scroll. Otherwise it matches the canvas height
     for the side-by-side layout. */
  ${({ $height, $fill }) => {
    return $fill ? 'height: auto; max-height: 40vh;' : `height: ${$height}px;`
  }}
  overflow: auto;
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.bg.surface};
  color: ${({ theme }) => theme.text.primary};

  pre {
    white-space: pre-wrap;
    word-break: break-all;
  }

  /* Below the md breakpoint the sidebar follows the canvas in stacked
     order; cap its height so a long property dump doesn't push the
     editor and the rest of the page off-screen on phone form factors. */
  @media (max-width: ${({ theme }) => theme.breakpoints.md - 0.02}px) {
    height: auto;
    max-height: 320px;
  }
`
const ControlsBlock = styled.section`
  margin-bottom: ${({ theme }) => theme.spacing.sm};
  padding-bottom: ${({ theme }) => theme.spacing.sm};
  border-bottom: 1px solid ${({ theme }) => theme.border.subtle};

  h5 {
    margin: 0 0 ${({ theme }) => theme.spacing.xs};
    font-family: ${({ theme }) => theme.font.family.display};
    font-size: ${({ theme }) => theme.font.sizes.xs};
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: ${({ theme }) => theme.text.secondary};
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: ${({ theme }) => theme.spacing.xs};
    align-items: center;
    margin-bottom: ${({ theme }) => theme.spacing.xxs};
    font-size: ${({ theme }) => theme.font.sizes.xs};
  }
  select,
  input[list] {
    font-family: inherit;
    font-size: ${({ theme }) => theme.font.sizes.xs};
    padding: 2px 6px;
    background: ${({ theme }) => theme.bg.surface};
    color: ${({ theme }) => theme.text.primary};
    border: 1px solid ${({ theme }) => theme.border.default};
    border-radius: ${({ theme }) => theme.radii.sm};
    min-width: 0;
  }
  select:focus-visible,
  input[list]:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
    border-color: ${({ theme }) => theme.border.focus};
  }
  .empty {
    font-size: ${({ theme }) => theme.font.sizes.xs};
    color: ${({ theme }) => theme.text.muted};
  }
  .toggle-row {
    display: flex;
    align-items: center;
    gap: ${({ theme }) => theme.spacing.xs};
    font-size: ${({ theme }) => theme.font.sizes.xs};
    margin-bottom: ${({ theme }) => theme.spacing.xxs};
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: ${({ theme }) => theme.radii.sm};
    flex-shrink: 0;
    border: 1px solid ${({ theme }) => theme.border.subtle};
  }
  .toggle-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

// Restore-list (Hidden / Collapsed) — a compact <ul> with one row per
// affected node: a label/id span on the left, a Restore/Expand button on
// the right. Empty state is a single muted line.
const RestoreList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: ${({ theme }) => theme.spacing.xs};
    align-items: center;
    margin-bottom: ${({ theme }) => theme.spacing.xxs};
    font-size: ${({ theme }) => theme.font.sizes.xs};
  }
  .restore-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .restore-id {
    color: ${({ theme }) => theme.text.muted};
    font-family: ${({ theme }) => theme.font.family.mono};
  }
  button {
    font-family: inherit;
    font-size: ${({ theme }) => theme.font.sizes.xs};
    padding: 1px 6px;
    color: ${({ theme }) => theme.text.primary};
    background: ${({ theme }) => theme.bg.canvas};
    border: 1px solid ${({ theme }) => theme.border.default};
    border-radius: ${({ theme }) => theme.radii.sm};
    cursor: pointer;
  }
  button:hover {
    border-color: ${({ theme }) => theme.border.strong};
    background: ${({ theme }) => theme.bg.subtle};
  }
  button:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

// Inspector block — the selected-element panel at the bottom of the
// sidebar. It carries an identity header, a small segmented control to
// switch between the structured property view (default) and the raw
// data-bag JSON, and the chosen pane.
const InspectorBlock = styled.section`
  h4 {
    margin: 0 0 ${({ theme }) => theme.spacing.xs};
    font-family: ${({ theme }) => theme.font.family.display};
    font-size: ${({ theme }) => theme.font.sizes.sm};
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    color: ${({ theme }) => theme.text.primary};
    word-break: break-all;
  }
`
const InspectorToggle = styled.div`
  display: inline-flex;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.sm};
  overflow: hidden;

  button {
    font-family: inherit;
    font-size: ${({ theme }) => theme.font.sizes.xs};
    padding: 2px 8px;
    border: none;
    background: ${({ theme }) => theme.bg.surface};
    color: ${({ theme }) => theme.text.secondary};
    cursor: pointer;
  }
  button + button {
    border-left: 1px solid ${({ theme }) => theme.border.default};
  }
  button[aria-pressed='true'] {
    background: ${({ theme }) => theme.bg.subtle};
    color: ${({ theme }) => theme.text.primary};
    font-weight: ${({ theme }) => theme.font.weights.semibold};
  }
  button:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`
// Actions row inside the inspector — Hide / Collapse / Explore-neighbours
// for the selected node. Sits between the props/json segmented control
// and the chosen pane.
const InspectorActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.xxs};
  margin-bottom: ${({ theme }) => theme.spacing.xs};

  button {
    font-family: inherit;
    font-size: ${({ theme }) => theme.font.sizes.xs};
    padding: 2px 8px;
    color: ${({ theme }) => theme.text.primary};
    background: ${({ theme }) => theme.bg.canvas};
    border: 1px solid ${({ theme }) => theme.border.default};
    border-radius: ${({ theme }) => theme.radii.sm};
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: ${({ theme }) => theme.border.strong};
    background: ${({ theme }) => theme.bg.subtle};
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  button:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`
const InspectorNote = styled.p`
  margin: 0 0 ${({ theme }) => theme.spacing.xs};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.secondary};
`
const IdentityHeader = styled.div`
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.secondary};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
  word-break: break-all;

  code {
    font-family: ${({ theme }) => theme.font.family.mono};
    color: ${({ theme }) => theme.text.primary};
  }
  .badge {
    display: inline-block;
    margin-left: ${({ theme }) => theme.spacing.xxs};
    padding: 0 6px;
    border-radius: ${({ theme }) => theme.radii.pill};
    font-size: ${({ theme }) => theme.font.sizes.xs};
    background: ${({ theme }) => theme.bg.subtle};
    border: 1px solid ${({ theme }) => theme.border.subtle};
  }
`
const InspectorProps = styled.dl`
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 12px;
  font-size: ${({ theme }) => theme.font.sizes.xs};

  dt {
    color: ${({ theme }) => theme.text.secondary};
    font-weight: ${({ theme }) => theme.font.weights.medium};
    word-break: break-word;
  }
  dd {
    margin: 0;
    color: ${({ theme }) => theme.text.primary};
    word-break: break-word;
  }
`

function respSignature(resp: QueryRespLike & { row_count?: number }): number {
  // Stream messages do NOT include row_count until the summary frame; for
  // the streaming case we fall back to rows.length so the signature
  // changes monotonically as rows arrive. Single-shot resps include
  // row_count once and the signature is stable thereafter.
  if (typeof resp.row_count === 'number') return resp.row_count
  return resp.rows ? resp.rows.length : 0
}

// Apply the canvas interaction mode to a Cytoscape core. 'box' enables
// the built-in box selection (drag-rectangle to multi-select) and turns
// off viewport panning so the drag doesn't fight it; 'pan' restores the
// default (drag-pans, no box select).
function applySelectionMode(cy: Core, mode: 'pan' | 'box'): void {
  if (mode === 'box') {
    cy.userPanningEnabled(false)
    cy.boxSelectionEnabled(true)
  } else {
    cy.userPanningEnabled(true)
    cy.boxSelectionEnabled(false)
  }
}

// ----- path mode -----
//
// Path mode lets the operator click two nodes; GraphView runs Cytoscape's
// built-in Dijkstra on the *rendered* graph and highlights the shortest
// path between them (dimming everything else). State machine:
//   off → pickSource → pickTarget → shown → (Clear) → off
type PathState =
  | { phase: 'off' }
  | { phase: 'pickSource' }
  | { phase: 'pickTarget'; sourceId: string }
  | { phase: 'shown'; from: string; to: string; hops: number | null }

// Strip the path-highlight classes from every element. Idempotent.
function clearPathHighlight(cy: Core): void {
  cy.elements().removeClass('highlighted').removeClass('dimmed')
}

function applyLabels(
  cy: Core,
  nodePrefs: Record<string, string>,
  edgePrefs: Record<string, string>
): void {
  cy.batch(() => {
    cy.nodes().forEach((n) => {
      const label = resolveNodeLabel(
        n.data() as Record<string, unknown>,
        nodePrefs
      )
      n.data('label', label)
    })
    cy.edges().forEach((e) => {
      const label = resolveEdgeLabel(
        e.data() as Record<string, unknown>,
        edgePrefs
      )
      e.data('type', label)
    })
  })
}

// Node-label palette — duplicated lookup of cytoscapeStyle's hash so
// the visibility-toggle row in the sidebar can show the matching
// swatch without going through Cytoscape.
function nodeLabelOf(data: Record<string, unknown>): string {
  // The graph data carries a top-level `label` (one or many) on each
  // node; we use the first as the bucketing key for visibility.
  const labelField = data.label
  if (typeof labelField === 'string' && labelField) return labelField
  if (Array.isArray(labelField) && labelField.length > 0) {
    const first = labelField[0]
    if (typeof first === 'string') return first
  }
  // Some shapes carry `labels` (plural) instead.
  const labels = data.labels
  if (Array.isArray(labels) && labels.length > 0) {
    const first = labels[0]
    if (typeof first === 'string') return first
  }
  return ''
}

// SelectedInspector renders the selected-element panel: an identity
// header, a small segmented control to flip between the structured
// property view (default) and the raw data-bag JSON, and the chosen
// pane. The `props` pane is an insertion-order <dl> of
// `selected.data.props` (matching TableView's projectColumns ordering)
// formatted through the shared formatPropValue; the `json` pane is the
// historical `<pre>{JSON.stringify(...)}</pre>` output, kept as an
// option.
const SelectedInspector: React.FC<{
  selected: Selected
  view: InspectorView
  onSetView: (v: InspectorView) => void
  // Phase-2 node actions. Only meaningful when kind === 'node'; the
  // actions row is not rendered for edges.
  onHide: (id: string) => void
  onCollapse: (id: string) => void
  // Fetch + merge this node's 1-hop subgraph. Disabled when the node has
  // no real Geode id (e.g. a synthesised node) — see `exploreDisabled`.
  onExplore: (id: string) => void
  // True while an explore-neighbours fetch for *this* node is in flight.
  exploreLoading: boolean
  // True when the node can't be explored (no real numeric id). When set,
  // the button is disabled with `graph.exploreNeighboursUnavailable` as
  // its title.
  exploreDisabled: boolean
  // How many neighbours are currently collapsed behind this node (0 when
  // none / not a node). Surfaced as a small note under the actions row.
  collapsedCount: number
  t: (key: string, opts?: Record<string, unknown>) => string
}> = ({
  selected,
  view,
  onSetView,
  onHide,
  onCollapse,
  onExplore,
  exploreLoading,
  exploreDisabled,
  collapsedCount,
  t,
}) => {
  const { kind, data } = selected
  const id = String(data.id ?? '')
  const labels: string[] = Array.isArray(data.labels)
    ? (data.labels.filter((l) => typeof l === 'string') as string[])
    : []
  const labelStr = labels.map((l) => `:${l}`).join('')
  const isStub = Boolean(data.placeholder) || Boolean(data.synthesised)
  const props =
    data.props && typeof data.props === 'object' && !Array.isArray(data.props)
      ? (data.props as Record<string, unknown>)
      : {}
  // Insertion order — matches how TableView's projectColumns orders the
  // flattened property columns (first-seen / object key order), so the
  // inspector and the data table list the same node's props the same way.
  const propKeys = Object.keys(props)

  return (
    <InspectorBlock data-testid="graph-inspector">
      <h4>
        {kind === 'node'
          ? t('graph.selectedNode', { id })
          : t('graph.selectedEdge', { id })}
      </h4>
      <InspectorToggle role="group" aria-label={t('graph.inspectorViewGroup')}>
        <button
          type="button"
          data-testid="graph-inspector-view-props"
          aria-pressed={view === 'props'}
          onClick={() => onSetView('props')}
        >
          {t('graph.inspectorViewProps')}
        </button>
        <button
          type="button"
          data-testid="graph-inspector-view-json"
          aria-pressed={view === 'json'}
          onClick={() => onSetView('json')}
        >
          {t('graph.inspectorViewJson')}
        </button>
      </InspectorToggle>
      {kind === 'node' && (
        <>
          <InspectorActions
            role="group"
            aria-label={t('graph.inspectorActions')}
          >
            <button
              type="button"
              data-testid="graph-action-hide"
              onClick={() => onHide(id)}
            >
              {t('graph.actionHide')}
            </button>
            <button
              type="button"
              data-testid="graph-action-collapse"
              onClick={() => onCollapse(id)}
            >
              {t('graph.actionCollapse')}
            </button>
            <button
              type="button"
              data-testid="graph-action-explore"
              disabled={exploreDisabled || exploreLoading}
              title={
                exploreDisabled
                  ? t('graph.exploreNeighboursUnavailable')
                  : undefined
              }
              onClick={() => onExplore(id)}
            >
              {exploreLoading
                ? t('graph.exploreNeighboursLoading')
                : t('graph.actionExploreNeighbours')}
            </button>
          </InspectorActions>
          {collapsedCount > 0 && (
            <InspectorNote data-testid="graph-collapsed-count">
              {t('graph.collapsedCount', { count: collapsedCount })}
            </InspectorNote>
          )}
        </>
      )}
      {view === 'props' ? (
        <div data-testid="graph-inspector-props">
          <IdentityHeader>
            <div>
              {t('graph.inspectorId')}: <code>{id}</code>
              {isStub && (
                <span className="badge">{t('graph.inspectorStub')}</span>
              )}
            </div>
            {kind === 'node' ? (
              labelStr && (
                <div>
                  {t('graph.inspectorLabels')}: <code>{labelStr}</code>
                </div>
              )
            ) : (
              <>
                <div>
                  {t('graph.inspectorType')}:{' '}
                  <code>:{String(data.type ?? '')}</code>
                </div>
                <div>
                  <code>{String(data.source ?? '')}</code> →{' '}
                  <code>{String(data.target ?? '')}</code>
                </div>
              </>
            )}
          </IdentityHeader>
          {propKeys.length === 0 ? (
            <p className="empty" style={{ opacity: 0.6 }}>
              {t('graph.inspectorNoProps')}
            </p>
          ) : (
            <InspectorProps>
              {propKeys.map((k) => (
                <React.Fragment key={k}>
                  <dt>{k}</dt>
                  <dd>{formatPropValue(props[k])}</dd>
                </React.Fragment>
              ))}
            </InspectorProps>
          )}
        </div>
      ) : (
        <pre data-testid="graph-inspector-json">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </InspectorBlock>
  )
}

// Below the canvas chrome (toolbar) in fill mode this is the px the
// canvas leaves for itself out of the viewport — the overlay padding,
// the result tabs row, the graph toolbar, the stacked sidebar's first
// glimpse. Heuristic; the ResizeObserver / fit pass corrects framing.
const FILL_CANVAS_CHROME_PX = 320

export const GraphView: React.FC<Props> = ({
  resp,
  query,
  height = 480,
  fillHeight = false,
}) => {
  const { t } = useTranslation()
  const theme = useTheme()
  const ref = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  // The pixel height the Canvas / Side render at. In fill mode this
  // tracks the viewport (minus the overlay chrome); otherwise it's the
  // caller-provided `height`.
  const [effectiveHeight, setEffectiveHeight] = useState<number>(
    fillHeight && typeof window !== 'undefined'
      ? Math.max(height, Math.round(window.innerHeight) - FILL_CANVAS_CHROME_PX)
      : height
  )
  useEffect(() => {
    const compute = (): number => {
      if (!fillHeight) return height
      const winH =
        typeof window === 'undefined' ? 800 : Math.round(window.innerHeight)
      return Math.max(height, winH - FILL_CANVAS_CHROME_PX)
    }
    setEffectiveHeight(compute())
    if (!fillHeight || typeof window === 'undefined') return undefined
    const onResize = (): void => setEffectiveHeight(compute())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fillHeight, height])
  const [selected, setSelected] = useState<Selected | null>(null)
  // Phase-2 hide/collapse workflow. `hidden` is the set of node ids the
  // operator has hidden individually (via the inspector "Hide" action or
  // the explore-neighbours merge being undone — currently just Hide).
  // `collapsed` maps a node id → the ids of the leaf neighbours folded
  // behind it by "Collapse", so Expand can restore exactly that set.
  // Both are result-scoped — a new query result clears them in the
  // sig-keyed effect below (same place path mode resets).
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Map<string, string[]>>(new Map())
  // The node id whose 1-hop subgraph is currently being fetched by
  // "Explore neighbours" (null when idle). Used to show a per-button
  // loading state and to ignore overlapping clicks.
  const [exploringId, setExploringId] = useState<string | null>(null)
  // Path-mode state machine (off / pickSource / pickTarget / shown).
  // Result-scoped — a new query result resets it to 'off'.
  const [pathState, setPathState] = useState<PathState>({ phase: 'off' })
  const pathStateRef = useRef(pathState)
  pathStateRef.current = pathState
  // Whether the inspector/controls sidebar is collapsed. Session-local
  // (defaults expanded); not persisted. Useful in both layouts but most
  // impactful in fill mode where it lets the canvas claim the full
  // width of the overlay. When collapsed the <Side> isn't rendered and
  // the Wrap grid becomes a single 1fr column — the canvas grows, which
  // the ResizeObserver below catches to re-fit Cytoscape.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // GAP-04: errors thrown by extractElements / cytoscape() during the
  // build pass. Surfaced as a banner over the canvas instead of an
  // unhandled console rejection.
  const [error, setError] = useState<string | null>(null)
  // Sticky display prefs — layout algorithm, per-bucket label-field
  // overrides, per-type edge-field overrides, and the hidden-label set.
  // These live in a localStorage-backed store so they survive a query
  // re-run (which unmounts/remounts GraphView via QueryPage's
  // resetRunState) and a full page reload. Everything else in this
  // component is genuinely result-scoped and stays component-local.
  const layout = useGraphPrefs((s) => s.layout)
  const setLayout = useGraphPrefs((s) => s.setLayout)
  const nodeLabelPrefs = useGraphPrefs((s) => s.nodeLabelPrefs)
  const setNodeLabelPref = useGraphPrefs((s) => s.setNodePref)
  const edgeLabelPrefs = useGraphPrefs((s) => s.edgeLabelPrefs)
  const setEdgeLabelPref = useGraphPrefs((s) => s.setEdgePref)
  // Set of node-label buckets (e.g. 'Movie', 'Person') the user has
  // hidden. Toggled by the visibility checkboxes in the sidebar.
  const hiddenLabels = useGraphPrefs((s) => s.hiddenLabels)
  const toggleHiddenLabel = useGraphPrefs((s) => s.toggleHiddenLabel)
  const setHiddenLabels = useGraphPrefs((s) => s.setHiddenLabels)
  // Which selected-element inspector view ('props' | 'json') the
  // operator last picked. Sticky so it outlives a re-run remount.
  const inspectorView = useGraphPrefs((s) => s.inspectorView)
  const setInspectorView = useGraphPrefs((s) => s.setInspectorView)
  // Canvas interaction mode ('pan' | 'box'). 'box' enables Cytoscape's
  // built-in box selection and disables panning while it's on. Sticky.
  const selectionMode = useGraphPrefs((s) => s.selectionMode)
  const setSelectionMode = useGraphPrefs((s) => s.setSelectionMode)
  // Whether nodes are grouped under per-label compound parent nodes.
  // When on, the rendered element set is buildCompoundElements(baseEls)
  // and the auto-pick layout is fcose (best with compound graphs). Sticky.
  const clusterByLabel = useGraphPrefs((s) => s.clusterByLabel)
  const setClusterByLabel = useGraphPrefs((s) => s.setClusterByLabel)
  // Live counts surfaced in the toolbar. Reflect what's actually in
  // the Cytoscape core (post-build, post-filter), not the raw resp,
  // so users see the effect of layout/filter changes.
  const [counts, setCounts] = useState<{ nodes: number; edges: number }>({
    nodes: 0,
    edges: 0,
  })

  // Track the resp + query by reference so the debounced rebuild
  // always reads the latest snapshot when it fires (without
  // re-creating the timer every render).
  const respRef = useRef(resp)
  respRef.current = resp
  const queryRef = useRef(query)
  queryRef.current = query
  // P-NEW-5: hold the same `elements` snapshot the option / id maps
  // are built from so the build effect doesn't re-walk extractElements
  // a second time. The rebuild trigger (sig) gates on (row_count|query),
  // so when the build callback fires the latest memoized `elements`
  // is the one to render.
  const elementsRef = useRef<ElementDefinition[]>([])

  // Track the latest preference maps so the build effect picks them
  // up without rebuilding when only the preference changes.
  const nodePrefsRef = useRef(nodeLabelPrefs)
  nodePrefsRef.current = nodeLabelPrefs
  const edgePrefsRef = useRef(edgeLabelPrefs)
  edgePrefsRef.current = edgeLabelPrefs
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const selectionModeRef = useRef(selectionMode)
  selectionModeRef.current = selectionMode

  // GAP-01 / GAP-07: rebuild key combines row_count with the query
  // text. Two queries that happen to return the same row count would
  // previously fail to trigger the rebuild and leave a stale graph
  // on the canvas. The clusterByLabel flag is folded in so toggling
  // group-by-label re-runs the build (the rendered element set changes).
  const sig = `${respSignature(resp)}|${query ?? ''}|${clusterByLabel ? 'c' : ''}`

  // The plain element set for this resp (no synthetic cluster parents) —
  // this is what the pickers / visibility buckets / display selectors
  // read. The *rendered* set (`elements`) is the same thing wrapped in
  // per-label compound parents when group-by-label is on.
  const baseEls = useMemo<ElementDefinition[]>(
    () => extractElements(resp, query),
    [resp, query]
  )
  const elements = useMemo<ElementDefinition[]>(
    () => (clusterByLabel ? buildCompoundElements(baseEls) : baseEls),
    [baseEls, clusterByLabel]
  )
  elementsRef.current = elements
  // Options / id index are derived from the plain set so the cluster
  // parents never leak into the dropdowns.
  const nodeOptions = useMemo(() => labelOptions(baseEls), [baseEls])
  const edgeOptions = useMemo(() => typeOptions(baseEls), [baseEls])

  // Per-element id index for the keyboard pickers (GAP-03). Built from
  // the plain element set (`baseEls`) so synthetic cluster parents
  // never show up in the id pickers or visibility buckets.
  const { nodeIds, edgeIds, nodeDataById, edgeDataById, nodeLabelBuckets } =
    useMemo(() => {
      const nIds: string[] = []
      const eIds: string[] = []
      const nMap = new Map<string, Record<string, unknown>>()
      const eMap = new Map<string, Record<string, unknown>>()
      const buckets = new Map<string, number>()
      baseEls.forEach((el) => {
        const data = el.data as Record<string, unknown> | undefined
        if (!data) return
        const id = data.id != null ? String(data.id) : ''
        if (!id) return
        // Cytoscape v3 marks edges by the presence of `source` + `target`
        // on the data bag.
        const isEdge = data.source !== undefined && data.target !== undefined
        if (isEdge) {
          eIds.push(id)
          eMap.set(id, data)
        } else {
          nIds.push(id)
          nMap.set(id, data)
          const bucket = nodeLabelOf(data)
          buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
        }
      })
      return {
        nodeIds: nIds,
        edgeIds: eIds,
        nodeDataById: nMap,
        edgeDataById: eMap,
        nodeLabelBuckets: buckets,
      }
    }, [baseEls])

  // Auto-pick a saner default layout when the response is large enough
  // that cose would freeze the tab. Only fires once per response —
  // the user's manual layout choice is preserved across non-resize
  // re-renders.
  const lastSigRef = useRef<string>('')
  useEffect(() => {
    if (lastSigRef.current === sig) return
    lastSigRef.current = sig
    // A new query result drops any in-progress / shown path. The old
    // core (which carried the highlight classes) is torn down by the
    // build effect, so just reset the state machine here.
    setPathState({ phase: 'off' })
    // …and the hide/collapse bookkeeping — those node ids belong to the
    // graph that's being replaced.
    setHidden(new Set())
    setCollapsed(new Map())
    setExploringId(null)
    if (
      layoutRef.current === DEFAULT_LAYOUT &&
      elementsRef.current.length > COSE_NODE_LIMIT
    ) {
      setLayout('grid')
    }
  }, [sig])

  // Apply visibility filter — doesn't rebuild the core. Toggling
  // `.gv-hidden` is cheap because Cytoscape special-cases display:none
  // to skip layout/render passes for those elements.
  const applyVisibility = useCallback((cy: Core, hidden: Set<string>): void => {
    cy.batch(() => {
      cy.nodes().forEach((n) => {
        const data = n.data() as Record<string, unknown>
        const bucket = nodeLabelOf(data)
        if (hidden.has(bucket)) {
          n.addClass('gv-hidden')
        } else {
          n.removeClass('gv-hidden')
        }
      })
      // Edges adjacent to hidden nodes: hide them as well so the
      // canvas isn't littered with arrows pointing into nothing.
      cy.edges().forEach((e) => {
        const src = e.source()
        const tgt = e.target()
        if (src.hasClass('gv-hidden') || tgt.hasClass('gv-hidden')) {
          e.addClass('gv-hidden')
        } else {
          e.removeClass('gv-hidden')
        }
      })
    })
  }, [])

  // Apply 1-hop neighborhood emphasis around the selected element.
  // No-ops the .gv-faded / .gv-emphasized classes when nothing is
  // selected so the canvas reads at full saturation by default.
  const applyEmphasis = useCallback((cy: Core, sel: Selected | null): void => {
    cy.batch(() => {
      cy.elements().removeClass('gv-faded').removeClass('gv-emphasized')
      if (!sel) return
      const id = String(sel.data.id ?? '')
      if (!id) return
      const target = cy.$id(id)
      if (target.empty()) return
      const neighborhood =
        sel.kind === 'node'
          ? target.closedNeighborhood()
          : target.union(target.connectedNodes())
      cy.elements().difference(neighborhood).addClass('gv-faded')
      neighborhood.addClass('gv-emphasized')
    })
  }, [])

  useEffect(() => {
    if (!ref.current) return undefined
    let canceled = false

    const build = (): void => {
      if (canceled || !ref.current) return
      // GAP-02 / GAP-06: drop the previous selection so the inspector
      // doesn't keep showing data from a graph that was just torn
      // down. Reset before any throw so the side panel never shows
      // stale state.
      setSelected(null)
      setError(null)
      // Tear down a previous core if any. We accept this cost because
      // the rebuild is gated by row_count + debounce (PERF-F9), so a
      // streaming run produces exactly one teardown+rebuild instead of
      // one per row.
      if (cyRef.current) {
        cyRef.current.destroy()
        cyRef.current = null
      }
      try {
        // P-NEW-5: reuse the memoized snapshot from `elements` instead
        // of re-walking the full resp here. extractElements on a 5k-
        // element resp is non-trivial; we already paid the cost in
        // the useMemo that drives `nodeOptions` / `edgeOptions`.
        const els = elementsRef.current
        // GAP-05: when the response has no graph elements (e.g. a
        // scalar projection like RETURN p.name), skip the cytoscape
        // mount entirely. The render pass shows an empty-state
        // overlay over the bare Canvas.
        if (els.length === 0) {
          setCounts({ nodes: 0, edges: 0 })
          return
        }
        const cy = cytoscape({
          container: ref.current,
          elements: els,
          style: createCytoscapeStyle(theme),
          layout: layoutConfig(layoutRef.current),
          wheelSensitivity: 0.2,
        })
        cy.on('tap', 'node', (ev) => {
          const id = ev.target.id() as string
          // In path mode the first/second tap pick the path endpoints;
          // the handler returns true to swallow the tap. Otherwise fall
          // through to the normal inspector-select behaviour.
          if (pathTapRef.current(id)) return
          const data = ev.target.data() as Record<string, unknown>
          setSelected({ kind: 'node', data })
        })
        cy.on('tap', 'edge', (ev) => {
          const data = ev.target.data() as Record<string, unknown>
          setSelected({ kind: 'edge', data })
        })
        cy.on('tap', (ev) => {
          if (ev.target === cy) setSelected(null)
        })
        cyRef.current = cy
        // Apply current label preferences to this fresh core. Subsequent
        // pref changes are handled by the dedicated effect below without
        // re-running the layout.
        applyLabels(cy, nodePrefsRef.current, edgePrefsRef.current)
        // Seed the canvas interaction mode (pan / box select) on the
        // fresh core; later toggles are handled by the dedicated effect.
        applySelectionMode(cy, selectionModeRef.current)
        setCounts({ nodes: cy.nodes().length, edges: cy.edges().length })
      } catch (e: unknown) {
        // GAP-04: surface the failure as a visible banner instead of
        // an uncaught console rejection. The build is best-effort —
        // the rest of the page (sidebar, picker) still works.
        setError(e instanceof Error ? e.message : String(e))
      }
    }

    const timer = setTimeout(build, REBUILD_DEBOUNCE_MS)

    return () => {
      canceled = true
      clearTimeout(timer)
      if (cyRef.current) {
        cyRef.current.destroy()
        cyRef.current = null
      }
    }
    // theme is intentionally NOT a dep — theme flips swap the stylesheet
    // via the dedicated effect below without rebuilding the core.
  }, [sig])

  // Re-apply labels when preferences change. This does NOT rebuild
  // the core or run the layout — it just rewrites data.label on the
  // existing nodes/edges so cytoscape's style binding picks up the
  // new value.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    applyLabels(cy, nodeLabelPrefs, edgeLabelPrefs)
  }, [nodeLabelPrefs, edgeLabelPrefs])

  // Live theme swap: rebuild the stylesheet when light↔dark flips.
  // No layout rerun — Cytoscape recomputes node fills, label colors,
  // and edge styles from the new tokens against existing positions.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.style(createCytoscapeStyle(theme)).update()
  }, [theme])

  // Re-run the layout when the user picks a different one. We do NOT
  // tear down the core; .layout().run() re-positions in place.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.layout(layoutConfig(layout)).run()
    cy.fit(undefined, 24)
  }, [layout])

  // Canvas interaction-mode changes — apply to the live core. Cheap;
  // just flips two Cytoscape flags.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    applySelectionMode(cy, selectionMode)
  }, [selectionMode])

  // Visibility filter changes — re-run the apply pass against the
  // current core. Cheap; just toggles a class.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    applyVisibility(cy, hiddenLabels)
  }, [hiddenLabels, applyVisibility])

  // Phase-2 per-node hide set changes — re-assert the `.hidden-node`
  // class on every tracked id. The Hide/Collapse handlers already add
  // the class directly; this effect is the idempotent backstop so the
  // `hidden` set is the source of truth (and a future re-render path
  // that re-derives classes can't drop a hide). Cheap — addClass on an
  // already-classed element is a no-op.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.batch(() => {
      hidden.forEach((nodeId) => {
        cy.getElementById(nodeId).addClass('hidden-node')
      })
    })
  }, [hidden])

  // When the canvas box changes size — the maximize toggle flips, the
  // window resizes, the sidebar collapses/expands, or the container
  // reflows for any other reason — Cytoscape needs to recompute its
  // renderer viewport and re-fit the graph to the new box; otherwise
  // the graph stays drawn at the old size in the corner of a now-larger
  // (or clipped in a now-smaller) canvas. A ResizeObserver on the
  // Canvas element catches *all* of those, not just the discrete
  // `effectiveHeight`-prop changes the previous height-keyed effect
  // saw. The callback is rAF-debounced so a burst of resize entries
  // collapses to a single resize()+fit(). Guarded for jsdom (the unit
  // tests get a no-op ResizeObserver stub from polyfills.js, so the
  // observer simply never fires there — those tests assert on markup,
  // not on cy.fit calls).
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (typeof ResizeObserver === 'undefined') return undefined
    let raf = 0
    const refit = (): void => {
      raf = 0
      const cy = cyRef.current
      if (!cy) return
      cy.resize()
      cy.fit(undefined, 24)
    }
    const schedule = (): void => {
      if (typeof requestAnimationFrame !== 'function') {
        refit()
        return
      }
      if (raf) return
      raf = requestAnimationFrame(refit)
    }
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (raf && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(raf)
      }
    }
  }, [])

  // Selected element changes — drive the emphasis (1-hop) styling.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    applyEmphasis(cy, selected)
  }, [selected, applyEmphasis])

  const setNodePref = (label: string, key: string): void => {
    setNodeLabelPref(label, key)
  }
  const setEdgePref = (type: string, key: string): void => {
    setEdgeLabelPref(type, key)
  }

  // GAP-03: keyboard-only operators can't tap on the canvas. The id
  // pickers below let them select a node or edge via the Display
  // panel; this handler resolves the typed/picked id back to the
  // element's data and updates the inspector. We also call cy.$id
  // when the core is mounted so the canvas highlights the selection.
  const onPickNodeId = (rawId: string): void => {
    const id = rawId.trim()
    if (!id) return
    const data = nodeDataById.get(id)
    if (!data) return
    setSelected({ kind: 'node', data })
    cyRef.current?.$id(id).select()
  }
  const onToggleSelectionMode = (): void => {
    setSelectionMode(selectionMode === 'box' ? 'pan' : 'box')
  }
  const onToggleClusterByLabel = (): void => {
    const next = !clusterByLabel
    setClusterByLabel(next)
    // Switching clustering ON auto-picks fcose (it lays out compound
    // graphs best). We don't force it back off when clustering is
    // turned off, and a subsequent manual layout pick is respected.
    if (next) setLayout('fcose')
  }

  // Path mode — enter / exit and the per-node-tap state advance. The
  // tap handler registered in the build effect calls handlePathNodeTap
  // via pathTapRef so it always reads the current pathState; when path
  // mode is off it returns false and the tap falls through to the
  // normal "select for inspector" behaviour.
  const enterPathMode = (): void => {
    const cy = cyRef.current
    if (cy) clearPathHighlight(cy)
    setPathState({ phase: 'pickSource' })
  }
  const exitPathMode = (): void => {
    const cy = cyRef.current
    if (cy) clearPathHighlight(cy)
    setPathState({ phase: 'off' })
  }
  const onTogglePathMode = (): void => {
    if (pathState.phase === 'off') {
      enterPathMode()
    } else {
      exitPathMode()
    }
  }
  const handlePathNodeTap = (nodeId: string): boolean => {
    const state = pathStateRef.current
    if (state.phase === 'off') return false
    const cy = cyRef.current
    if (!cy) return true
    if (state.phase === 'pickSource' || state.phase === 'shown') {
      clearPathHighlight(cy)
      setPathState({ phase: 'pickTarget', sourceId: nodeId })
      return true
    }
    // pickTarget — run Dijkstra from the recorded source to this node.
    const src = cy.getElementById(state.sourceId)
    const dst = cy.getElementById(nodeId)
    clearPathHighlight(cy)
    const dij = cy.elements().dijkstra({ root: src, directed: false })
    const path = dij.pathTo(dst)
    if (!path || path.length === 0) {
      setPathState({
        phase: 'shown',
        from: state.sourceId,
        to: nodeId,
        hops: null,
      })
      return true
    }
    cy.elements().difference(path).addClass('dimmed')
    path.addClass('highlighted')
    setPathState({
      phase: 'shown',
      from: state.sourceId,
      to: nodeId,
      hops: path.edges().length,
    })
    return true
  }
  const pathTapRef = useRef(handlePathNodeTap)
  pathTapRef.current = handlePathNodeTap
  const onPickEdgeId = (rawId: string): void => {
    const id = rawId.trim()
    if (!id) return
    const data = edgeDataById.get(id)
    if (!data) return
    setSelected({ kind: 'edge', data })
    cyRef.current?.$id(id).select()
  }

  const toggleLabelVisibility = (label: string): void => {
    toggleHiddenLabel(label)
  }

  const onZoomIn = (): void => {
    const cy = cyRef.current
    if (!cy) return
    cy.zoom({
      level: cy.zoom() * 1.25,
      renderedPosition: {
        x: cy.width() / 2,
        y: cy.height() / 2,
      },
    })
  }
  const onZoomOut = (): void => {
    const cy = cyRef.current
    if (!cy) return
    cy.zoom({
      level: cy.zoom() / 1.25,
      renderedPosition: {
        x: cy.width() / 2,
        y: cy.height() / 2,
      },
    })
  }
  const onFit = (): void => {
    cyRef.current?.fit(undefined, 24)
  }
  const onResetView = (): void => {
    const cy = cyRef.current
    if (!cy) return
    setSelected(null)
    setHiddenLabels(new Set())
    cy.layout(layoutConfig(layout)).run()
    cy.fit(undefined, 24)
  }

  // ----- Phase-2 hide / collapse handlers -----

  // Hide the selected node. Adds the `.hidden-node` class on the core,
  // records the id, and deselects (the node is gone from the canvas, so
  // keeping it in the inspector would be confusing).
  const onHideNode = (id: string): void => {
    const cy = cyRef.current
    if (!cy || !id) return
    hideNode(cy, id)
    setHidden((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    setSelected(null)
  }

  // Collapse the selected node — fold its degree-1 leaf neighbours
  // behind it. Records (id → hiddenLeafIds); the leaves also go into the
  // `hidden` set (so the Hidden list can restore an individual one) but
  // are tracked under `collapsed` so an Expand restores the whole group.
  // The node stays selected; the inspector shows "N neighbours collapsed".
  const onCollapseNode = (id: string): void => {
    const cy = cyRef.current
    if (!cy || !id) return
    const leaves = collapseNode(cy, id)
    if (leaves.length === 0) return
    setCollapsed((prev) => {
      const next = new Map(prev)
      const existing = next.get(id) ?? []
      next.set(id, Array.from(new Set([...existing, ...leaves])))
      return next
    })
    setHidden((prev) => {
      const next = new Set(prev)
      leaves.forEach((l) => next.add(l))
      return next
    })
  }

  // Restore an individually-hidden node — un-hide on the core, drop it
  // from `hidden`, and also drop it from any collapsed group it belonged
  // to (so the group's count stays accurate; an emptied group is removed).
  const onRestoreHidden = (id: string): void => {
    const cy = cyRef.current
    if (cy) restoreNode(cy, id)
    setHidden((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setCollapsed((prev) => {
      let changed = false
      const next = new Map<string, string[]>()
      prev.forEach((leaves, nodeId) => {
        const filtered = leaves.filter((l) => l !== id)
        if (filtered.length !== leaves.length) changed = true
        if (filtered.length > 0) next.set(nodeId, filtered)
        else changed = true
      })
      return changed ? next : prev
    })
  }

  // Expand a collapsed node — un-hide every leaf in its stored group,
  // drop them from `hidden`, and remove the group from `collapsed`.
  const onExpandCollapsed = (nodeId: string): void => {
    const cy = cyRef.current
    const leaves = collapsed.get(nodeId) ?? []
    if (cy) expandCollapsed(cy, leaves)
    setHidden((prev) => {
      const next = new Set(prev)
      leaves.forEach((l) => next.delete(l))
      return next
    })
    setCollapsed((prev) => {
      if (!prev.has(nodeId)) return prev
      const next = new Map(prev)
      next.delete(nodeId)
      return next
    })
  }

  // "Explore neighbours" — fetch the selected node's 1-hop subgraph via
  // a fresh GQL query against the connected graph and merge the new
  // elements into the live core, then re-run the current layout so they
  // get positioned. No-ops for a node without a real Geode id (the
  // inspector disables the action for those). Errors surface via the
  // existing canvas error banner.
  const onExploreNeighbours = (id: string): void => {
    const cy = cyRef.current
    if (!cy || !id || exploringId) return
    if (!isRealNodeId(id)) return
    setExploringId(id)
    setError(null)
    client
      .query({
        statement: buildExploreStatement(id),
        graph: graphNameOf(queryRef.current),
        page_size: 200,
        timeout_ms: 30000,
      })
      .then((result) => {
        const live = cyRef.current
        if (!live) return
        const newEls = extractElements(result as QueryRespLike)
        const added = mergeSubgraph(live, newEls)
        if (added.length > 0) {
          live.layout(layoutConfig(layoutRef.current)).run()
          live.fit(undefined, 24)
        }
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        setError(t('graph.exploreNeighboursFailed', { message: msg }))
      })
      .finally(() => {
        setExploringId((cur) => (cur === id ? null : cur))
      })
  }

  // Resolve a node id to a short display label for the restore lists —
  // the per-bucket label-field preference if set, else the label name /
  // the id. Falls back to the id when the node isn't in the index (e.g.
  // an explore-neighbours merge added it and the index hasn't caught up).
  const nodeDisplayLabel = (id: string): string => {
    const data = nodeDataById.get(id)
    if (!data) return id
    return resolveNodeLabel(data, nodeLabelPrefs)
  }
  const hiddenIds = Array.from(hidden)
  const collapsedEntries = Array.from(collapsed.entries())

  const empty = elements.length === 0 && !error
  // Reuse the same hash + palette the canvas uses so the swatches in
  // the visibility row are exact-pixel matches to the node fills.
  const swatchFor = (label: string): string =>
    labelToColor(label, theme.variant)

  // Path-mode status text for the line under the toolbar.
  let pathStatusText: string | null = null
  if (pathState.phase === 'pickSource') {
    pathStatusText = t('graph.pathPickSource')
  } else if (pathState.phase === 'pickTarget') {
    pathStatusText = t('graph.pathPickTarget')
  } else if (pathState.phase === 'shown' && pathState.hops === null) {
    pathStatusText = t('graph.pathNone', {
      from: pathState.from,
      to: pathState.to,
    })
  } else if (pathState.phase === 'shown') {
    pathStatusText = t('graph.pathResult', {
      from: pathState.from,
      to: pathState.to,
      hops: pathState.hops,
    })
  }

  return (
    <Wrap $fill={fillHeight} $sidebarCollapsed={sidebarCollapsed}>
      <CanvasArea>
        <Toolbar data-testid="graph-toolbar" role="toolbar">
          <div className="group">
            <button
              type="button"
              data-testid="graph-sidebar-toggle"
              aria-pressed={sidebarCollapsed}
              aria-label={
                sidebarCollapsed
                  ? t('graph.expandSidebar')
                  : t('graph.collapseSidebar')
              }
              title={
                sidebarCollapsed
                  ? t('graph.expandSidebar')
                  : t('graph.collapseSidebar')
              }
              onClick={() => setSidebarCollapsed((c) => !c)}
            >
              {sidebarCollapsed ? '⮜' : '⮞'}
            </button>
          </div>
          <div className="group">
            <span className="label">{t('graph.layoutLabel')}</span>
            <select
              data-testid="graph-layout-picker"
              aria-label={t('graph.layoutLabel')}
              value={layout}
              onChange={(e) => setLayout(e.target.value as LayoutName)}
            >
              {LAYOUTS.map((name) => (
                <option key={name} value={name}>
                  {layoutLabel(name, t)}
                </option>
              ))}
            </select>
          </div>
          <div className="group">
            <button
              type="button"
              data-testid="graph-zoom-in"
              aria-label={t('graph.zoomIn')}
              title={t('graph.zoomIn')}
              onClick={onZoomIn}
            >
              +
            </button>
            <button
              type="button"
              data-testid="graph-zoom-out"
              aria-label={t('graph.zoomOut')}
              title={t('graph.zoomOut')}
              onClick={onZoomOut}
            >
              −
            </button>
            <button
              type="button"
              data-testid="graph-fit"
              aria-label={t('graph.fit')}
              title={t('graph.fit')}
              onClick={onFit}
            >
              {t('graph.fit')}
            </button>
            <button
              type="button"
              data-testid="graph-reset-view"
              aria-label={t('graph.resetView')}
              title={t('graph.resetView')}
              onClick={onResetView}
            >
              {t('graph.resetView')}
            </button>
          </div>
          <div className="group">
            <button
              type="button"
              data-testid="graph-selection-mode"
              aria-pressed={selectionMode === 'box'}
              aria-label={t('graph.selectionModeLabel')}
              title={
                selectionMode === 'box'
                  ? t('graph.selectionModeBox')
                  : t('graph.selectionModePan')
              }
              onClick={onToggleSelectionMode}
            >
              {selectionMode === 'box'
                ? t('graph.selectionModeBox')
                : t('graph.selectionModePan')}
            </button>
            <button
              type="button"
              data-testid="graph-cluster-toggle"
              aria-pressed={clusterByLabel}
              aria-label={t('graph.clusterByLabelLabel')}
              title={t('graph.clusterByLabelLabel')}
              onClick={onToggleClusterByLabel}
            >
              {t('graph.clusterByLabel')}
            </button>
            <button
              type="button"
              data-testid="graph-path-mode"
              aria-pressed={pathState.phase !== 'off'}
              aria-label={t('graph.pathModeLabel')}
              title={t('graph.pathModeLabel')}
              onClick={onTogglePathMode}
            >
              {t('graph.pathMode')}
            </button>
            {pathState.phase !== 'off' && (
              <button
                type="button"
                data-testid="graph-path-clear"
                onClick={exitPathMode}
              >
                {t('graph.pathClear')}
              </button>
            )}
          </div>
          <span className="stats" aria-live="polite">
            {t('graph.stats', { nodes: counts.nodes, edges: counts.edges })}
          </span>
        </Toolbar>
        {pathStatusText && (
          <PathStatus data-testid="graph-path-status" role="status">
            {pathStatusText}
          </PathStatus>
        )}
        <div style={{ position: 'relative' }}>
          <Canvas
            ref={ref}
            $height={effectiveHeight}
            role="img"
            aria-label={t('graph.canvasAria')}
          />
          {empty && (
            <Overlay data-testid="graph-empty-state">
              {t('graph.empty')}
            </Overlay>
          )}
          {error && (
            <ErrorBanner role="alert">
              {t('graph.errorBanner', { message: error })}
            </ErrorBanner>
          )}
        </div>
      </CanvasArea>
      {!sidebarCollapsed && (
        <Side $height={effectiveHeight} $fill={fillHeight}>
          {nodeLabelBuckets.size > 1 && (
            <ControlsBlock data-testid="graph-visibility-controls">
              <h5>{t('graph.visibilityHeading')}</h5>
              {Array.from(nodeLabelBuckets.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([label, count]) => {
                  const id = `gv-vis-${label || 'unlabeled'}`
                  return (
                    <label
                      key={label || 'unlabeled'}
                      className="toggle-row"
                      htmlFor={id}
                    >
                      <input
                        id={id}
                        type="checkbox"
                        checked={!hiddenLabels.has(label)}
                        onChange={() => toggleLabelVisibility(label)}
                      />
                      <span
                        className="swatch"
                        style={{ background: swatchFor(label) }}
                        aria-hidden="true"
                      />
                      <span className="toggle-label">
                        {label || `(${t('graph.unlabeledNode')})`}
                      </span>
                      <span className="empty">{count}</span>
                    </label>
                  )
                })}
            </ControlsBlock>
          )}
          {(nodeIds.length > 0 || edgeIds.length > 0) && (
            <ControlsBlock data-testid="graph-selection-controls">
              <h5>{t('graph.selectionHeading')}</h5>
              {nodeIds.length > 0 && (
                <div className="row">
                  <span>{t('graph.selectNodeById')}</span>
                  <input
                    list="graph-node-ids"
                    data-testid="graph-node-id-picker"
                    aria-label={t('graph.selectNodeById')}
                    placeholder={t('graph.nodeIdPlaceholder')}
                    onChange={(e) => onPickNodeId(e.target.value)}
                  />
                  <datalist id="graph-node-ids">
                    {nodeIds.slice(0, ID_PICKER_OPTION_CAP).map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </datalist>
                </div>
              )}
              {edgeIds.length > 0 && (
                <div className="row">
                  <span>{t('graph.selectEdgeById')}</span>
                  <input
                    list="graph-edge-ids"
                    data-testid="graph-edge-id-picker"
                    aria-label={t('graph.selectEdgeById')}
                    placeholder={t('graph.edgeIdPlaceholder')}
                    onChange={(e) => onPickEdgeId(e.target.value)}
                  />
                  <datalist id="graph-edge-ids">
                    {edgeIds.slice(0, ID_PICKER_OPTION_CAP).map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </datalist>
                </div>
              )}
            </ControlsBlock>
          )}
          <ControlsBlock data-testid="graph-display-controls">
            <h5>{t('graph.displayHeading')}</h5>
            {nodeOptions.size === 0 ? (
              <p className="empty">{t('graph.noNodesToConfigure')}</p>
            ) : (
              Array.from(nodeOptions.entries()).map(([label, opts]) => (
                <div className="row" key={`n-${label}`}>
                  <span>{label || `(${t('graph.unlabeledNode')})`}</span>
                  <select
                    aria-label={t('graph.nodeFieldLabel', {
                      label: label || t('graph.unlabeledNode'),
                    })}
                    value={nodeLabelPrefs[label] ?? NODE_LABEL_DEFAULT}
                    onChange={(e) => setNodePref(label, e.target.value)}
                  >
                    {opts.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt === NODE_LABEL_DEFAULT
                          ? `(${t('graph.optionLabelName')})`
                          : opt}
                      </option>
                    ))}
                  </select>
                </div>
              ))
            )}
            {edgeOptions.size > 0 &&
              Array.from(edgeOptions.entries()).map(([type, opts]) => (
                <div className="row" key={`e-${type}`}>
                  <span>{type}</span>
                  <select
                    aria-label={t('graph.edgeFieldLabel', { type })}
                    value={edgeLabelPrefs[type] ?? EDGE_TYPE_DEFAULT}
                    onChange={(e) => setEdgePref(type, e.target.value)}
                  >
                    {opts.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt === EDGE_TYPE_DEFAULT
                          ? `(${t('graph.optionType')})`
                          : opt}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
          </ControlsBlock>
          <ControlsBlock data-testid="graph-hidden-list">
            <h5>{t('graph.hiddenHeading', { count: hiddenIds.length })}</h5>
            {hiddenIds.length === 0 ? (
              <p className="empty">{t('graph.hiddenEmpty')}</p>
            ) : (
              <RestoreList>
                {hiddenIds.map((id) => {
                  const label = nodeDisplayLabel(id)
                  return (
                    <li key={id}>
                      <span className="restore-label">
                        {label !== id && <span>{label} </span>}
                        <span className="restore-id">{id}</span>
                      </span>
                      <button type="button" onClick={() => onRestoreHidden(id)}>
                        {t('graph.restore')}
                      </button>
                    </li>
                  )
                })}
              </RestoreList>
            )}
          </ControlsBlock>
          <ControlsBlock data-testid="graph-collapsed-list">
            <h5>
              {t('graph.collapsedHeading', { count: collapsedEntries.length })}
            </h5>
            {collapsedEntries.length === 0 ? (
              <p className="empty">{t('graph.collapsedEmpty')}</p>
            ) : (
              <RestoreList>
                {collapsedEntries.map(([id, leaves]) => {
                  const label = nodeDisplayLabel(id)
                  return (
                    <li key={id}>
                      <span className="restore-label">
                        {label !== id && <span>{label} </span>}
                        <span className="restore-id">{id}</span>
                        <span> · </span>
                        <span>
                          {t('graph.collapsedCount', { count: leaves.length })}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => onExpandCollapsed(id)}
                      >
                        {t('graph.expand')}
                      </button>
                    </li>
                  )
                })}
              </RestoreList>
            )}
          </ControlsBlock>
          {selected ? (
            <SelectedInspector
              selected={selected}
              view={inspectorView}
              onSetView={setInspectorView}
              onHide={onHideNode}
              onCollapse={onCollapseNode}
              onExplore={onExploreNeighbours}
              exploreLoading={
                selected.kind === 'node' &&
                exploringId === String(selected.data.id ?? '')
              }
              exploreDisabled={
                selected.kind === 'node' &&
                !isRealNodeId(String(selected.data.id ?? ''))
              }
              collapsedCount={
                selected.kind === 'node'
                  ? (collapsed.get(String(selected.data.id ?? '')) ?? []).length
                  : 0
              }
              t={t}
            />
          ) : (
            <p style={{ opacity: 0.6 }}>{t('graph.inspectHint')}</p>
          )}
        </Side>
      )}
    </Wrap>
  )
}
