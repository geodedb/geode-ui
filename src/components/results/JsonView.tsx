import React, { useMemo } from 'react'
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

// PERF-2026-05-11-08 (#147): JSON.stringify of a large result is not
// cheap. Previously it ran on every render of QueryPage (which, before
// PERF-2026-05-11-02/#130, was every keystroke / stream row). Memoize
// the serialized string on `data` identity, and wrap the component in
// React.memo so an unrelated parent re-render that hands back the same
// `data` reference skips re-render entirely. Pairs with #130 — once
// `activeResp` has a stable identity, this memo actually holds.
const JsonViewImpl: React.FC<{ data: unknown; fillHeight?: boolean }> = ({
  data,
  fillHeight = false,
}) => {
  const text = useMemo(() => JSON.stringify(data, null, 2), [data])
  return <Pre $fill={fillHeight}>{text}</Pre>
}

export const JsonView = React.memo(JsonViewImpl)
JsonView.displayName = 'JsonView'
