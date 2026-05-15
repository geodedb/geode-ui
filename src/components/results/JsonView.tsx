import React, { useMemo } from 'react'
import styled from 'styled-components'

// The <pre> flexes to fill its parent's content box. No max-height —
// the host (ResultPanel / a future caller) is responsible for sizing
// its flex container. Long output gets the same `overflow: auto`
// scrollbar it always had.
const Pre = styled.pre`
  background: ${({ theme }) => theme.bg.canvas};
  color: ${({ theme }) => theme.text.primary};
  font-family: ${({ theme }) => theme.font.family.mono};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  padding: ${({ theme }) => theme.spacing.md};
  overflow: auto;
  flex: 1 1 0;
  min-height: 0;
  max-height: none;
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  margin: 0;
`

// PERF-2026-05-11-08 (#147): JSON.stringify of a large result is not
// cheap. Memoize on `data` identity and wrap the component in React.memo
// so an unrelated parent re-render that hands back the same `data`
// reference skips re-render entirely. Pairs with #130 — once
// `activeResp` has a stable identity, this memo actually holds.
const JsonViewImpl: React.FC<{ data: unknown }> = ({ data }) => {
  const text = useMemo(() => JSON.stringify(data, null, 2), [data])
  return <Pre>{text}</Pre>
}

export const JsonView = React.memo(JsonViewImpl)
JsonView.displayName = 'JsonView'
