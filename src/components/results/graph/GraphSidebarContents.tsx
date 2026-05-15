import React from 'react'
import {
  EDGE_TYPE_DEFAULT,
  NODE_LABEL_DEFAULT,
  labelOptions as labelOptionsFn,
  typeOptions as typeOptionsFn,
} from '../../../lib/graphResult'
import { ControlsBlock, RestoreList } from './styled'
import { GraphInspector, Neighbor, Selected } from './GraphInspector'
import type { GraphSectionId, InspectorView } from '../useGraphPrefs'
import { isRealNodeId } from './explore'
import { CollapsibleSection } from '../CollapsibleSection'

// Sized to the matching types from lib/graphResult so callers don't
// re-type the maps.
type NodeOptions = ReturnType<typeof labelOptionsFn>
type EdgeOptions = ReturnType<typeof typeOptionsFn>

type TFn = (key: string, opts?: Record<string, unknown>) => string

export type GraphSidebarContentsProps = {
  t: TFn
  // Visibility row.
  nodeLabelBuckets: Map<string, number>
  hiddenLabels: Set<string>
  toggleHiddenLabel: (label: string) => void
  swatchFor: (label: string) => string
  // Display pref editors.
  nodeOptions: NodeOptions
  edgeOptions: EdgeOptions
  nodeLabelPrefs: Record<string, string>
  edgeLabelPrefs: Record<string, string>
  setNodeLabelPref: (label: string, key: string) => void
  setEdgeLabelPref: (type: string, key: string) => void
  // Hidden / collapsed restore lists.
  hiddenIds: string[]
  collapsedEntries: Array<[string, string[]]>
  onRestoreHidden: (id: string) => void
  onExpandCollapsed: (id: string) => void
  nodeDisplayLabel: (id: string) => string
  // Inspector.
  selected: Selected | null
  inspectorView: InspectorView
  setInspectorView: (v: InspectorView) => void
  onHideNode: (id: string) => void
  onCollapseNode: (id: string) => void
  onExploreNeighbours: (id: string) => void
  exploringId: string | null
  collapsed: Map<string, string[]>
  // 1-hop neighbours of the currently-selected node, with display
  // labels. Forwarded straight to GraphInspector.
  neighbors: Neighbor[]
  // Jump selection to this neighbor id.
  onJumpNeighbor: (id: string) => void
  // Pin/unpin handler for the currently-selected node. Forwarded to
  // GraphInspector; only meaningful when `selected.kind === 'node'`.
  onPin: (id: string) => void
  // Whether the currently-selected node is pinned. False for edges /
  // when nothing is selected.
  isPinned: boolean
  // Focus mode: forwarded straight to GraphInspector. `focusActive`
  // derives from `useFocusMode.state !== null` in the orchestrator.
  onFocus: (id: string, hops: number) => void
  onClearFocus: () => void
  focusActive: boolean
  focusHops: number
  setFocusHops: (n: number) => void
  // Collapsible section state — lifted to the orchestrator and persisted
  // via useGraphPrefs.sectionsOpen.
  sectionsOpen: Record<GraphSectionId, boolean>
  onToggleSection: (id: GraphSectionId) => void
}

// GraphSidebarContents renders the inner blocks of the graph sidebar:
// visibility toggles, display-field selectors, the hidden / collapsed
// restore lists (only when non-empty), and the selected-element
// inspector. All state lives in the orchestrator; this component is
// presentational and accepts the data + handlers it needs as props.
// Kept separate so the orchestrator's render block stays small enough
// to be readable.
//
// Each block is wrapped in a <CollapsibleSection> whose open/closed
// state is threaded from useGraphPrefs.sectionsOpen (sticky). The
// Hidden and Collapsed sections are only rendered when their respective
// lists are non-empty — no empty-state clutter.
export const GraphSidebarContents: React.FC<GraphSidebarContentsProps> = ({
  t,
  nodeLabelBuckets,
  hiddenLabels,
  toggleHiddenLabel,
  swatchFor,
  nodeOptions,
  edgeOptions,
  nodeLabelPrefs,
  edgeLabelPrefs,
  setNodeLabelPref,
  setEdgeLabelPref,
  hiddenIds,
  collapsedEntries,
  onRestoreHidden,
  onExpandCollapsed,
  nodeDisplayLabel,
  selected,
  inspectorView,
  setInspectorView,
  onHideNode,
  onCollapseNode,
  onExploreNeighbours,
  exploringId,
  collapsed,
  neighbors,
  onJumpNeighbor,
  onPin,
  isPinned,
  onFocus,
  onClearFocus,
  focusActive,
  focusHops,
  setFocusHops,
  sectionsOpen,
  onToggleSection,
}) => {
  return (
    <>
      {nodeLabelBuckets.size > 1 && (
        <CollapsibleSection
          title={t('graph.sectionVisibility')}
          open={sectionsOpen.visibility}
          onToggle={() => onToggleSection('visibility')}
          testId="graph-section-visibility"
        >
          <ControlsBlock data-testid="graph-visibility-controls">
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
                      onChange={() => toggleHiddenLabel(label)}
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
        </CollapsibleSection>
      )}
      <CollapsibleSection
        title={t('graph.sectionDisplay')}
        open={sectionsOpen.display}
        onToggle={() => onToggleSection('display')}
        testId="graph-section-display"
      >
        <ControlsBlock data-testid="graph-display-controls">
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
                  onChange={(e) => setNodeLabelPref(label, e.target.value)}
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
                  onChange={(e) => setEdgeLabelPref(type, e.target.value)}
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
      </CollapsibleSection>
      {hiddenIds.length > 0 && (
        <CollapsibleSection
          title={t('graph.hiddenHeading', { count: hiddenIds.length })}
          open={sectionsOpen.hidden}
          onToggle={() => onToggleSection('hidden')}
          testId="graph-section-hidden"
        >
          <RestoreList data-testid="graph-hidden-list">
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
        </CollapsibleSection>
      )}
      {collapsedEntries.length > 0 && (
        <CollapsibleSection
          title={t('graph.collapsedHeading', {
            count: collapsedEntries.length,
          })}
          open={sectionsOpen.collapsed}
          onToggle={() => onToggleSection('collapsed')}
          testId="graph-section-collapsed"
        >
          <RestoreList data-testid="graph-collapsed-list">
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
                  <button type="button" onClick={() => onExpandCollapsed(id)}>
                    {t('graph.expand')}
                  </button>
                </li>
              )
            })}
          </RestoreList>
        </CollapsibleSection>
      )}
      <CollapsibleSection
        title={t('graph.sectionInspector')}
        open={sectionsOpen.inspector}
        onToggle={() => onToggleSection('inspector')}
        testId="graph-section-inspector"
      >
        {selected ? (
          <GraphInspector
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
            neighbors={neighbors}
            onJumpNeighbor={onJumpNeighbor}
            onPin={onPin}
            isPinned={isPinned}
            onFocus={onFocus}
            onClearFocus={onClearFocus}
            focusActive={focusActive}
            focusHops={focusHops}
            setFocusHops={setFocusHops}
            t={t}
          />
        ) : (
          <p style={{ opacity: 0.6 }}>{t('graph.inspectHint')}</p>
        )}
      </CollapsibleSection>
    </>
  )
}
