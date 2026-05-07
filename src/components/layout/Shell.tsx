import React from 'react'
import { Link, Outlet } from 'react-router-dom'
import styled from 'styled-components'
import { useAuth } from '../../auth/AuthProvider'
import { ConnectionPicker } from './ConnectionPicker'

const Top = styled.nav`
  display: flex;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  align-items: center;
`

const Brand = styled.span`
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`

const Body = styled.div`
  padding: 20px;
`

const NavLink = styled(Link)`
  color: ${({ theme }) => theme.colors.textSecondary};
  text-decoration: none;
  &:hover {
    color: ${({ theme }) => theme.colors.text};
  }
`

const LogoutBtn = styled.button`
  margin-left: auto;
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.text};
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
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
      <Top>
        <Brand>Geode</Brand>
        <ConnectionPicker />
        <NavLink to="/">Query</NavLink>
        <NavLink to="/schema">Schema</NavLink>
        <NavLink to="/admin">Admin</NavLink>
        <NavLink to="/ops">Ops</NavLink>
        <LogoutBtn onClick={onLogout}>Logout</LogoutBtn>
      </Top>
      <Body>
        <Outlet />
      </Body>
    </>
  )
}
