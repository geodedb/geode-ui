import React from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation } from 'react-router-dom'
import styled from 'styled-components'

// AdminPage is a tabbed shell mounted at /admin/* that hosts the
// administration sub-pages: Users, Roles, Policies, Grants
// (D2/D3) plus the operational sub-pages relocated from /ops:
// Backups, Restore, Migrations, Audit (D4/D5). The active tab is
// derived from pathname rather than React state so deep-linking and
// the browser back button both work correctly.
function adminTabColor(props: {
  $active: boolean
  theme: { colors: { text: string; textSecondary: string } }
}): string {
  return props.$active
    ? props.theme.colors.text
    : props.theme.colors.textSecondary
}

const Tabs = styled.nav`
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
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
    color: ${({ theme }) => theme.colors.text};
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
