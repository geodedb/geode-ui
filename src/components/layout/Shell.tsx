import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Link,
  NavLink as RouterNavLink,
  Outlet,
  useLocation,
} from 'react-router-dom'
import styled, { DefaultTheme } from 'styled-components'

import { useAuth } from '../../auth/AuthProvider'
import { above, below } from '../../theme'
import { Button, Icon, Logo, Spacer } from '../ui'
import { AddConnectionModal } from './AddConnectionModal'
import { ConnectionSwitcher } from './ConnectionSwitcher'
import { ThemeSelector } from './ThemeSelector'

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
//
// Top is the app shell header. Two responsiveness rules apply:
//   1) Never wrap. A wrapping header is the symptom-hide for
//      "content does not fit"; instead we collapse the desktop nav
//      into a drawer at the lg breakpoint (≤ 991 px) so brand +
//      ConnectionSwitcher + hamburger always fit on one line.
//   2) `overflow-x: clip` ensures a ConnectionSwitcher with a
//      pathologically long profile name cannot push the body
//      sideways or trigger a horizontal page scrollbar.
const Top = styled.nav`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  border-bottom: 1px solid ${({ theme }) => theme.border.subtle};
  background: ${({ theme }) => theme.bg.surface};
  align-items: center;
  flex-wrap: nowrap;
  overflow-x: clip;
  min-width: 0;

  ${below('lg')`
    padding: ${({ theme }: { theme: DefaultTheme }) => theme.spacing.sm} ${({
      theme,
    }: {
      theme: DefaultTheme
    }) => theme.spacing.md};
    gap: ${({ theme }: { theme: DefaultTheme }) => theme.spacing.sm};
  `}
`

const BrandLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  border-radius: ${({ theme }) => theme.radii.md};
  flex-shrink: 0;
  min-width: 0;

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

// Body is a flex column rooted at the dynamic viewport height (dvh
// excludes mobile browser chrome that vh includes). The Top nav stays
// above it as a separate flex item of the document; subtract its
// rendered height through `flex: 1 1 0` + `min-height: 0` so children
// (QueryPage, etc.) can grow into the remaining space without ever
// scrolling the page itself — only their internal panes scroll.
const Body = styled.main`
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - 57px);
  padding: ${({ theme }) => theme.spacing.lg};
  /* The viewport-height calc above subtracts an approximation of the
     Top nav row (sm vertical padding × 2 + 28 px logo + 1 px border ≈
     57 px). The flex chain below this point uses min-height: 0 so a
     long child doesn't push the page off-screen. */

  ${below('sm')`
    padding: ${({ theme }: { theme: DefaultTheme }) => theme.spacing.md};
    min-height: calc(100dvh - 49px);
  `}
`

// NavLink wraps react-router's NavLink, which (a) sets aria-current="page"
// on the active route and (b) adds an `active` class to the rendered <a>.
// We style `&.active` with the primary text colour, the subtle surface
// background, and a bottom accent bar so the operator always knows which
// view they're in — both visually and for assistive tech. The `to="/"`
// links must carry `end` so the Query link isn't flagged active on every
// nested route (`/` is a prefix of all of them).
const NavLink = styled(RouterNavLink)`
  color: ${({ theme }) => theme.text.secondary};
  text-decoration: none;
  font-weight: ${({ theme }) => theme.font.weights.medium};
  padding: 8px 12px;
  border-radius: ${({ theme }) => theme.radii.md};

  &:hover {
    color: ${({ theme }) => theme.text.primary};
    background: ${({ theme }) => theme.bg.subtle};
  }

  &.active {
    color: ${({ theme }) => theme.text.primary};
    background: ${({ theme }) => theme.bg.subtle};
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    box-shadow: inset 0 -2px 0 ${({ theme }) => theme.colors.primary};
  }

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }

  /* When the link is both active and focused, keep the focus ring
     visible but don't drop the active accent — stack both shadows. */
  &.active:focus-visible {
    box-shadow:
      ${({ theme }) => theme.shadows.focus},
      inset 0 -2px 0 ${({ theme }) => theme.colors.primary};
  }
`

// DesktopNav owns the desktop nav links + Spacer + logout button.
// Previously this used `display: contents` which removes the wrapper
// from the box tree — the children participated in `Top`'s flex line
// directly. That fought with `flex-wrap: wrap` to produce a header
// that wrapped to two lines mid-md viewports (logout dropping below
// the brand). With `display: flex` the desktop nav is its own flex
// child that can shrink coherently and own its trailing Spacer.
//
// Collapse threshold raised from md (768 px) to lg (992 px) — at
// md you have brand + ConnectionSwitcher + 4 nav links + Spacer +
// logout in ~720 px after padding, which only fits if every label
// is short. Falling back to the drawer at lg leaves room for
// long connection names without clipping.
const DesktopNav = styled.div`
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  min-width: 0;

  ${below('lg')`
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
  flex-shrink: 0;

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }

  ${below('lg')`
    display: inline-flex;
  `}

  /* Font Awesome bars/xmark drawn with currentColor (the wrapping
     button's color cascades into the <i>'s ::before pseudo-element).
     Bump the glyph slightly above the 1em default so it stays legible
     at the button's min touch-target size in both themes. */
  i {
    font-size: 1.25rem;
  }
`

const Drawer = styled.div<{ $open: boolean }>`
  display: ${({ $open }) => ($open ? 'flex' : 'none')};
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
  background: ${({ theme }) => theme.bg.surface};
  border-bottom: 1px solid ${({ theme }) => theme.border.subtle};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};

  ${above('lg')`
    display: none;
  `}

  & a,
  & button {
    width: 100%;
    text-align: left;
    justify-content: flex-start;
  }
`

export const Shell: React.FC = () => {
  const { signOut, isAdmin } = useAuth()
  const { t } = useTranslation()
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [addOpen, setAddOpen] = useState(false)
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
      <SkipLink href="#main-content">{t('common.skipToMain')}</SkipLink>
      <Top aria-label={t('nav.primary')}>
        <BrandLink to="/" aria-label={t('brand.home')}>
          <Logo height={28} />
        </BrandLink>
        <ConnectionSwitcher onAddRequested={() => setAddOpen(true)} />
        <DesktopNav>
          <NavLink to="/dashboard">{t('nav.dashboard')}</NavLink>
          <NavLink to="/" end>
            {t('nav.query')}
          </NavLink>
          <NavLink to="/schema">{t('nav.schema')}</NavLink>
          {/*
            SEC issue 264: hide the /admin entry-point for non-admins.
            The route itself is RoleGate-protected, so a direct nav
            still redirects; this just stops advertising the link in
            the chrome.
          */}
          {isAdmin && <NavLink to="/admin">{t('nav.admin')}</NavLink>}
          <NavLink to="/profiles">{t('nav.profiles')}</NavLink>
          {/* GAP-061: top-level docs link so the in-app viewer is one
              click away from every authenticated route. */}
          <NavLink to="/docs">{t('nav.docs')}</NavLink>
          <Spacer />
          <ThemeSelector />
          <Button variant="ghost" size="sm" onClick={onLogout}>
            {t('nav.logout')}
          </Button>
        </DesktopNav>
        <MobileToggle
          type="button"
          aria-label={drawerOpen ? t('common.closeMenu') : t('common.openMenu')}
          aria-expanded={drawerOpen}
          aria-controls="primary-drawer"
          onClick={() => setDrawerOpen((v) => !v)}
        >
          <Icon name={drawerOpen ? 'xmark' : 'bars'} fixedWidth />
        </MobileToggle>
      </Top>
      <Drawer
        id="primary-drawer"
        $open={drawerOpen}
        aria-label={t('nav.primaryMobile')}
      >
        <NavLink to="/dashboard">{t('nav.dashboard')}</NavLink>
        <NavLink to="/" end>
          {t('nav.query')}
        </NavLink>
        <NavLink to="/schema">{t('nav.schema')}</NavLink>
        {isAdmin && <NavLink to="/admin">{t('nav.admin')}</NavLink>}
        <NavLink to="/profiles">{t('nav.profiles')}</NavLink>
        <NavLink to="/docs">{t('nav.docs')}</NavLink>
        <ThemeSelector />
        <Button variant="ghost" size="md" fullWidth onClick={onLogout}>
          {t('nav.logout')}
        </Button>
      </Drawer>
      <Body id="main-content">
        <Outlet />
      </Body>
      <AddConnectionModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  )
}
