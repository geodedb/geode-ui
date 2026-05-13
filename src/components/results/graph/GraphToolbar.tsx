import React from 'react'
import styled from 'styled-components'
import type { LayoutName } from '../useGraphPrefs'

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
  }

  .stats {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    color: ${({ theme }) => theme.text.muted};
  }
`

type TFn = (key: string, opts?: Record<string, unknown>) => string

export type GraphToolbarProps = {
  // i18n function. Passed in so the toolbar doesn't re-acquire it via
  // useTranslation (the orchestrator already calls it once).
  t: TFn
  // Sidebar collapse toggle.
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  // Layout picker.
  layout: LayoutName
  onChangeLayout: (next: LayoutName) => void
  layouts: readonly LayoutName[]
  layoutLabel: (name: LayoutName, t: TFn) => string
  // Zoom / fit / reset buttons.
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onResetView: () => void
  // Toggles.
  selectionMode: 'pan' | 'box'
  onToggleSelectionMode: () => void
  clusterByLabel: boolean
  onToggleClusterByLabel: () => void
  // Path-mode controls. `pathActive` is true when path mode is in any
  // state other than 'off'. The clear button only renders when active.
  pathActive: boolean
  onTogglePathMode: () => void
  onPathClear: () => void
  // Live counts surfaced in the stats span.
  counts: { nodes: number; edges: number }
}

// GraphToolbar is the top action bar of the graph view. It owns the
// sidebar-collapse toggle, the layout picker, the viewport actions
// (zoom in/out, fit, reset), the selection-mode / cluster / path-mode
// toggles, and the live node/edge count.
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
  pathActive,
  onTogglePathMode,
  onPathClear,
  counts,
}) => {
  return (
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
          onClick={onToggleSidebar}
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
          onChange={(e) => onChangeLayout(e.target.value as LayoutName)}
        >
          {layouts.map((name) => (
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
          aria-pressed={pathActive}
          aria-label={t('graph.pathModeLabel')}
          title={t('graph.pathModeLabel')}
          onClick={onTogglePathMode}
        >
          {t('graph.pathMode')}
        </button>
        {pathActive && (
          <button
            type="button"
            data-testid="graph-path-clear"
            onClick={onPathClear}
          >
            {t('graph.pathClear')}
          </button>
        )}
      </div>
      <span className="stats" aria-live="polite">
        {t('graph.stats', { nodes: counts.nodes, edges: counts.edges })}
      </span>
    </Toolbar>
  )
}
