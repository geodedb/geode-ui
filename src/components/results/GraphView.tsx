import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cytoscape, { Core, ElementDefinition } from 'cytoscape'
import styled, { useTheme } from 'styled-components'
import { createCytoscapeStyle, labelToColor } from './cytoscapeStyle'
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
  extractElements,
  labelOptions,
  resolveEdgeLabel,
  resolveNodeLabel,
  typeOptions,
} from '../../lib/graphResult'

type Selected = { kind: 'node' | 'edge'; data: Record<string, unknown> }

// Layouts shipped with cytoscape core (no extra plugin needed). cose
// is the only force-directed option available without a plugin and is
// the right default for unknown topologies; the others are useful for
// known shapes (chains, clusters, time-ordered scans). LayoutName /
// DEFAULT_LAYOUT live in useGraphPrefs (the sticky-prefs store).

const LAYOUTS: readonly LayoutName[] = [
  'cose',
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

// Above this node count the cose force-directed layout becomes
// noticeably sluggish (O(N²) repulsion sums). Fall back to grid as a
// safer auto default; users can still pick cose explicitly via the
// dropdown.
const COSE_NODE_LIMIT = 400

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
  t: (key: string, opts?: Record<string, unknown>) => string
}> = ({ selected, view, onSetView, t }) => {
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

  // GAP-01 / GAP-07: rebuild key combines row_count with the query
  // text. Two queries that happen to return the same row count would
  // previously fail to trigger the rebuild and leave a stale graph
  // on the canvas.
  const sig = `${respSignature(resp)}|${query ?? ''}`

  // Compute available options from the current resp (cheap; same data
  // extractElements would walk). The build effect reads through
  // elementsRef so the per-rebuild teardown doesn't repeat the work.
  const elements = useMemo<ElementDefinition[]>(
    () => extractElements(resp, query),
    [resp, query]
  )
  elementsRef.current = elements
  const nodeOptions = useMemo(() => labelOptions(elements), [elements])
  const edgeOptions = useMemo(() => typeOptions(elements), [elements])

  // Per-element id index for the keyboard pickers (GAP-03). Both
  // arrays are derived from the memoized `elements` so they're cheap
  // to recompute on resp change.
  const { nodeIds, edgeIds, nodeDataById, edgeDataById, nodeLabelBuckets } =
    useMemo(() => {
      const nIds: string[] = []
      const eIds: string[] = []
      const nMap = new Map<string, Record<string, unknown>>()
      const eMap = new Map<string, Record<string, unknown>>()
      const buckets = new Map<string, number>()
      elements.forEach((el) => {
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
    }, [elements])

  // Auto-pick a saner default layout when the response is large enough
  // that cose would freeze the tab. Only fires once per response —
  // the user's manual layout choice is preserved across non-resize
  // re-renders.
  const lastSigRef = useRef<string>('')
  useEffect(() => {
    if (lastSigRef.current === sig) return
    lastSigRef.current = sig
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
          layout: { name: layoutRef.current, animate: false, padding: 24 },
          wheelSensitivity: 0.2,
        })
        cy.on('tap', 'node', (ev) => {
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
    cy.layout({ name: layout, animate: false, padding: 24 }).run()
    cy.fit(undefined, 24)
  }, [layout])

  // Visibility filter changes — re-run the apply pass against the
  // current core. Cheap; just toggles a class.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    applyVisibility(cy, hiddenLabels)
  }, [hiddenLabels, applyVisibility])

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
    cy.layout({ name: layout, animate: false, padding: 24 }).run()
    cy.fit(undefined, 24)
  }

  const empty = elements.length === 0 && !error
  // Reuse the same hash + palette the canvas uses so the swatches in
  // the visibility row are exact-pixel matches to the node fills.
  const swatchFor = (label: string): string =>
    labelToColor(label, theme.variant)

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
          <span className="stats" aria-live="polite">
            {t('graph.stats', { nodes: counts.nodes, edges: counts.edges })}
          </span>
        </Toolbar>
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
          {selected ? (
            <SelectedInspector
              selected={selected}
              view={inspectorView}
              onSetView={setInspectorView}
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
