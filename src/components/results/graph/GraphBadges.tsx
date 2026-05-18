import React from 'react'
import styled from 'styled-components'
import type { Badge } from './useGraphBadges'
import { Icon } from '../../ui'

const Layer = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
`

const PinBadge = styled.div`
  position: absolute;
  transform: translate(-50%, -100%);
  font-size: ${({ theme }) => theme.font.sizes.xs};
  line-height: 1;
  padding: 2px 4px;
  background: ${({ theme }) => theme.colors.warning};
  color: ${({ theme }) => theme.text.primary};
  border-radius: ${({ theme }) => theme.radii.pill};
  pointer-events: none;
  user-select: none;
`

const CollapsedBadge = styled.div`
  position: absolute;
  transform: translate(-50%, 0);
  min-width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: ${({ theme }) => theme.font.sizes.xs};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  background: ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.text.onPrimary};
  border-radius: ${({ theme }) => theme.radii.pill};
  padding: 0 4px;
  pointer-events: none;
  user-select: none;
`

export type GraphBadgesProps = {
  badges: Badge[]
}

// Absolute-positioned DOM overlay drawn on top of the cytoscape canvas.
// Badges follow live node positions via useGraphBadges (RAF-throttled).
export const GraphBadges: React.FC<GraphBadgesProps> = ({ badges }) => {
  if (badges.length === 0) return null
  return (
    <Layer aria-hidden="true">
      {badges.map((b) => {
        if (b.kind === 'pin') {
          return (
            <PinBadge
              key={`pin-${b.nodeId}`}
              data-testid={`graph-badge-pin-${b.nodeId}`}
              style={{ left: b.x, top: b.y }}
            >
              <Icon name="thumbtack" />
            </PinBadge>
          )
        }
        return (
          <CollapsedBadge
            key={`collapsed-${b.nodeId}`}
            data-testid={`graph-badge-collapsed-${b.nodeId}`}
            style={{ left: b.x, top: b.y }}
          >
            {b.count}
          </CollapsedBadge>
        )
      })}
    </Layer>
  )
}
