import React from 'react'
import styled from 'styled-components'

// Card — the dashboard panel shell. A titled, elevated section with an
// optional right-aligned action node in the header. The four overview
// cards (graphs, recent queries, connection, graph stats) all compose
// from this so the header layout and surface treatment stay uniform.
//
// Distinct from src/components/ui/Card.tsx: that one is a bare
// styled.section primitive used across admin tables; this one bakes in
// the header row + h2 so dashboard cards don't each re-roll it.
const Section = styled.section`
  background: ${({ theme }) => theme.bg.surface};
  box-shadow: ${({ theme }) => theme.shadows.sm};
  border-radius: ${({ theme }) => theme.radii.lg};
  padding: ${({ theme }) => theme.spacing.md};
`

const Header = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.sm};

  h2 {
    margin: 0;
    font-family: ${({ theme }) => theme.font.family.display};
    font-size: ${({ theme }) => theme.font.sizes.lg};
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    color: ${({ theme }) => theme.text.primary};
  }
`

export interface CardProps {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  'data-testid'?: string
}

export const Card: React.FC<CardProps> = ({
  title,
  action,
  children,
  'data-testid': dataTestId,
}) => {
  return (
    <Section data-testid={dataTestId}>
      <Header>
        <h2>{title}</h2>
        {action ? <div>{action}</div> : null}
      </Header>
      {children}
    </Section>
  )
}
