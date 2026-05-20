import React from 'react'
import styled from 'styled-components'
import { breakpoints } from '@geodedb/ui-core/theme'
import { Icon } from '@geodedb/ui-core'
import { useMediaQuery } from '../../../hooks/useMediaQuery'

// On mobile (<= md) the pill is suppressed entirely. Stacked vertically
// the pill is ~210-250 px tall (zoom-in + 110 px slider + zoom-out + fit
// + reset + 4×4 px gaps + 8 px padding) — taller than a typical short-
// viewport canvas, so anchoring at `bottom: 12 px` of the canvas
// wrapper pushed the pill's top edge ABOVE the canvas, overlapping the
// toolbar / filter chips. Pinch-to-zoom and two-finger pan are the
// canonical mobile gestures on a touch canvas; the pill is desktop
// chrome that has no place at small widths.
const MOBILE_MEDIA_QUERY = `(max-width: ${breakpoints.md - 0.02}px)`

const Pill = styled.div`
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xxs};
  padding: ${({ theme }) => theme.spacing.xs};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.pill};
  box-shadow: ${({ theme }) => theme.shadows.sm};
  z-index: 5;
`

const Slider = styled.input`
  appearance: slider-vertical;
  writing-mode: vertical-lr;
  direction: rtl;
  width: 1.25rem;
  height: 110px;
  margin: ${({ theme }) => theme.spacing.xxs} 0;
`

const IconBtn = styled.button`
  appearance: none;
  background: transparent;
  border: none;
  color: ${({ theme }) => theme.text.primary};
  padding: 4px 6px;
  border-radius: ${({ theme }) => theme.radii.sm};
  cursor: pointer;
  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
  }
  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

export type GraphCanvasControlsProps = {
  zoomLevel: number
  onZoomLevelChange: (level: number) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onResetView: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
}

export const GraphCanvasControls: React.FC<GraphCanvasControlsProps> = ({
  zoomLevel,
  onZoomLevelChange,
  onZoomIn,
  onZoomOut,
  onFit,
  onResetView,
  t,
}) => {
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY)
  if (isMobile) return null
  return (
    <Pill role="group" aria-label={t('graph.canvasControls.aria')}>
      <IconBtn
        type="button"
        data-testid="graph-canvas-zoom-in"
        aria-label={t('graph.canvasControls.zoomIn')}
        title={t('graph.canvasControls.zoomIn')}
        onClick={onZoomIn}
      >
        <Icon name="plus" />
      </IconBtn>
      <Slider
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={zoomLevel}
        data-testid="graph-canvas-zoom-slider"
        aria-label={t('graph.zoomSlider.aria')}
        onChange={(e) => onZoomLevelChange(Number(e.target.value))}
      />
      <IconBtn
        type="button"
        data-testid="graph-canvas-zoom-out"
        aria-label={t('graph.canvasControls.zoomOut')}
        title={t('graph.canvasControls.zoomOut')}
        onClick={onZoomOut}
      >
        <Icon name="minus" />
      </IconBtn>
      <IconBtn
        type="button"
        data-testid="graph-canvas-fit"
        aria-label={t('graph.canvasControls.fit')}
        title={t('graph.canvasControls.fit')}
        onClick={onFit}
      >
        <Icon name="expand" />
      </IconBtn>
      <IconBtn
        type="button"
        data-testid="graph-canvas-reset"
        aria-label={t('graph.canvasControls.reset')}
        title={t('graph.canvasControls.reset')}
        onClick={onResetView}
      >
        <Icon name="rotate-left" />
      </IconBtn>
    </Pill>
  )
}
