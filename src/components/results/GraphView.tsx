import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cytoscape, { Core } from 'cytoscape'
import fcose from 'cytoscape-fcose'
import dagre from 'cytoscape-dagre'
import { useTheme } from 'styled-components'
import { labelToColor } from './cytoscapeStyle'
import { DEFAULT_LAYOUT, useGraphPrefs } from './useGraphPrefs'
import { QueryRespLike, resolveNodeLabel } from '../../lib/graphResult'
import { useGraphPathMode } from './graph/useGraphPathMode'
import { useFillHeight } from './graph/useFillHeight'
import { GraphToolbar } from './graph/GraphToolbar'
import { GraphMiniMap } from './graph/GraphMiniMap'
import { GraphSidebar } from './graph/GraphSidebar'
import { GraphSidebarContents } from './graph/GraphSidebarContents'
import { useGraphElements } from './graph/useGraphElements'
import { useGraphActions } from './graph/useGraphActions'
import { useGraphCytoscape } from './graph/useGraphCytoscape'
import { usePinnedNodes } from './graph/usePinnedNodes'
import { useFocusMode } from './graph/useFocusMode'
import {
  COSE_NODE_LIMIT,
  LAYOUTS,
  layoutConfig,
  layoutLabel,
} from './graph/layouts'
import { respSignature } from './graph/cyHelpers'
import type { Neighbor, Selected } from './graph/GraphInspector'
import { NodeContextMenu, NodeContextMenuAction } from './graph/NodeContextMenu'
import { useNodeContextMenu } from './graph/useNodeContextMenu'
import { ExpandQueryPopover, ExpandRunOpts } from './graph/ExpandQueryPopover'
import { useGraphKeyboardNav } from './graph/useGraphKeyboardNav'
import {
  Canvas,
  CanvasArea,
  ErrorBanner,
  Overlay,
  PathStatus,
  Wrap,
} from './graph/styled'

// Register the layout extensions once, at module load. cytoscape.use is
// idempotent in cytoscape@3 — a double-register (e.g. a test re-import)
// is a no-op. fcose is a faster force layout that also handles compound
// (clustered) graphs; dagre is a layered DAG layout for directed /
// hierarchical shapes. Both are surfaced in the layout picker (Task 1.2)
// and fcose is the auto-pick when group-by-label clustering is on
// (Task 1.4).
cytoscape.use(fcose)
cytoscape.use(dagre)

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
  const effectiveHeight = useFillHeight({ fillHeight, height })
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
  // Set of node-label buckets the user has hidden. Toggled by the
  // visibility checkboxes in the sidebar.
  const hiddenLabels = useGraphPrefs((s) => s.hiddenLabels)
  const toggleHiddenLabel = useGraphPrefs((s) => s.toggleHiddenLabel)
  const setHiddenLabels = useGraphPrefs((s) => s.setHiddenLabels)
  // Sticky inspector view ('props' | 'json') so it outlives a re-run remount.
  const inspectorView = useGraphPrefs((s) => s.inspectorView)
  const setInspectorView = useGraphPrefs((s) => s.setInspectorView)
  // Canvas interaction mode ('pan' | 'box'). Sticky.
  const selectionMode = useGraphPrefs((s) => s.selectionMode)
  const setSelectionMode = useGraphPrefs((s) => s.setSelectionMode)
  // Group nodes under per-label compound parents. When on, the rendered
  // set is buildCompoundElements(baseEls) and fcose is the auto-pick. Sticky.
  const clusterByLabel = useGraphPrefs((s) => s.clusterByLabel)
  const setClusterByLabel = useGraphPrefs((s) => s.setClusterByLabel)
  // Whether node width/height scales with degree (log-scaled). When off,
  // nodes render at the legacy flat 38px. Sticky.
  const degreeSizing = useGraphPrefs((s) => s.degreeSizing)
  const setDegreeSizing = useGraphPrefs((s) => s.setDegreeSizing)
  // Mini-map overview panel toggle (sticky, default off). When on,
  // the GraphMiniMap component is mounted inside the canvas wrapper and
  // attaches a cytoscape-navigator instance to the live cy core.
  const miniMap = useGraphPrefs((s) => s.miniMap)
  const setMiniMap = useGraphPrefs((s) => s.setMiniMap)
  // Path-mode state machine + handlers. Result-scoped — `resetPath` is
  // invoked from the sig-keyed reset effect below.
  const {
    pathState,
    pathTapRef,
    onTogglePathMode,
    exitPathMode,
    resetPath,
    pathStatusText,
  } = useGraphPathMode({ cyRef, t })
  // Live counts surfaced in the toolbar — what's actually in the
  // Cytoscape core (post-build, post-filter), not the raw resp.
  const [counts, setCounts] = useState<{ nodes: number; edges: number }>({
    nodes: 0,
    edges: 0,
  })

  // Element-set + derived indices (memoized on resp/query/cluster).
  const {
    elements,
    nodeOptions,
    edgeOptions,
    nodeIds,
    edgeIds,
    nodeDataById,
    edgeDataById,
    nodeLabelBuckets,
  } = useGraphElements({ resp, query, clusterByLabel, degreeSizing })

  // Refs the debounced build callback reads on fire — they always hold
  // the latest snapshot without re-creating the timer every render.
  const queryRef = useRef(query)
  queryRef.current = query
  const elementsRef = useRef(elements)
  elementsRef.current = elements
  const nodePrefsRef = useRef(nodeLabelPrefs)
  nodePrefsRef.current = nodeLabelPrefs
  const edgePrefsRef = useRef(edgeLabelPrefs)
  edgePrefsRef.current = edgeLabelPrefs
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const selectionModeRef = useRef(selectionMode)
  selectionModeRef.current = selectionMode

  // Phase-2 hide/collapse workflow + the "Explore neighbours" fetch flow.
  // Result-scoped state — the sig-keyed reset effect below clears all
  // three setters on a new query result.
  const {
    hidden,
    collapsed,
    exploringId,
    setHidden,
    setCollapsed,
    setExploringId,
    onHideNode,
    onCollapseNode,
    onRestoreHidden,
    onExpandCollapsed,
    onExploreNeighbours,
  } = useGraphActions({
    cyRef,
    layoutRef,
    queryRef,
    setSelected,
    setError,
    t,
  })

  // Result-scoped pin bookkeeping. The hook owns the locked-id Set; the
  // sig-keyed reset effect below clears it on a new query result, and
  // useGraphCytoscape calls `reapplyAll` after a rebuild / layout swap
  // so the lock survives a fresh cy core.
  const pinning = usePinnedNodes({ cyRef })

  // Result-scoped focus-mode bookkeeping. Mirrors `pinning`: the hook
  // owns the { id, hops } state; the sig-keyed reset effect below clears
  // it on a new query result; useGraphCytoscape calls `reapply` after a
  // rebuild / layout swap so the .gv-out-of-focus class set survives a
  // fresh cy core. The hops *slider value* is sticky via useGraphPrefs
  // (the focal node id is genuinely result-scoped).
  const focusMode = useFocusMode({ cyRef })
  const focusHops = useGraphPrefs((s) => s.focusHops)
  const setFocusHops = useGraphPrefs((s) => s.setFocusHops)

  // GAP-01 / GAP-07: rebuild key combines row_count with the query
  // text. Two queries with the same row count would otherwise leave a
  // stale graph on the canvas. Cluster toggle is folded in so toggling
  // group-by-label re-runs the build.
  const sig = `${respSignature(resp)}|${query ?? ''}|${clusterByLabel ? 'c' : ''}|${degreeSizing ? 'd' : ''}`

  // Auto-pick grid for large responses (cose would freeze the tab).
  // Only fires once per response — the user's manual layout choice is
  // preserved across non-resize re-renders.
  const lastSigRef = useRef<string>('')
  useEffect(() => {
    if (lastSigRef.current === sig) return
    lastSigRef.current = sig
    // A new query result drops any in-progress / shown path. The old
    // core (which carried the highlight classes) is torn down by the
    // build effect, so just reset the state machine here.
    resetPath()
    // …and the hide/collapse bookkeeping — those node ids belong to the
    // graph that's being replaced.
    setHidden(new Set())
    setCollapsed(new Map())
    setExploringId(null)
    // Pinned ids belong to the graph being replaced — drop them too.
    // `clear()` calls apply() per id; cyRef may be null (build effect
    // has torn down the old core but not built the new one yet) or it
    // may point at the fresh core. Either is fine — apply() is null-safe
    // and the new core won't contain any of those ids yet anyway, so
    // node.empty() short-circuits.
    pinning.clear()
    // Same rationale for the focus-mode state — the focal node id
    // belongs to the graph that's being replaced. Clearing here also
    // removes any .gv-out-of-focus class from the (still-mounted) old
    // core, though useGraphCytoscape's teardown will obliterate it
    // moments later.
    focusMode.clear()
    if (
      layoutRef.current === DEFAULT_LAYOUT &&
      elementsRef.current.length > COSE_NODE_LIMIT
    ) {
      setLayout('grid')
    }
    // resetPath/setLayout are stable in practice; sig is the real trigger.
  }, [sig])

  // All cytoscape lifecycle effects — debounced rebuild keyed on sig,
  // theme / layout / selection-mode / visibility / hidden-set / emphasis
  // side-effects, and the ResizeObserver re-fit. See useGraphCytoscape
  // for the per-effect rationale.
  useGraphCytoscape({
    sig,
    containerRef: ref,
    cyRef,
    elementsRef,
    layoutRef,
    nodePrefsRef,
    edgePrefsRef,
    selectionModeRef,
    pathTapRef,
    theme,
    nodeLabelPrefs,
    edgeLabelPrefs,
    layout,
    selectionMode,
    hiddenLabels,
    hidden,
    selected,
    setSelected,
    setError,
    setCounts,
    reapplyPins: pinning.reapplyAll,
    reapplyFocus: focusMode.reapply,
    t,
  })

  // Right-click / long-press context menu on a node. Passing `sig`
  // forces the hook's subscription effect to re-bind whenever the
  // orchestrator rebuilds the cy core (cyRef.current changes underneath
  // the stable ref identity), so the menu always tracks the live core.
  const menu = useNodeContextMenu({ cyRef, enabled: true, sig })

  // Currently-open expand popover target node id (null = closed). The
  // menu's 'expand' action sets this; the popover's onRun reads it +
  // forwards the user's direction / labelFilter / limit choice through
  // to onExploreNeighbours. Result-scoped to the live core: a sig-keyed
  // rebuild doesn't reopen the popover, and the `key={expandFor}` on
  // the rendered popover resets its internal useState between targets.
  const [expandFor, setExpandFor] = useState<string | null>(null)

  // GAP-03: keyboard pickers — resolve typed/picked id back to data.
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
  const onToggleSelectionMode = (): void => {
    setSelectionMode(selectionMode === 'box' ? 'pan' : 'box')
  }
  const onToggleClusterByLabel = (): void => {
    const next = !clusterByLabel
    setClusterByLabel(next)
    // Clustering ON auto-picks fcose (best for compound graphs); off
    // doesn't force a layout change, so a manual pick is respected.
    if (next) setLayout('fcose')
  }
  const onZoomIn = (): void => {
    const cy = cyRef.current
    if (!cy) return
    cy.zoom({
      level: cy.zoom() * 1.25,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    })
  }
  const onZoomOut = (): void => {
    const cy = cyRef.current
    if (!cy) return
    cy.zoom({
      level: cy.zoom() / 1.25,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
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

  // 1-hop neighbours of the currently-selected node, read straight off
  // the live cy core via `cyRef.current.$id(id).neighborhood('node')`.
  // Returns [] when the selection is an edge, when the node is gone, or
  // when there is no selection. `cyRef.current` isn't a reactive value
  // so it's intentionally not a dep — when the cy core is rebuilt the
  // sig-keyed reset effect clears `selected`, which retriggers this
  // memo against the fresh core.
  const neighbors: Neighbor[] = useMemo(() => {
    const cy = cyRef.current
    if (!cy || !selected || selected.kind !== 'node') return []
    const id = String(selected.data.id ?? '')
    if (!id) return []
    const node = cy.$id(id)
    if (node.empty()) return []
    const out: Neighbor[] = []
    node.neighborhood('node').forEach((n) => {
      const nid = String(n.data('id') ?? '')
      if (!nid) return
      const label = resolveNodeLabel(
        n.data() as Record<string, unknown>,
        nodeLabelPrefs
      )
      out.push({ id: nid, label })
    })
    return out
  }, [selected, nodeLabelPrefs])

  // Inspector chip click → jump selection to that neighbour id. Reads
  // the node's data bag from the same nodeDataById map the keyboard
  // picker uses; falls back to the live cy core's emphasis call to
  // visually mark the new selection.
  const onJumpNeighbor = (id: string): void => {
    const data = nodeDataById.get(id)
    if (!data) return
    setSelected({ kind: 'node', data })
    cyRef.current?.$id(id).select()
  }

  // Resolve a node id to a short display label for the restore lists.
  const nodeDisplayLabel = (id: string): string => {
    const data = nodeDataById.get(id)
    if (!data) return id
    return resolveNodeLabel(data, nodeLabelPrefs)
  }
  const hiddenIds = Array.from(hidden)
  const collapsedEntries = Array.from(collapsed.entries())

  // Route a NodeContextMenu action to the right orchestrator handler.
  // Closes the menu first so the dismissal isn't blocked by a slow
  // network call (e.g. Explore). Stubbed cases ('focus' and 'pin') are
  // wired in Tasks 13 (pin) and 16 (focus).
  const onMenuSelect = (action: NodeContextMenuAction): void => {
    const id = menu.state.nodeId
    menu.close()
    if (!id) return
    switch (action) {
      case 'expand':
        // Open the configurable popover. The user's chosen
        // direction / labelFilter / limit is forwarded to
        // onExploreNeighbours via onExpandRun below.
        setExpandFor(id)
        break
      case 'hide':
        onHideNode(id)
        break
      case 'collapse':
        onCollapseNode(id)
        break
      case 'copyId':
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(id).catch(() => {})
        }
        break
      case 'pin':
        pinning.togglePin(id)
        break
      case 'focus':
        focusMode.focus({ id, hops: focusHops })
        break
      default: {
        // Exhaustiveness check — adding a new action without a case
        // here will fail to compile.
        const exhaustive: never = action
        return exhaustive
      }
    }
  }

  // The popover's Run callback closes the popover and dispatches the
  // explore with the chosen options. The `target` snapshot guards
  // against the open id changing between the click and the dispatch.
  const onExpandRun = (opts: ExpandRunOpts): void => {
    if (!expandFor) return
    const target = expandFor
    setExpandFor(null)
    onExploreNeighbours(target, opts)
  }
  // Label-filter dropdown options come from the live graph's node-label
  // buckets — the set of labels actually present in the current canvas
  // (so the user can only restrict to a label they can see).
  const labelOptionList = Array.from(nodeLabelBuckets.keys()).filter(Boolean)

  // Keyboard navigation on the canvas: Tab / Shift+Tab (and ArrowRight /
  // ArrowLeft aliases) walk the currently-selected node's neighbour
  // list; Enter opens the expand popover for the selection. Mounted on
  // the Canvas via tabIndex={0} + onKeyDown below.
  const { handleKey } = useGraphKeyboardNav({
    selectedId:
      selected && selected.data.id != null ? String(selected.data.id) : null,
    neighborIds: neighbors.map((n) => n.id),
    onJump: onJumpNeighbor,
    onExpand: (id) => setExpandFor(id),
  })

  const empty = elements.length === 0 && !error
  // Reuse the same hash + palette the canvas uses so swatches are
  // exact-pixel matches to the node fills.
  const swatchFor = (label: string): string =>
    labelToColor(label, theme.variant)

  return (
    <Wrap $fill={fillHeight} $sidebarCollapsed={sidebarCollapsed}>
      <CanvasArea>
        <GraphToolbar
          t={t}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
          layout={layout}
          onChangeLayout={setLayout}
          layouts={LAYOUTS}
          layoutLabel={layoutLabel}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onFit={onFit}
          onResetView={onResetView}
          selectionMode={selectionMode}
          onToggleSelectionMode={onToggleSelectionMode}
          clusterByLabel={clusterByLabel}
          onToggleClusterByLabel={onToggleClusterByLabel}
          degreeSizing={degreeSizing}
          onToggleDegreeSizing={() => setDegreeSizing(!degreeSizing)}
          pathActive={pathState.phase !== 'off'}
          onTogglePathMode={onTogglePathMode}
          onPathClear={exitPathMode}
          miniMap={miniMap}
          onToggleMiniMap={() => setMiniMap(!miniMap)}
          counts={counts}
        />
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
            tabIndex={0}
            onKeyDown={handleKey}
            data-testid="graph-canvas"
            data-focus-active={focusMode.state !== null ? 'true' : 'false'}
          />
          {empty && (
            <Overlay data-testid="graph-empty-state">
              {t('graph.empty')}
            </Overlay>
          )}
          {error && <ErrorBanner role="alert">{error}</ErrorBanner>}
          {miniMap && <GraphMiniMap cyRef={cyRef} sig={sig} />}
        </div>
      </CanvasArea>
      {!sidebarCollapsed && (
        <GraphSidebar height={effectiveHeight} fill={fillHeight}>
          <GraphSidebarContents
            t={t}
            nodeLabelBuckets={nodeLabelBuckets}
            hiddenLabels={hiddenLabels}
            toggleHiddenLabel={toggleHiddenLabel}
            swatchFor={swatchFor}
            nodeIds={nodeIds}
            edgeIds={edgeIds}
            onPickNodeId={onPickNodeId}
            onPickEdgeId={onPickEdgeId}
            nodeOptions={nodeOptions}
            edgeOptions={edgeOptions}
            nodeLabelPrefs={nodeLabelPrefs}
            edgeLabelPrefs={edgeLabelPrefs}
            setNodeLabelPref={setNodeLabelPref}
            setEdgeLabelPref={setEdgeLabelPref}
            hiddenIds={hiddenIds}
            collapsedEntries={collapsedEntries}
            onRestoreHidden={onRestoreHidden}
            onExpandCollapsed={onExpandCollapsed}
            nodeDisplayLabel={nodeDisplayLabel}
            selected={selected}
            inspectorView={inspectorView}
            setInspectorView={setInspectorView}
            onHideNode={onHideNode}
            onCollapseNode={onCollapseNode}
            onExploreNeighbours={onExploreNeighbours}
            exploringId={exploringId}
            collapsed={collapsed}
            neighbors={neighbors}
            onJumpNeighbor={onJumpNeighbor}
            onPin={(id) => pinning.togglePin(id)}
            isPinned={
              selected?.kind === 'node' &&
              pinning.isPinned(String(selected.data.id ?? ''))
            }
            onFocus={(id, hops) => focusMode.focus({ id, hops })}
            onClearFocus={() => focusMode.clear()}
            focusActive={focusMode.state !== null}
            focusHops={focusHops}
            setFocusHops={setFocusHops}
          />
        </GraphSidebar>
      )}
      <NodeContextMenu
        open={menu.state.open}
        x={menu.state.x}
        y={menu.state.y}
        items={['expand', 'hide', 'collapse', 'focus', 'pin', 'copyId']}
        onSelect={onMenuSelect}
        onClose={menu.close}
        t={t}
      />
      {/* `key={expandFor}` forces React to unmount/remount the popover
          whenever the open target changes (close→open, open→close, or
          one open node→another), which resets the popover's internal
          useState defaults — preventing stale direction/limit values
          from leaking between consecutive expands. */}
      <ExpandQueryPopover
        key={expandFor ?? '__closed__'}
        open={expandFor !== null}
        nodeId={expandFor ?? ''}
        labelOptions={labelOptionList}
        onRun={onExpandRun}
        onCancel={() => setExpandFor(null)}
        t={t}
      />
    </Wrap>
  )
}
