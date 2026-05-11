import React from 'react'
import styled from 'styled-components'

// `$fill`: when the JSON view is hosted inside the maximized result
// overlay it should fill the overlay's content box rather than cap at
// the default 480 px. The default (non-fill) cap is kept so the inline
// query-page view doesn't push the rest of the page off the fold.
const Pre = styled.pre<{ $fill: boolean }>`
  background: ${({ theme }) => theme.bg.canvas};
  color: ${({ theme }) => theme.text.primary};
  font-family: ${({ theme }) => theme.font.family.mono};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  padding: ${({ theme }) => theme.spacing.md};
  overflow: auto;
  ${({ $fill }) => {
    return $fill ? 'height: 100%; max-height: none;' : 'max-height: 480px;'
  }}
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
`

export const JsonView: React.FC<{ data: unknown; fillHeight?: boolean }> = ({
  data,
  fillHeight = false,
}) => <Pre $fill={fillHeight}>{JSON.stringify(data, null, 2)}</Pre>
