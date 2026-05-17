import React from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation } from 'react-router-dom'
import styled, { DefaultTheme } from 'styled-components'

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

const Tabs = styled.nav`
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid ${({ theme }) => theme.border.default};
  flex-wrap: wrap;
`

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

export const AdminPage: React.FC = () => {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  return (
    <>
      <Tabs>
        <Tab to="users" $active={pathname.endsWith('/users')}>
          {t('nav.adminTabUsers')}
        </Tab>
        <Tab to="roles" $active={pathname.endsWith('/roles')}>
          {t('nav.adminTabRoles')}
        </Tab>
        <Tab to="policies" $active={pathname.endsWith('/policies')}>
          {t('nav.adminTabPolicies')}
        </Tab>
        <Tab to="grants" $active={pathname.endsWith('/grants')}>
          {t('nav.adminTabGrants')}
        </Tab>
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
      </Tabs>
      <Outlet />
    </>
  )
}
