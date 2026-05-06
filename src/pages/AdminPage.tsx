import React from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import styled from 'styled-components'

// AdminPage is a tabbed shell mounted at /admin/* that hosts the
// individual administration sub-pages: Users (D2) plus Roles, Policies,
// and Grants (D3). The active tab is derived from pathname rather than
// React state so that deep-linking and the browser back button both
// work correctly.
const Tabs = styled.nav`
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`

const Tab = styled(Link)<{ $active: boolean }>`
  padding: 8px 12px;
  text-decoration: none;
  color: ${({ $active, theme }) => ($active ? theme.colors.text : theme.colors.textSecondary)};
  border-bottom: 2px solid
    ${({ $active, theme }) => ($active ? theme.colors.primary : 'transparent')};
  margin-bottom: -1px;

  &:hover {
    color: ${({ theme }) => theme.colors.text};
  }
`

export const AdminPage: React.FC = () => {
  const { pathname } = useLocation()
  return (
    <>
      <Tabs>
        <Tab to="users" $active={pathname.endsWith('/users')}>
          Users
        </Tab>
        <Tab to="roles" $active={pathname.endsWith('/roles')}>
          Roles
        </Tab>
        <Tab to="policies" $active={pathname.endsWith('/policies')}>
          Policies
        </Tab>
        <Tab to="grants" $active={pathname.endsWith('/grants')}>
          Grants
        </Tab>
      </Tabs>
      <Outlet />
    </>
  )
}
