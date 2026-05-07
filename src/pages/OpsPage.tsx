import React from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import styled from 'styled-components'

// OpsPage is a tabbed shell mounted at /ops/* that hosts the operational
// sub-pages: Backups (D4), Restore (D4), Migrations (D4), and Audit log
// (D5). Like AdminPage, the active tab is derived from pathname rather
// than React state so deep-linking and the back button both work.
const Tabs = styled.nav`
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`

function tabColor(props: {
  $active: boolean
  theme: { colors: { text: string; textSecondary: string } }
}): string {
  return props.$active
    ? props.theme.colors.text
    : props.theme.colors.textSecondary
}

const Tab = styled(Link)<{ $active: boolean }>`
  padding: 8px 12px;
  text-decoration: none;
  color: ${tabColor};
  border-bottom: 2px solid
    ${({ $active, theme }) => ($active ? theme.colors.primary : 'transparent')};
  margin-bottom: -1px;

  &:hover {
    color: ${({ theme }) => theme.colors.text};
  }
`

export const OpsPage: React.FC = () => {
  const { pathname } = useLocation()
  return (
    <>
      <Tabs>
        <Tab to="backups" $active={pathname.endsWith('/backups')}>
          Backups
        </Tab>
        <Tab to="restore" $active={pathname.endsWith('/restore')}>
          Restore
        </Tab>
        <Tab to="migrations" $active={pathname.endsWith('/migrations')}>
          Migrations
        </Tab>
        <Tab to="audit" $active={pathname.endsWith('/audit')}>
          Audit
        </Tab>
      </Tabs>
      <Outlet />
    </>
  )
}
