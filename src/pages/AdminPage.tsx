import React from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation } from 'react-router-dom'
import styled, { DefaultTheme } from 'styled-components'

import { useCapabilities } from '../hooks/useCapabilities'

// AdminPage is a tabbed shell mounted at /admin/* that hosts the
// administration sub-pages: Users, Roles, Policies, Grants
// (D2/D3) plus the operational sub-pages relocated from /ops:
// Backups, Restore, Migrations, Audit (D4/D5). The active tab is
// derived from pathname rather than React state so deep-linking and
// the browser back button both work correctly.
//
// QUAL-2026-05-17 (#250): tab text colours bind to the canonical
// `theme.text.primary` / `theme.text.secondary` tokens. The earlier
// `theme.colors.text` / `theme.colors.textSecondary` pair is a legacy
// back-compat mirror that the light theme still keeps in sync, but
// the dark theme has drifted twice in this codebase already — most
// recently the 27-contrast.spec WCAG bumps adjusted `text.*` without
// touching the `colors.*` mirror, producing low-contrast tabs in dark
// mode. Binding directly to `text.*` removes that risk entirely.
function adminTabColor(props: {
  $active: boolean
  theme: DefaultTheme
}): string {
  return props.$active ? props.theme.text.primary : props.theme.text.secondary
}

// Tabs — Bootstrap-migrated to a plain <nav className=...>. The 12 px
// gap is the only token not present in Bootstrap's 4 px scale (gap-2 = 8 px,
// gap-3 = 16 px), kept as an inline style. border-bottom comes from the
// `--bs-border-color` bridge so the Bootstrap `.border-bottom` utility
// resolves to theme.border.default at runtime. docs/BOOTSTRAP_MIGRATION.md.

const Tab = styled(Link)<{ $active: boolean }>`
  padding: 8px 12px;
  text-decoration: none;
  color: ${adminTabColor};
  border-bottom: 2px solid
    ${({ $active, theme }) => ($active ? theme.colors.primary : 'transparent')};
  margin-bottom: -1px;

  &:hover {
    color: ${({ theme }) => theme.text.primary};
  }
`

// GAP-050: a degraded-mode tab (the wire op for the feature is not
// shipped in this Geode build) must render visibly disabled so the
// user can tell at a glance which Admin sub-pages have real backing.
// styled-span (not Link) so router navigation is impossible; aria-
// disabled + title surface the contract to assistive tech.
const TabDisabled = styled.span`
  padding: 8px 12px;
  color: ${({ theme }) => theme.text.muted};
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: not-allowed;
  opacity: 0.6;
`

// renderTab — Link when supported, disabled span when the capability
// is missing. Until the capabilities probe resolves we render the
// supported variant so the eventual gate doesn't flash an enabled tab
// then disable it; `useCapabilities.loading` is the gate.
function renderTab(args: {
  to: string
  label: string
  active: boolean
  supported: boolean
  loading: boolean
  upcomingLabel: string
}): React.ReactElement {
  const { to, label, active, supported, loading, upcomingLabel } = args
  // While loading we cannot yet judge the capability; default to
  // supported so the eventual gate doesn't flash enabled→disabled.
  if (loading || supported) {
    return (
      <Tab to={to} $active={active}>
        {label}
      </Tab>
    )
  }
  return (
    <TabDisabled
      aria-disabled="true"
      title={upcomingLabel}
      data-testid={`admin-tab-disabled-${to}`}
    >
      {label}
    </TabDisabled>
  )
}

export const AdminPage: React.FC = () => {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  // GAP-050: every Admin sub-page used to render as a clickable tab
  // even when the matching wire op was absent. Operators hit
  // PoliciesPage's `wireFeatureMissing` copy with no in-product hint
  // that this is an upstream-deferred feature — a real security-
  // misconfiguration risk for a surface where ambiguity is least
  // acceptable. The capabilities probe + per-tab gate makes the state
  // visible.
  const { adminWritable, loading: capsLoading } = useCapabilities()
  const upcoming = t('admin.featureUpcoming')
  return (
    <>
      <nav
        className="d-flex flex-wrap mb-3 border-bottom"
        style={{ gap: '12px' }}
      >
        {renderTab({
          to: 'users',
          label: t('nav.adminTabUsers'),
          active: pathname.endsWith('/users'),
          supported: adminWritable.users,
          loading: capsLoading,
          upcomingLabel: upcoming,
        })}
        {renderTab({
          to: 'roles',
          label: t('nav.adminTabRoles'),
          active: pathname.endsWith('/roles'),
          supported: adminWritable.roles,
          loading: capsLoading,
          upcomingLabel: upcoming,
        })}
        {renderTab({
          to: 'policies',
          label: t('nav.adminTabPolicies'),
          active: pathname.endsWith('/policies'),
          supported: adminWritable.policies,
          loading: capsLoading,
          upcomingLabel: upcoming,
        })}
        {renderTab({
          to: 'grants',
          label: t('nav.adminTabGrants'),
          active: pathname.endsWith('/grants'),
          supported: adminWritable.grants,
          loading: capsLoading,
          upcomingLabel: upcoming,
        })}
        <Tab to="backups" $active={pathname.endsWith('/backups')}>
          {t('nav.adminTabBackups')}
        </Tab>
        <Tab to="restore" $active={pathname.endsWith('/restore')}>
          {t('nav.adminTabRestore')}
        </Tab>
        <Tab to="migrations" $active={pathname.endsWith('/migrations')}>
          {t('nav.adminTabMigrations')}
        </Tab>
        <Tab to="audit" $active={pathname.endsWith('/audit')}>
          {t('nav.adminTabAudit')}
        </Tab>
      </nav>
      <Outlet />
    </>
  )
}
