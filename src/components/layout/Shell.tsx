import React from 'react'
import { Link, Outlet } from 'react-router-dom'
import styled from 'styled-components'

import { useAuth } from '../../auth/AuthProvider'
import { Button, Spacer } from '../ui'
import { ConnectionPicker } from './ConnectionPicker'

const SkipLink = styled.a`
  position: absolute;
  left: -9999px;
  top: 0;
  background: ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.text.onPrimary};
  padding: 8px 12px;
  border-radius: ${({ theme }) => theme.radii.md};
  z-index: ${({ theme }) => theme.zIndex.sticky};

  &:focus,
  &:focus-visible {
    left: 12px;
    top: 12px;
  }
`

const Top = styled.nav`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  border-bottom: 1px solid ${({ theme }) => theme.border.subtle};
  background: ${({ theme }) => theme.bg.surface};
  align-items: center;
  flex-wrap: wrap;
`

const Brand = styled.span`
  font-family: ${({ theme }) => theme.font.family.display};
  font-weight: ${({ theme }) => theme.font.weights.bold};
  color: ${({ theme }) => theme.colors.primary};
  letter-spacing: -0.01em;
  font-size: ${({ theme }) => theme.font.sizes.lg};
`

const Body = styled.main`
  padding: ${({ theme }) => theme.spacing.lg};
`

const NavLink = styled(Link)`
  color: ${({ theme }) => theme.text.secondary};
  text-decoration: none;
  font-weight: ${({ theme }) => theme.font.weights.medium};
  padding: 6px 10px;
  border-radius: ${({ theme }) => theme.radii.md};

  &:hover {
    color: ${({ theme }) => theme.text.primary};
    background: ${({ theme }) => theme.bg.subtle};
  }

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

export const Shell: React.FC = () => {
  const { signOut } = useAuth()
  // signOut is async (it fires POST /api/v1/auth/logout); we attach a
  // .catch() so React's onClick stays synchronous and an unhandled-
  // rejection warning isn't produced on a network failure. The logout
  // helper already swallows fetch errors and clears local state
  // regardless.
  const onLogout = (): void => {
    signOut().catch(() => {
      /* logout is best-effort */
    })
  }
  return (
    <>
      <SkipLink href="#main-content">Skip to main content</SkipLink>
      <Top aria-label="Primary">
        <Brand>Geode</Brand>
        <ConnectionPicker />
        <NavLink to="/">Query</NavLink>
        <NavLink to="/schema">Schema</NavLink>
        <NavLink to="/admin">Admin</NavLink>
        <NavLink to="/ops">Ops</NavLink>
        <Spacer />
        <Button variant="ghost" size="sm" onClick={onLogout}>
          Logout
        </Button>
      </Top>
      <Body id="main-content">
        <Outlet />
      </Body>
    </>
  )
}
