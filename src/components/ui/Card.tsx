import styled from 'styled-components'

// Card — elevated panel for content groupings (admin tables, ops
// dashboards). Uses the brand site's card pattern (border + small
// shadow + transition on hover) but is non-interactive by default.
export const Card = styled.section`
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.xl};
  box-shadow: ${({ theme }) => theme.shadows.sm};
  padding: ${({ theme }) => theme.spacing.lg};
`

export const CardHeader = styled.header`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};

  h1,
  h2,
  h3 {
    font-size: ${({ theme }) => theme.font.sizes.lg};
    color: ${({ theme }) => theme.text.primary};
  }
`

export const CardTitle = styled.h2`
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.lg};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  color: ${({ theme }) => theme.text.primary};
  margin: 0;
`

export const CardSubtitle = styled.p`
  font-size: ${({ theme }) => theme.font.sizes.sm};
  color: ${({ theme }) => theme.text.muted};
  margin: 0;
`
