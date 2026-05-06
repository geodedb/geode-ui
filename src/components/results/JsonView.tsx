import React from 'react'
import styled from 'styled-components'

const Pre = styled.pre`
  background: #0d1117;
  color: #c9d1d9;
  padding: 12px;
  overflow: auto;
  max-height: 480px;
  border: 1px solid ${({ theme }) => theme.colors.border};
`

export const JsonView: React.FC<{ data: unknown }> = ({ data }) => (
  <Pre>{JSON.stringify(data, null, 2)}</Pre>
)
