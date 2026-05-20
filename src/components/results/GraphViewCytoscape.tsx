import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cytoscape, { Core } from 'cytoscape'
import fcose from 'cytoscape-fcose'
import dagre from 'cytoscape-dagre'
import spread from 'cytoscape-spread'
import { useTheme } from 'styled-components'
import { labelToColor } from './cytoscapeStyle'
import { QueryRespLike } from '../../lib/graphResult'
import { useGraphPathMode } from './graph/useGraphPathMode'
import { GraphToolbar } from './graph/GraphToolbar'
import { GraphFilterChips } from './graph/GraphFilterChips'
import { GraphCanvasOverlay } from './graph/GraphCanvasOverlay'
import { GraphSidebar } from './graph/GraphSidebar'
import { GraphSidebarContents } from './graph/GraphSidebarContents'
import { useGraphElements } from './graph/useGraphElements'
import { useGraphActions } from './graph/useGraphActions'
import { useGraphCytoscape } from './graph/useGraphCytoscape'
import { usePinnedNodes } from './graph/usePinnedNodes'
import { useFocusMode } from './graph/useFocusMode'
import { useGraphBadges } from './graph/useGraphBadges'
import { LAYOUTS, layoutLabel } from './graph/layouts'
import { respSignature } from './graph/cyHelpers'
import type { Selected } from './graph/GraphInspector'
import { useCxtMenu } from './graph/useCxtMenu'
import { useLasso } from './graph/useLasso'
import { useDomNodes } from './graph/useDomNodes'
import { useNodeTooltip } from './graph/useNodeTooltip'
import { useEdgeTooltip } from './graph/useEdgeTooltip'
import { ExpandQueryPopover, ExpandRunOpts } from './graph/ExpandQueryPopover'
import { useGraphKeyboardNav } from './graph/useGraphKeyboardNav'
// QUALITY #164: extracted from this orchestrator so the file focuses on
// state assembly + JSX wiring instead of inline action / lifecycle code.
import { useGraphDomNodeRoots } from './graph/useGraphDomNodeRoots'
import { useGraphLatestRefs } from './graph/useGraphLatestRefs'
import { useGraphNodeActions } from './graph/useGraphNodeActions'
import { useGraphPreferences } from './graph/useGraphPreferences'
import { useGraphSelectionActions } from './graph/useGraphSelectionActions'
import { useGraphSigReset } from './graph/useGraphSigReset'
import { useGraphToolbarActions } from './graph/useGraphToolbarActions'
import { useZoomLevel } from './graph/useZoomLevel'
import { CanvasArea, PathStatus, Wrap } from './graph/styled'

// Register the layout extensions once, at module load. cytoscape.use is
// idempotent in cytoscape@3 — a double-register (e.g. a test re-import)
// is a no-op. fcose is a faster force layout that also handles compound
// (clustered) graphs; dagre is a layered DAG layout for directed /
// hierarchical shapes. Both are surfaced in the layout picker (Task 1.2)
// and fcose is the auto-pick when group-by-label clustering is on
// (Task 1.4). spread is an anti-overlap pass surfaced as a regular
// layout option (Task 13); ships no TypeScript types (see
// src/types/cytoscape-spread.d.ts) so it's cast through unknown.
cytoscape.use(fcose)
cytoscape.use(dagre)
cytoscape.use(spread as unknown as cytoscape.Ext)

// Props.resp is a QueryRespLike from the row stream, which under streaming
// is a freshly minted object every row. Building a Cytoscape Core +
// running cose layout per row is catastrophic (O(N) teardown / re-layouts
// for an N-row stream). The component intentionally debounces the
// (re)build so streaming converges to a single mount once the row count
// settles. See PERF-F9 / issue #53.
export type GraphViewCytoscapeProps = {
  resp: QueryRespLike & { row_count?: number }
  // Original query text. Used to recover variable bindings and
  // synthesise nodes/edges when the response is scalar-only (no
  // NODE/EDGE columns ⇒ empty graph_summary).
  query?: string
}

export const GraphViewCytoscape: React.FC<GraphViewCytoscapeProps> = ({
  resp,
  query,
}) => {
  const { t } = useTranslation()
  const theme = useTheme()
  const ref = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [selected, setSelected] = useState<Selected | null>(null)
  // Sidebar collapsed/visible toggle. Session-local; not persisted.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // GAP-04: extractElements / cytoscape() build-pass errors surface here.
  const [error, setError] = useState<string | null>(null)
  // QUAL #164: useGraphPreferences hoists every sticky pref + its
  // tier-derived flags so the orchestrator only destructures.
  const {
    layout,
    setLayout,
    nodeLabelPrefs,
    setNodeLabelPref,
    edgeLabelPrefs,
    setEdgeLabelPref,
    hiddenLabels,
    toggleHiddenLabel,
    setHiddenLabels,
    inspectorView,
    setInspectorView,
    selectionMode,
    setSelectionMode,
    clusterByLabel,
    setClusterByLabel,
    degreeSizing,
    setDegreeSizing,
    miniMap,
    setMiniMap,
    lasso,
    setLasso,
    domNodes,
    setDomNodes,
    cxtMenuEnabled,
    tooltipsEnabled,
    badgesEnabled,
    renderer,
    onToggleRenderer,
    sectionsOpen,
    toggleSection,
    focusHops,
    setFocusHops,
    wheelSensitivity,
    setWheelSensitivity,
  } = useGraphPreferences()
  // Result-scoped path-mode state machine; reset on sig change.
  const {
    pathState,
    pathTapRef,
    onTogglePathMode,
    exitPathMode,
    resetPath,
    pathStatusText,
  } = useGraphPathMode({ cyRef, t })
  // Live counts surfaced in the toolbar (post-build, post-filter).
  const [counts, setCounts] = useState<{ nodes: number; edges: number }>({
    nodes: 0,
    edges: 0,
  })

  // Element-set + derived indices (memoized on resp/query/cluster).
  const { elements, nodeOptions, edgeOptions, nodeDataById, nodeLabelBuckets } =
    useGraphElements({ resp, query, clusterByLabel, degreeSizing })

  // QUAL #164: useGraphLatestRefs centralises the always-latest ref
  // updates the debounced build callback reads on fire (one each for
  // query, elements, node/edge prefs, layout, selection-mode).
  const {
    queryRef,
    elementsRef,
    nodePrefsRef,
    edgePrefsRef,
    layoutRef,
    selectionModeRef,
  } = useGraphLatestRefs({
    query,
    elements,
    nodeLabelPrefs,
    edgeLabelPrefs,
    layout,
    selectionMode,
  })

  // Result-scoped hide/collapse + "Explore neighbours" flow.
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

  // Result-scoped pin + focus-mode bookkeeping.
  const pinning = usePinnedNodes({ cyRef })
  const focusMode = useFocusMode({ cyRef })

  // GAP-01 / GAP-07: rebuild key combines row_count + query +
  // cluster/degree toggles; otherwise same-row-count queries would
  // leave a stale graph on the canvas.
  const sig = `${respSignature(resp)}|${query ?? ''}|${clusterByLabel ? 'c' : ''}|${degreeSizing ? 'd' : ''}`

  // DOM-positioned badge overlay; subscribes to viewport events.
  const badges = useGraphBadges({
    cyRef,
    pinned: pinning.pinned,
    collapsed,
    sig,
  })

  // Sig-keyed reset effect: a new query result / cluster toggle /
  // degree-sizing toggle resets every piece of result-scoped state
  // (path mode, hidden/collapsed bookkeeping, pinned ids, focus
  // focal node, selection) and auto-picks the `grid` layout for
  // responses larger than COSE_NODE_LIMIT so cose doesn't freeze
  // the tab. Hoisted into useGraphSigReset (QUAL #164).
  useGraphSigReset({
    sig,
    layoutRef,
    elementsRef,
    resetPath,
    setHidden,
    setCollapsed,
    setExploringId,
    pinningClear: pinning.clear,
    focusClear: focusMode.clear,
    setSelected,
    setLayout,
  })

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
    wheelSensitivity,
  })

  // Open expand-popover target node id (null = closed).
  const [expandFor, setExpandFor] = useState<string | null>(null)

  const {
    onToggleSelectionMode,
    onToggleClusterByLabel,
    onZoomIn,
    onZoomOut,
    onFit,
    onResetView,
  } = useGraphToolbarActions({
    cyRef,
    selectionMode,
    setSelectionMode,
    clusterByLabel,
    setClusterByLabel,
    layout,
    setLayout,
    setSelected,
    setHiddenLabels,
  })

  const { level: zoomLevel, setZoomLevel } = useZoomLevel(cyRef, sig)

  // QUAL #164: every selection-driven derived value (1-hop neighbours
  // memo, find-node list memo) and click-jump callback (onJumpNeighbor,
  // onFindPick, nodeDisplayLabel) is hoisted into
  // useGraphSelectionActions. The cyRef-driven semantics are
  // unchanged; the hook closes over the same cyRef + setSelected so
  // selection-driven rerenders flow identically.
  const { neighbors, findNodes, onJumpNeighbor, onFindPick, nodeDisplayLabel } =
    useGraphSelectionActions({
      cyRef,
      selected,
      setSelected,
      nodeLabelPrefs,
      nodeDataById,
    })
  const hiddenIds = Array.from(hidden)
  const collapsedEntries = Array.from(collapsed.entries())

  // useGraphNodeActions: the seven node-action handlers fed to
  // useCxtMenu (names mirror CxtMenuHandlers's fields).
  const nodeActions = useGraphNodeActions({
    cyRef,
    setExpandFor,
    onHideNode,
    onCollapseNode,
    focusMode,
    focusHops,
    pinning,
  })

  // Right-click / long-press radial context menu (cxtmenu bootstrap).
  // sig forces the subscription effect to re-bind on every cy rebuild.
  useCxtMenu({
    cyRef,
    handlers: nodeActions,
    t,
    sig,
    theme,
    enabled: cxtMenuEnabled,
  })

  // Hover tooltip exposes the hovered node's id/label/props.
  const { targetData: nodeTooltipTarget } = useNodeTooltip({ cyRef, sig })
  // GAP-059: edge counterpart — bound to 'edge' selector so the user
  // gets the same hover preview on relationships as on nodes. The two
  // hooks select disjoint element classes so they never race; the
  // tooltipTarget shown to GraphCanvasOverlay is whichever one fires
  // most recently. We prefer the edge target when both are non-null
  // (an edge tooltip overlaying a node tooltip during a fast hover
  // sweep should land on the more specific element).
  const { targetData: edgeTooltipTarget } = useEdgeTooltip({ cyRef, sig })
  const tooltipTarget = edgeTooltipTarget ?? nodeTooltipTarget

  // Wire cytoscape-lasso's enable-state to the sticky `lasso` pref.
  // `sig` is forwarded so a fresh cy core (post-rebuild) inherits the
  // current toggle. Restore the user's prior selectionMode when lasso
  // turns off so they don't get stranded in box-selection mode (Bug 6).
  useLasso({
    cyRef,
    enabled: lasso,
    restorePanningWhenDisabled: selectionMode === 'pan',
    restoreBoxSelectionWhenDisabled: selectionMode === 'box',
    sig,
  })

  // Build a single HTML element + React root per node when DOM-node
  // rendering is enabled. The per-id root pool + sig-keyed cleanup
  // lives in useGraphDomNodeRoots (QUALITY #164). We never write
  // innerHTML — each container gets its own createRoot() so the
  // rendered CustomNodeTemplate is XSS-safe and future interactive
  // children (event handlers, controlled inputs) keep working.
  const { renderNode } = useGraphDomNodeRoots({ theme, pinning, sig })

  useDomNodes({ cyRef, enabled: domNodes, renderNode, sig })

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
    <Wrap $sidebarCollapsed={sidebarCollapsed}>
      <CanvasArea>
        <GraphToolbar
          t={t}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
          layout={layout}
          onChangeLayout={setLayout}
          layouts={LAYOUTS}
          layoutLabel={layoutLabel}
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
          lasso={lasso}
          onToggleLasso={() => setLasso(!lasso)}
          domNodes={domNodes}
          onToggleDomNodes={() => setDomNodes(!domNodes)}
          findNodes={findNodes}
          onFindPick={onFindPick}
          counts={counts}
          renderer={renderer}
          onToggleRenderer={onToggleRenderer}
        />
        <GraphFilterChips
          t={t}
          hiddenLabels={hiddenLabels}
          onClearHidden={(label) => toggleHiddenLabel(label)}
          clusterByLabel={clusterByLabel}
          onClearCluster={() => setClusterByLabel(false)}
          focusActive={focusMode.state !== null}
          focusId={focusMode.state?.id ?? null}
          focusHops={focusMode.state?.hops ?? focusHops}
          onClearFocus={() => focusMode.clear()}
          pathActive={pathState.phase !== 'off'}
          onClearPath={exitPathMode}
        />
        {pathStatusText && (
          <PathStatus data-testid="graph-path-status" role="status">
            {pathStatusText}
          </PathStatus>
        )}
        <GraphCanvasOverlay
          canvasRef={ref}
          cyRef={cyRef}
          sig={sig}
          t={t}
          empty={empty}
          error={error}
          miniMap={miniMap}
          badgesEnabled={badgesEnabled}
          badges={badges}
          tooltipsEnabled={tooltipsEnabled}
          tooltipTarget={tooltipTarget}
          focusActive={focusMode.state !== null}
          onClearFocus={() => focusMode.clear()}
          onKeyDown={handleKey}
          zoomLevel={zoomLevel}
          onZoomLevelChange={setZoomLevel}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onFit={onFit}
          onResetView={onResetView}
        />
      </CanvasArea>
      {!sidebarCollapsed && (
        <GraphSidebar
          onCollapse={() => setSidebarCollapsed(true)}
          collapseLabel={t('graph.toggleSidebarHide')}
        >
          <GraphSidebarContents
            t={t}
            nodeLabelBuckets={nodeLabelBuckets}
            hiddenLabels={hiddenLabels}
            toggleHiddenLabel={toggleHiddenLabel}
            swatchFor={swatchFor}
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
            sectionsOpen={sectionsOpen}
            onToggleSection={toggleSection}
            wheelSensitivity={wheelSensitivity}
            setWheelSensitivity={setWheelSensitivity}
          />
        </GraphSidebar>
      )}
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
