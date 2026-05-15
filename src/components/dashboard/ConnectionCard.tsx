import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { Card } from './Card'
import type { AdminWritable } from '../../api/capabilities'

// ConnectionCard — the overview card showing which Geode build the SPA
// is talking to (`geode_version`) and whether each admin DDL family is
// writable over the GQL wire (`admin_writable.{users,roles,policies,
// grants}`). Against every released build today all four are `false`;
// when the server-side wire-RBAC work lands the badges flip to enabled
// with no SPA change.
const Version = styled.p`
  color: ${({ theme }) => theme.text.primary};
  font-family: ${({ theme }) => theme.font.family.mono};
  margin: 0 0 ${({ theme }) => theme.spacing.sm};
`

const Caps = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xxs};

  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: ${({ theme }) => theme.text.secondary};
    font-size: ${({ theme }) => theme.font.sizes.sm};
  }
`

const Badge = styled.span<{ $on: boolean }>`
  border-radius: ${({ theme }) => theme.radii.sm};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  font-weight: ${({ theme }) => theme.font.weights.medium};
  padding: 1px 8px;
  background: ${({ theme, $on }) => {
    return $on ? theme.colors.success : theme.bg.subtle
  }};
  color: ${({ theme, $on }) => {
    // text.onSuccess is white in both themes — distinct from onPrimary,
    // which is a dark canvas color in dark theme and only clears 3.1:1
    // against the (already darker) success green. Caught by
    // 27-contrast.spec.ts.
    return $on ? theme.text.onSuccess : theme.text.muted
  }};
`

const Status = styled.p`
  color: ${({ theme }) => theme.text.secondary};
  margin: 0;
`

const ErrorText = styled.p`
  color: ${({ theme }) => theme.text.danger};
  margin: 0;
`

export interface ConnectionCardProps {
  geodeVersion: string | null
  adminWritable: AdminWritable | null
  loading: boolean
  error: string | null
}

export const ConnectionCard: React.FC<ConnectionCardProps> = ({
  geodeVersion,
  adminWritable,
  loading,
  error,
}) => {
  const { t } = useTranslation()

  // Explicit (key, label) pairs so every t(...) call is a literal —
  // detect:hardcoded-strings flags dynamic key construction.
  const caps: Array<[keyof AdminWritable, string]> = [
    ['users', t('dashboard.capUsers')],
    ['roles', t('dashboard.capRoles')],
    ['policies', t('dashboard.capPolicies')],
    ['grants', t('dashboard.capGrants')],
  ]

  const renderBody = (): React.ReactNode => {
    if (loading) {
      return <Status role="status">{t('dashboard.loading')}</Status>
    }
    if (error) {
      return <ErrorText role="alert">{error}</ErrorText>
    }
    return (
      <>
        <Version>
          {t('dashboard.version', { version: geodeVersion ?? '—' })}
        </Version>
        <Caps>
          {caps.map(([key, label]) => {
            const on = !!adminWritable?.[key]
            return (
              <li key={key}>
                <span>{label}</span>
                <Badge $on={on}>
                  {on ? t('dashboard.capYes') : t('dashboard.capNo')}
                </Badge>
              </li>
            )
          })}
        </Caps>
      </>
    )
  }

  return (
    <Card
      title={t('dashboard.connectionTitle')}
      data-testid="dashboard-connection-card"
    >
      {renderBody()}
    </Card>
  )
}
