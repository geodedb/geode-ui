import React from 'react'
import {
  EDGE_TYPE_DEFAULT,
  NODE_LABEL_DEFAULT,
  labelOptions as labelOptionsFn,
  typeOptions as typeOptionsFn,
} from '../../../lib/graphResult'
import { ControlsBlock, RestoreList } from './styled'
import { GraphInspector, Neighbor, Selected } from './GraphInspector'
import type { InspectorView } from '../useGraphPrefs'
import { isRealNodeId } from './explore'

// P-NEW-2 / Q-NEW-3: cap the datalist option count rendered by the
// keyboard pickers. A 5k-node graph would otherwise materialise 5k
// <option> elements unconditionally. Datalists are type-ahead
// suggestions; 1000 entries is more than any human will scroll. The
// underlying lookup Maps are NOT capped, so resolving a typed-in id
// always works.
const ID_PICKER_OPTION_CAP = 1000

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
  // Keyboard id pickers.
  nodeIds: string[]
  edgeIds: string[]
  onPickNodeId: (rawId: string) => void
  onPickEdgeId: (rawId: string) => void
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
}

// GraphSidebarContents renders the inner blocks of the graph sidebar:
// visibility toggles, keyboard pickers, display-field selectors, the
// hidden / collapsed restore lists, and the selected-element inspector.
// All state lives in the orchestrator; this component is presentational
// and accepts the data + handlers it needs as props. Kept separate so
// the orchestrator's render block stays small enough to be readable.
export const GraphSidebarContents: React.FC<GraphSidebarContentsProps> = ({
  t,
  nodeLabelBuckets,
  hiddenLabels,
  toggleHiddenLabel,
  swatchFor,
  nodeIds,
  edgeIds,
  onPickNodeId,
  onPickEdgeId,
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
}) => {
  return (
    <>
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
                  <button type="button" onClick={() => onExpandCollapsed(id)}>
                    {t('graph.expand')}
                  </button>
                </li>
              )
            })}
          </RestoreList>
        )}
      </ControlsBlock>
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
          t={t}
        />
      ) : (
        <p style={{ opacity: 0.6 }}>{t('graph.inspectHint')}</p>
      )}
    </>
  )
}
