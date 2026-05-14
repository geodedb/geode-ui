import React from 'react'
import styled from 'styled-components'
import { formatPropValue } from '../propFormat'
import type { TooltipTargetData } from './useNodeTooltip'

type TFn = (key: string, opts?: Record<string, unknown>) => string

const Box = styled.div`
  position: absolute;
  top: ${({ theme }) => theme.spacing.sm};
  left: ${({ theme }) => theme.spacing.sm};
  z-index: 7;
  max-width: 280px;
  pointer-events: none;
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.primary};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs};
  box-shadow: ${({ theme }) => theme.shadows.md ?? theme.shadows.sm};

  .label {
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    margin-bottom: 4px;
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 8px;
    font-size: ${({ theme }) => theme.font.sizes.xs};
  }
  dt {
    color: ${({ theme }) => theme.text.secondary};
  }
  dd {
    margin: 0;
    word-break: break-word;
  }
`

export type GraphTooltipProps = {
  targetData: TooltipTargetData | null
  t: TFn
}

// Fixed-position tooltip card pinned to the canvas top-left. Reveals
// the hovered node's label + property values. Pointer-events:none so
// the tooltip doesn't intercept canvas hover.
export const GraphTooltip: React.FC<GraphTooltipProps> = ({
  targetData,
  t,
}) => {
  if (!targetData) return null
  const propKeys = Object.keys(targetData.props)
  return (
    <Box data-testid="graph-tooltip" role="tooltip">
      <div className="label">{targetData.label || `#${targetData.id}`}</div>
      {propKeys.length === 0 ? (
        <div>{t('graph.tooltipNoProps')}</div>
      ) : (
        <dl>
          {propKeys.map((k) => (
            <React.Fragment key={k}>
              <dt>{k}</dt>
              <dd>{formatPropValue(targetData.props[k])}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </Box>
  )
}
