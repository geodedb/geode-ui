import React from 'react'
import styled from 'styled-components'

const Pre = styled.pre`
  background: ${({ theme }) => theme.bg.canvas};
  color: ${({ theme }) => theme.text.primary};
  font-family: ${({ theme }) => theme.font.family.mono};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  padding: ${({ theme }) => theme.spacing.md};
  overflow: auto;
  max-height: 480px;
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
`

export const JsonView: React.FC<{ data: unknown }> = ({ data }) => (
  <Pre>{JSON.stringify(data, null, 2)}</Pre>
)
