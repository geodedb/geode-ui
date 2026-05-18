import React from 'react'
import type { Core } from 'cytoscape'
import type { MutableRefObject, RefObject } from 'react'
import type { TFunction } from 'i18next'
import { Canvas, ErrorBanner, Overlay } from './styled'
import { GraphMiniMap } from './GraphMiniMap'
import { GraphBadges } from './GraphBadges'
import { GraphTooltip } from './GraphTooltip'
import { FocusClearChip } from './FocusClearChip'
import type { useGraphBadges } from './useGraphBadges'
import type { TooltipTargetData } from './useNodeTooltip'

// GraphCanvasOverlay is the position-relative wrapper around the
// Cytoscape <Canvas> and every overlay layered on top of it
// (empty-state, error banner, mini-map, badges, tooltip,
// focus-clear chip). Lifted out of the orchestrator's JSX
// (QUAL #164) so the wrapper-flex rationale lives next to the
// component that owns it.
//
// In fill mode the Canvas child uses `flex: 1 1 auto` to grow
// inside its parent -- which means this wrapper must itself be a
// flex item that grows. Without `display: flex` + `min-height: 0`
// the cytoscape canvases render at height=0 (regression caught by
// e2e/specs/20 -- pre-fix the bench canvas was 990x0 because the
// wrapper was auto-height).
export type GraphCanvasOverlayProps = {
  canvasRef: RefObject<HTMLDivElement>
  cyRef: MutableRefObject<Core | null>
  sig: string
  t: TFunction
  empty: boolean
  error: string | null
  miniMap: boolean
  badgesEnabled: boolean
  badges: ReturnType<typeof useGraphBadges>
  tooltipsEnabled: boolean
  tooltipTarget: TooltipTargetData | null
  focusActive: boolean
  onClearFocus: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
}

export const GraphCanvasOverlay: React.FC<GraphCanvasOverlayProps> = ({
  canvasRef,
  cyRef,
  sig,
  t,
  empty,
  error,
  miniMap,
  badgesEnabled,
  badges,
  tooltipsEnabled,
  tooltipTarget,
  focusActive,
  onClearFocus,
  onKeyDown,
}) => (
  <div
    className="position-relative d-flex flex-column flex-fill"
    style={{ minHeight: 0 }}
  >
    <Canvas
      ref={canvasRef}
      role="img"
      aria-label={t('graph.canvasAria')}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="graph-canvas"
      data-focus-active={focusActive ? 'true' : 'false'}
    />
    {empty && (
      <Overlay data-testid="graph-empty-state">{t('graph.empty')}</Overlay>
    )}
    {error && <ErrorBanner role="alert">{error}</ErrorBanner>}
    {miniMap && <GraphMiniMap cyRef={cyRef} sig={sig} />}
    {badgesEnabled && <GraphBadges badges={badges} />}
    {tooltipsEnabled && <GraphTooltip targetData={tooltipTarget} t={t} />}
    <FocusClearChip active={focusActive} onClear={onClearFocus} t={t} />
  </div>
)
