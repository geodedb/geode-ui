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
//
// Bootstrap-migrated (docs/BOOTSTRAP_MIGRATION.md):
//   - Section: surface treatment now comes from Bootstrap utilities
//     (`bg-body-secondary shadow-sm rounded-3 p-3`) which read the
//     `--bs-*` bridge tokens emitted by theme-bridge.ts.
//   - Header: pure-layout outer flex (`d-flex align-items-center
//     justify-content-between gap-2 mb-2`).
//   - H2Title: kept as styled-component because its custom display
//     font family (theme.font.family.display = "Sora, ...") and the
//     pixel-precise theme.font.sizes.lg have no Bootstrap utility
//     equivalent — `fs-*` maps to rem scale, not our 16 px display
//     heading size.
const H2Title = styled.h2`
  margin: 0;
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.lg};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  color: ${({ theme }) => theme.text.primary};
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
    <section
      className="bg-body-secondary shadow-sm rounded-3 p-3"
      data-testid={dataTestId}
    >
      <header className="d-flex align-items-center justify-content-between gap-2 mb-2">
        <H2Title>{title}</H2Title>
        {action ? <div>{action}</div> : null}
      </header>
      {children}
    </section>
  )
}
