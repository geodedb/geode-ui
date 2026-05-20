import React from 'react'
import styled from 'styled-components'

import { Icon } from '@geodedb/ui-core'

const Card = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: ${({ theme }) => theme.radii.md};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  font: ${({ theme }) => theme.font.sizes.xs} / 1.2
    ${({ theme }) => theme.font.family.body};
  color: ${({ theme }) => theme.text.primary};
  box-shadow: ${({ theme }) => theme.shadows.sm};
  max-width: 180px;
`

const Swatch = styled.span`
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: ${({ theme }) => theme.radii.circle};
  flex: 0 0 auto;
`

const Label = styled.span`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const Pin = styled.span`
  margin-left: 4px;
  color: ${({ theme }) => theme.colors.warning ?? theme.colors.primary};
  font-size: ${({ theme }) => theme.font.sizes.xxs};
`

export type CustomNodeTemplateProps = {
  label: string
  swatchColor: string
  pinned: boolean
}

// CustomNodeTemplate is the React component rendered as the DOM body
// of a single cytoscape node (via cytoscape-dom-node, mounted in
// Task 12). Pure presentational: label + swatch + optional pin glyph.
// The swatch color is computed upstream by the orchestrator from each
// node's first label via labelToColor (cytoscapeStyle.ts), so this
// component stays agnostic of the palette.
export const CustomNodeTemplate: React.FC<CustomNodeTemplateProps> = ({
  label,
  swatchColor,
  pinned,
}) => {
  return (
    <Card>
      <Swatch
        data-testid="custom-node-swatch"
        style={{ backgroundColor: swatchColor }}
      />
      <Label data-testid="custom-node-label">{label || '—'}</Label>
      {pinned && (
        <Pin data-testid="custom-node-pin" aria-hidden="true">
          <Icon name="thumbtack" />
        </Pin>
      )}
    </Card>
  )
}
