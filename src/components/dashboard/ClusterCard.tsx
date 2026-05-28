import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { Card } from './Card'
import {
  isClusterMode,
  type ClusterRole,
  type ClusterStatusSnapshot,
} from '../../api/cluster'

// ClusterCard — dashboard surface that shows the operator their
// Geode's cluster role, current term, leader, and member count when
// the connected instance is part of a Raft cluster.
//
// Render contract:
//   - snapshot=null + loading=true        → "Loading cluster status…"
//   - snapshot=null + error                → error string (one line)
//   - snapshot=standalone single row       → render NOTHING (return null)
//   - snapshot=cluster                     → show role/term/leader/members
//
// The standalone branch intentionally returns null rather than a
// "Standalone" placeholder card so single-node operators don't see a
// dashboard panel that is always inert. Plan 3 surfaces standalone-ness
// elsewhere (ConnectionCard) where it has more visual breathing room.
//
// Theme-token note: the Theme contract exposes `text.onSuccess` and
// `text.onDanger` but no `text.onWarning`. The candidate role badge
// therefore renders on a warning fill with `text.primary` foreground —
// same pattern GraphBadges.tsx uses for its PinBadge (yellow bg, primary
// text). When the Theme gains a contrast-correct onWarning token both
// call sites should swap.
const RoleBadge = styled.span<{ $role: ClusterRole }>`
  border-radius: ${({ theme }) => theme.radii.sm};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  font-weight: ${({ theme }) => theme.font.weights.medium};
  padding: 1px 8px;
  background: ${({ theme, $role }) => {
    if ($role === 'leader') return theme.colors.success
    if ($role === 'candidate') return theme.colors.warning
    if ($role === 'shutdown') return theme.colors.danger
    return theme.bg.subtle
  }};
  color: ${({ theme, $role }) => {
    if ($role === 'leader') return theme.text.onSuccess
    if ($role === 'candidate') return theme.text.primary
    if ($role === 'shutdown') return theme.text.onDanger
    return theme.text.muted
  }};
`

const StatRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: ${({ theme }) => theme.text.secondary};
  padding: 2px 0;
`

export interface ClusterCardProps {
  snapshot: ClusterStatusSnapshot | null
  loading: boolean
  error: string | null
}

function roleLabel(t: (k: string) => string, role: ClusterRole): string {
  switch (role) {
    case 'leader':
      return t('dashboard.clusterRoleLeader')
    case 'follower':
      return t('dashboard.clusterRoleFollower')
    case 'candidate':
      return t('dashboard.clusterRoleCandidate')
    case 'shutdown':
      return t('dashboard.clusterRoleShutdown')
    default:
      return t('dashboard.clusterRoleUnknown')
  }
}

export const ClusterCard: React.FC<ClusterCardProps> = ({
  snapshot,
  loading,
  error,
}) => {
  const { t } = useTranslation()

  // Standalone backends produce a one-row snapshot with role=standalone.
  // Render nothing so single-node operators have no perpetually-static
  // card on the dashboard.
  if (snapshot && !isClusterMode(snapshot.members)) {
    return null
  }

  const renderBody = (): React.ReactNode => {
    if (loading && !snapshot) {
      return (
        <p className="m-0 text-body-secondary" role="status">
          {t('dashboard.clusterLoading')}
        </p>
      )
    }
    if (error && !snapshot) {
      return (
        <p className="m-0 text-danger" role="alert">
          {t('dashboard.clusterError', { message: error })}
        </p>
      )
    }
    if (!snapshot) return null

    const self = snapshot.members.find((m) => m.nodeId === snapshot.selfNodeId)
    const role: ClusterRole = self?.role ?? 'unknown'
    const term = self?.term ?? 0
    const leaderId = self?.leaderId ?? 0
    const isSelfLeader = leaderId === snapshot.selfNodeId
    const selfSuffix = isSelfLeader ? ` (${t('dashboard.clusterSelf')})` : ''
    const leaderLabel =
      leaderId === 0
        ? t('dashboard.clusterNoLeader')
        : `${t('dashboard.clusterLeader')}: ${leaderId}${selfSuffix}`

    return (
      <div>
        <StatRow>
          <span>{t('dashboard.clusterRole')}</span>
          <RoleBadge $role={role} data-testid="dashboard-cluster-role">
            {roleLabel(t, role)}
          </RoleBadge>
        </StatRow>
        <StatRow>
          <span>{t('dashboard.clusterTerm')}</span>
          <span className="font-monospace">{term}</span>
        </StatRow>
        <StatRow>
          <span>{leaderLabel}</span>
        </StatRow>
        <StatRow>
          <span>{t('dashboard.clusterMembers')}</span>
          <span
            className="font-monospace"
            data-testid="dashboard-cluster-members-count"
          >
            {snapshot.members.length}
          </span>
        </StatRow>
      </div>
    )
  }

  return (
    <Card
      title={t('dashboard.clusterTitle')}
      data-testid="dashboard-cluster-card"
    >
      {renderBody()}
    </Card>
  )
}
