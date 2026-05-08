import React from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import styled from 'styled-components'

import { useAuth } from '../../auth/AuthProvider'
import { above, below } from '../../theme'
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

/* eslint-disable indent -- Prettier wraps interpolations inside the
 * below() helper and lands at 6 spaces; eslint expects 2. The wrapped
 * form is Prettier-canonical, so we defer to Prettier on this file. */
const Top = styled.nav`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  border-bottom: 1px solid ${({ theme }) => theme.border.subtle};
  background: ${({ theme }) => theme.bg.surface};
  align-items: center;
  flex-wrap: wrap;

  ${below('md')`
    padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) =>
      theme.spacing.md};
    gap: ${({ theme }) => theme.spacing.sm};
  `}
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

  ${below('sm')`
    padding: ${({ theme }) => theme.spacing.md};
  `}
`

const NavLink = styled(Link)`
  color: ${({ theme }) => theme.text.secondary};
  text-decoration: none;
  font-weight: ${({ theme }) => theme.font.weights.medium};
  padding: 8px 12px;
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

const DesktopNav = styled.div`
  display: contents;

  ${below('md')`
    display: none;
  `}
`

const MobileToggle = styled.button`
  display: none;
  align-items: center;
  justify-content: center;
  width: ${({ theme }) => theme.touchTargets.min}px;
  height: ${({ theme }) => theme.touchTargets.min}px;
  background: transparent;
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.md};
  color: ${({ theme }) => theme.text.primary};
  cursor: pointer;
  margin-left: auto;

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }

  ${below('md')`
    display: inline-flex;
  `}

  /* Three-bar hamburger drawn with currentColor so it tracks the
     foreground in both themes. The bars collapse into an X when the
     drawer is open. */
  svg {
    width: 22px;
    height: 22px;
  }
`

const Drawer = styled.div<{ $open: boolean }>`
  display: ${({ $open }) => ($open ? 'flex' : 'none')};
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
  background: ${({ theme }) => theme.bg.surface};
  border-bottom: 1px solid ${({ theme }) => theme.border.subtle};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};

  ${above('md')`
    display: none;
  `}

  & a,
  & button {
    width: 100%;
    text-align: left;
    justify-content: flex-start;
  }
`

const Burger: React.FC<{ open: boolean }> = ({ open }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    {open ? (
      <>
        <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
        <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
      </>
    ) : (
      <>
        <line x1="4" y1="7" x2="20" y2="7" strokeLinecap="round" />
        <line x1="4" y1="12" x2="20" y2="12" strokeLinecap="round" />
        <line x1="4" y1="17" x2="20" y2="17" strokeLinecap="round" />
      </>
    )}
  </svg>
)

export const Shell: React.FC = () => {
  const { signOut } = useAuth()
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const location = useLocation()

  // Auto-close the drawer on route change so a tap on a nav link
  // dismisses the menu without an extra interaction.
  React.useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

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
        <DesktopNav>
          <NavLink to="/">Query</NavLink>
          <NavLink to="/schema">Schema</NavLink>
          <NavLink to="/admin">Admin</NavLink>
          <NavLink to="/ops">Ops</NavLink>
          <Spacer />
          <Button variant="ghost" size="sm" onClick={onLogout}>
            Logout
          </Button>
        </DesktopNav>
        <MobileToggle
          type="button"
          aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={drawerOpen}
          aria-controls="primary-drawer"
          onClick={() => setDrawerOpen((v) => !v)}
        >
          <Burger open={drawerOpen} />
        </MobileToggle>
      </Top>
      <Drawer
        id="primary-drawer"
        $open={drawerOpen}
        aria-label="Primary mobile"
      >
        <NavLink to="/">Query</NavLink>
        <NavLink to="/schema">Schema</NavLink>
        <NavLink to="/admin">Admin</NavLink>
        <NavLink to="/ops">Ops</NavLink>
        <Button variant="ghost" size="md" fullWidth onClick={onLogout}>
          Logout
        </Button>
      </Drawer>
      <Body id="main-content">
        <Outlet />
      </Body>
    </>
  )
}
