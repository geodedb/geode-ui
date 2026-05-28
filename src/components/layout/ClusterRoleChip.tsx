import React from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import {
  isClusterMode,
  type ClusterRole,
  type ClusterStatusSnapshot,
} from '../../api/cluster'

// ClusterRoleChip — ambient cluster role indicator that lives in the
// Top nav. Returns null in standalone mode so the chip never shows up
// on single-node Geode instances; in cluster mode it renders a small
// linked badge that takes the operator to /cluster on click.
//
// Self-node role is derived from `snapshot.members.find(m =>
// m.nodeId === snapshot.selfNodeId)?.role`. If selfNodeId is missing
// from the member list (race between membership change and our
// snapshot), the chip falls through to 'unknown' rather than hiding
// — leaving the chip visible signals "we know this is a cluster, we
// just don't know our own role yet."
//
// Theme-token note: mirrors ClusterCard's RoleBadge palette so the
// dashboard role badge and the topbar chip stay visually consistent.
// `theme.text.onWarning` doesn't exist (see ClusterCard for the same
// caveat) so the candidate variant uses `text.primary` on a warning
// fill.
const ChipLink = styled(Link)<{ $role: ClusterRole }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
  padding: 2px 10px;
  font-size: ${({ theme }) => theme.font.sizes.xs};
  font-weight: ${({ theme }) => theme.font.weights.medium};
  border-radius: ${({ theme }) => theme.radii.sm};
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
    return theme.text.primary
  }};

  &:hover {
    filter: brightness(1.05);
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.border.focus};
    outline-offset: 2px;
  }
`

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

export interface ClusterRoleChipProps {
  snapshot: ClusterStatusSnapshot | null
}

export const ClusterRoleChip: React.FC<ClusterRoleChipProps> = ({
  snapshot,
}) => {
  const { t } = useTranslation()
  if (!snapshot) return null
  if (!isClusterMode(snapshot.members)) return null
  const self = snapshot.members.find((m) => m.nodeId === snapshot.selfNodeId)
  const role: ClusterRole = self?.role ?? 'unknown'
  const label = roleLabel(t, role)
  return (
    <ChipLink
      to="/cluster"
      $role={role}
      data-testid="cluster-role-chip"
      aria-label={t('nav.clusterChipAria', { role: label })}
    >
      {label}
    </ChipLink>
  )
}
