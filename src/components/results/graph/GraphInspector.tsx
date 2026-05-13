import React from 'react'
import styled from 'styled-components'
import { formatPropValue } from '../propFormat'
import type { InspectorView } from '../useGraphPrefs'

// Identity of the currently-selected canvas element. `data` is the
// Cytoscape data bag (an opaque record bag with `id`, optional `labels`,
// optional `source`/`target` for edges, and arbitrary `props`).
export type Selected = {
  kind: 'node' | 'edge'
  data: Record<string, unknown>
}

// A 1-hop neighbour of the currently-selected node — id plus the
// display label resolved through useGraphPrefs.nodeLabelPrefs. Used to
// render the chip list under the inspector actions and to jump
// selection on click.
export type Neighbor = { id: string; label: string }

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
// 1-hop neighbours of the selected node rendered as a horizontal chip
// row directly under the inspector actions. Each chip is a button that
// jumps the selection to that neighbour. The leading `.hd` span is the
// count heading ("3 neighbours") and wraps as its own row.
const NeighborsList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.xxs};
  margin-bottom: ${({ theme }) => theme.spacing.xs};

  .hd {
    width: 100%;
    font-size: ${({ theme }) => theme.font.sizes.xs};
    color: ${({ theme }) => theme.text.secondary};
  }
  button {
    font: inherit;
    font-size: ${({ theme }) => theme.font.sizes.xs};
    background: ${({ theme }) => theme.bg.canvas};
    border: 1px solid ${({ theme }) => theme.border.default};
    border-radius: ${({ theme }) => theme.radii.pill};
    padding: 2px 8px;
    cursor: pointer;
    color: ${({ theme }) => theme.text.primary};
  }
  button:hover {
    background: ${({ theme }) => theme.bg.subtle};
  }
  code {
    font-family: ${({ theme }) => theme.font.family.mono};
    opacity: 0.7;
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

export type GraphInspectorProps = {
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
  // Adjacent (1-hop) neighbors of the selected node, with display
  // labels. Empty when the selection is an edge or has no adjacency.
  neighbors: Neighbor[]
  // Jump selection to this neighbor id (and emphasize it).
  onJumpNeighbor: (id: string) => void
  // Pin/unpin handler for the currently-selected node. The button is
  // rendered only for nodes (not edges).
  onPin: (id: string) => void
  // Whether the currently-selected node is pinned.
  isPinned: boolean
  t: (key: string, opts?: Record<string, unknown>) => string
}

// GraphInspector renders the selected-element panel: an identity header,
// a small segmented control to flip between the structured property view
// (default) and the raw data-bag JSON, and the chosen pane. The `props`
// pane is an insertion-order <dl> of `selected.data.props` (matching
// TableView's projectColumns ordering) formatted through the shared
// formatPropValue; the `json` pane is the historical
// `<pre>{JSON.stringify(...)}</pre>` output, kept as an option.
export const GraphInspector: React.FC<GraphInspectorProps> = ({
  selected,
  view,
  onSetView,
  onHide,
  onCollapse,
  onExplore,
  exploreLoading,
  exploreDisabled,
  collapsedCount,
  neighbors,
  onJumpNeighbor,
  onPin,
  isPinned,
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
            <button
              type="button"
              data-testid="graph-action-pin"
              aria-pressed={isPinned}
              onClick={() => onPin(id)}
            >
              {isPinned ? t('graph.menuUnpin') : t('graph.menuPin')}
            </button>
          </InspectorActions>
          {collapsedCount > 0 && (
            <InspectorNote data-testid="graph-collapsed-count">
              {t('graph.collapsedCount', { count: collapsedCount })}
            </InspectorNote>
          )}
          {neighbors.length > 0 && (
            <NeighborsList data-testid="graph-neighbors">
              <span className="hd">
                {t('graph.neighborsHeading', { count: neighbors.length })}
              </span>
              {neighbors.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  data-testid={`graph-neighbor-chip-${n.id}`}
                  onClick={() => onJumpNeighbor(n.id)}
                >
                  {n.label} <code>#{n.id}</code>
                </button>
              ))}
            </NeighborsList>
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
