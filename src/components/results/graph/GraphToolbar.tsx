import React from 'react'
import styled from 'styled-components'
import type { LayoutName } from '../useGraphPrefs'
import { FindNodeInput } from './FindNodeInput'
import { GraphToolbarMore } from './GraphToolbarMore'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import { breakpoints } from '../../../theme/tokens'
import { BootstrapDropdown } from '../../../services/bootstrap/Dropdown'
import { Icon } from '../../ui'

// Mobile-only first-class affordances render below the `md` breakpoint.
// Match the @media rule baked into the styled Toolbar above so the JS
// branch and CSS branch agree on the cutover.
const MOBILE_MEDIA_QUERY = `(max-width: ${breakpoints.md - 0.02}px)`

const Toolbar = styled.div`
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.secondary};
  scrollbar-gutter: stable;

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

  .stats {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    color: ${({ theme }) => theme.text.muted};
    white-space: nowrap;
  }

  /* At mobile widths the single-row layout pushes the Filters /
     Analysis / More clusters off-screen behind an overflow-x scroll
     that most touch users don't discover. Let the toolbar wrap so
     every group is visible without horizontal scroll; the stats span
     becomes a second-row right-aligned element via margin-left: auto. */
  @media (max-width: ${({ theme }) => theme.breakpoints.md - 0.02}px) {
    flex-wrap: wrap;
    overflow-x: visible;
    scrollbar-gutter: auto;
  }
`

// Group is a labelled cluster of related controls. The `data-testid` is
// derived from the group key so the E2E suite can assert each cluster
// exists.
const Group = styled.div`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xxs};
  padding: 0 ${({ theme }) => theme.spacing.xs};
  border-right: 1px solid ${({ theme }) => theme.border.subtle};

  &:last-of-type {
    border-right: none;
  }

  .group-label {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    color: ${({ theme }) => theme.text.muted};
    margin-right: ${({ theme }) => theme.spacing.xxs};
    font-size: ${({ theme }) => theme.font.sizes.xxs};
  }
`

type TFn = (key: string, opts?: Record<string, unknown>) => string

export type GraphToolbarProps = {
  t: TFn
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  layout: LayoutName
  onChangeLayout: (next: LayoutName) => void
  layouts: readonly LayoutName[]
  layoutLabel: (name: LayoutName, t: TFn) => string
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onResetView: () => void
  selectionMode: 'pan' | 'box'
  onToggleSelectionMode: () => void
  clusterByLabel: boolean
  onToggleClusterByLabel: () => void
  degreeSizing: boolean
  onToggleDegreeSizing: () => void
  pathActive: boolean
  onTogglePathMode: () => void
  onPathClear: () => void
  miniMap: boolean
  onToggleMiniMap: () => void
  lasso: boolean
  onToggleLasso: () => void
  domNodes: boolean
  onToggleDomNodes: () => void
  findNodes: Record<string, unknown>[]
  onFindPick: (id: string) => void
  counts: { nodes: number; edges: number }
  // renderer / onToggleRenderer are kept on the props bag for source-
  // level compat with callers but no longer surfaced as inline buttons —
  // the reagraph dispatcher branch is disabled in this build. When the
  // dispatcher is re-enabled the toggle can be re-added (likely as a
  // fifth item inside the More dropdown).
  renderer: 'cytoscape' | 'reagraph'
  onToggleRenderer: () => void
}

export const GraphToolbar: React.FC<GraphToolbarProps> = ({
  t,
  sidebarCollapsed,
  onToggleSidebar,
  layout,
  onChangeLayout,
  layouts,
  layoutLabel,
  onZoomIn,
  onZoomOut,
  onFit,
  onResetView,
  selectionMode,
  onToggleSelectionMode,
  clusterByLabel,
  onToggleClusterByLabel,
  degreeSizing,
  onToggleDegreeSizing,
  pathActive,
  onTogglePathMode,
  onPathClear,
  miniMap,
  onToggleMiniMap,
  lasso,
  onToggleLasso,
  domNodes,
  onToggleDomNodes,
  findNodes,
  onFindPick,
  counts,
  // renderer / onToggleRenderer are intentionally kept in the props bag
  // for source-level compat with the GraphView orchestrator. They are not
  // rendered as inline buttons — the reagraph dispatcher branch is
  // disabled in this build. Destructured to satisfy react/no-unused-prop-types.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  renderer: _renderer,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onToggleRenderer: _onToggleRenderer,
}) => {
  // First-class sidebar toggle is rendered inline at <= md viewports so
  // mobile users don't have to two-tap through the More dropdown to
  // collapse/expand the inspector panel that stacks below the canvas.
  // Above md the desktop dropdown entry (GraphToolbarMore) remains the
  // primary affordance.
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY)
  const sidebarToggleLabel = sidebarCollapsed
    ? t('graph.toggleSidebarShow')
    : t('graph.toggleSidebarHide')
  return (
    <Toolbar data-testid="graph-toolbar" role="toolbar">
      {isMobile && (
        <wa-button
          appearance={sidebarCollapsed ? 'filled' : 'outlined'}
          size="s"
          role="button"
          data-testid="query-sidebar-toggle"
          aria-pressed={sidebarCollapsed ? 'true' : 'false'}
          aria-label={sidebarToggleLabel}
          title={sidebarToggleLabel}
          onClick={onToggleSidebar}
        >
          <Icon name={sidebarCollapsed ? 'bars' : 'angles-left'} />
        </wa-button>
      )}
      <FindNodeInput nodes={findNodes} onPick={onFindPick} t={t} />
      <Group
        data-testid="graph-toolbar-group-view"
        aria-label={t('graph.viewGroupLabel')}
      >
        <span className="group-label">{t('graph.viewGroupLabel')}</span>
        <BootstrapDropdown<LayoutName>
          items={layouts.map((name) => ({
            value: name,
            label: layoutLabel(name, t),
          }))}
          value={layout}
          onChange={(next) => onChangeLayout(next)}
          ariaLabel={t('graph.layoutLabel')}
          size="sm"
          className="geode-bs-inline-dropdown graph-layout-toggle-wrap"
          triggerProps={{ 'data-testid': 'graph-layout-picker' }}
        />
        <wa-button
          appearance="outlined"
          size="s"
          data-testid="graph-zoom-in"
          aria-label={t('graph.zoomIn')}
          title={t('graph.zoomIn')}
          onClick={onZoomIn}
        >
          <Icon name="plus" />
        </wa-button>
        <wa-button
          appearance="outlined"
          size="s"
          data-testid="graph-zoom-out"
          aria-label={t('graph.zoomOut')}
          title={t('graph.zoomOut')}
          onClick={onZoomOut}
        >
          <Icon name="minus" />
        </wa-button>
        <wa-button
          appearance="outlined"
          size="s"
          data-testid="graph-fit"
          aria-label={t('graph.fit')}
          title={t('graph.fit')}
          onClick={onFit}
        >
          <Icon name="expand" />
        </wa-button>
        <wa-button
          appearance="outlined"
          size="s"
          data-testid="graph-reset-view"
          aria-label={t('graph.resetView')}
          title={t('graph.resetView')}
          onClick={onResetView}
        >
          <Icon name="arrows-rotate" />
        </wa-button>
      </Group>
      <Group
        data-testid="graph-toolbar-group-filters"
        aria-label={t('graph.filtersGroupLabel')}
      >
        <span className="group-label">{t('graph.filtersGroupLabel')}</span>
        <wa-button
          appearance={selectionMode === 'box' ? 'filled' : 'outlined'}
          size="s"
          data-testid="graph-selection-mode"
          aria-pressed={selectionMode === 'box' ? 'true' : 'false'}
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
        </wa-button>
        <wa-button
          appearance={clusterByLabel ? 'filled' : 'outlined'}
          size="s"
          data-testid="graph-cluster-toggle"
          aria-pressed={clusterByLabel ? 'true' : 'false'}
          aria-label={t('graph.clusterByLabelLabel')}
          title={t('graph.clusterByLabelLabel')}
          onClick={onToggleClusterByLabel}
        >
          {t('graph.clusterByLabel')}
        </wa-button>
        <wa-button
          appearance={degreeSizing ? 'filled' : 'outlined'}
          size="s"
          data-testid="graph-size-toggle"
          aria-pressed={degreeSizing ? 'true' : 'false'}
          aria-label={t('graph.degreeSizingLabel')}
          title={t('graph.degreeSizingLabel')}
          onClick={onToggleDegreeSizing}
        >
          {t('graph.degreeSizing')}
        </wa-button>
      </Group>
      <Group
        data-testid="graph-toolbar-group-analysis"
        aria-label={t('graph.analysisGroupLabel')}
      >
        <span className="group-label">{t('graph.analysisGroupLabel')}</span>
        <wa-button
          appearance={pathActive ? 'filled' : 'outlined'}
          size="s"
          data-testid="graph-path-mode"
          aria-pressed={pathActive ? 'true' : 'false'}
          aria-label={t('graph.pathModeLabel')}
          title={t('graph.pathModeLabel')}
          onClick={onTogglePathMode}
        >
          {t('graph.pathMode')}
        </wa-button>
        {pathActive && (
          <wa-button
            appearance="outlined"
            size="s"
            data-testid="graph-path-clear"
            onClick={onPathClear}
          >
            {t('graph.pathClear')}
          </wa-button>
        )}
      </Group>
      <GraphToolbarMore
        t={t}
        miniMap={miniMap}
        onToggleMiniMap={onToggleMiniMap}
        lasso={lasso}
        onToggleLasso={onToggleLasso}
        domNodes={domNodes}
        onToggleDomNodes={onToggleDomNodes}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
      />
      <span className="stats" aria-live="polite">
        {t('graph.stats', { nodes: counts.nodes, edges: counts.edges })}
      </span>
    </Toolbar>
  )
}
