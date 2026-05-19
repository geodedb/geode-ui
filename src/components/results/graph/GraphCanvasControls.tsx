import React from 'react'
import styled from 'styled-components'
import { Icon } from '../../ui'

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
}) => (
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
