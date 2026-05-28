import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { ClusterMember, ClusterRole } from '../../api/cluster'
import {
  formatLastContact,
  lastContactFreshness,
  type Freshness,
} from './formatLastContact'

// MembersTable — pure presentational table of cluster members.
//
// Rendering contract:
//   - 6 column headers (semantic role="columnheader").
//   - One <tr data-testid="cluster-member-row"> per ClusterMember.
//   - Each row carries machine-readable attributes for tests / styling:
//       data-self      ("true" if nodeId === selfNodeId, else "false")
//       data-leader    ("true" if role === 'leader', else "false")
//       data-freshness (Freshness string from lastContactFreshness())
//   - Leader rows get a subtle accent border-left so the operator can
//     spot the leader without scanning the Role column.
//   - The "this node" badge is rendered inside the Node cell of the
//     self row only.
const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  thead th {
    text-align: left;
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    border-bottom: 1px solid ${({ theme }) => theme.border.subtle};
    padding: 6px 12px;
    color: ${({ theme }) => theme.text.secondary};
  }
  tbody td {
    padding: 6px 12px;
    border-bottom: 1px solid ${({ theme }) => theme.border.subtle};
    color: ${({ theme }) => theme.text.primary};
    font-family: ${({ theme }) => theme.font.family.mono};
  }
  tbody tr[data-leader='true'] td:first-child {
    border-left: 3px solid ${({ theme }) => theme.colors.success};
  }
  tbody tr[data-freshness='lost'] td {
    color: ${({ theme }) => theme.text.muted};
  }
`

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

const FreshnessBadge = styled.span<{ $f: Freshness }>`
  border-radius: ${({ theme }) => theme.radii.sm};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  padding: 0 6px;
  margin-left: 6px;
  background: ${({ theme, $f }) => {
    if ($f === 'lost') return theme.colors.danger
    if ($f === 'stale') return theme.colors.warning
    return theme.bg.subtle
  }};
  color: ${({ theme, $f }) => {
    if ($f === 'lost') return theme.text.onDanger
    if ($f === 'stale') return theme.text.primary
    return theme.text.muted
  }};
`

const SelfBadge = styled.span`
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  font-size: ${({ theme }) => theme.font.sizes.xs};
  background: ${({ theme }) => theme.colors.info ?? theme.bg.subtle};
  color: ${({ theme }) => theme.text.primary};
  border-radius: ${({ theme }) => theme.radii.sm};
`

function roleBadgeLabel(t: (k: string) => string, role: ClusterRole): string {
  switch (role) {
    case 'leader':
      return t('cluster.leaderBadge')
    case 'follower':
      return t('cluster.followerBadge')
    case 'candidate':
      return t('cluster.candidateBadge')
    case 'shutdown':
      return t('cluster.shutdownBadge')
    case 'standalone':
      return t('cluster.unknownBadge')
    default:
      return t('cluster.unknownBadge')
  }
}

function freshnessLabel(t: (k: string) => string, f: Freshness): string | null {
  if (f === 'self') return null
  if (f === 'fresh') return t('cluster.freshnessFresh')
  if (f === 'stale') return t('cluster.freshnessStale')
  return t('cluster.freshnessLost')
}

export interface MembersTableProps {
  members: ClusterMember[]
  selfNodeId: number | null
}

export const MembersTable: React.FC<MembersTableProps> = ({
  members,
  selfNodeId,
}) => {
  const { t } = useTranslation()
  return (
    <Table data-testid="cluster-members-table">
      <thead>
        <tr>
          <th scope="col">{t('cluster.columnNodeId')}</th>
          <th scope="col">{t('cluster.columnRole')}</th>
          <th scope="col">{t('cluster.columnTerm')}</th>
          <th scope="col">{t('cluster.columnLeader')}</th>
          <th scope="col">{t('cluster.columnEndpoint')}</th>
          <th scope="col">{t('cluster.columnLastContact')}</th>
        </tr>
      </thead>
      <tbody>
        {members.map((m) => {
          const isSelf = m.nodeId === selfNodeId
          const isLeader = m.role === 'leader'
          const freshness = lastContactFreshness(m.lastContactMs)
          const freshLabel = freshnessLabel(t, freshness)
          return (
            <tr
              key={m.nodeId}
              data-testid="cluster-member-row"
              data-self={isSelf ? 'true' : 'false'}
              data-leader={isLeader ? 'true' : 'false'}
              data-freshness={freshness}
            >
              <td>
                {m.nodeId}
                {isSelf ? (
                  <SelfBadge>{t('cluster.selfBadge')}</SelfBadge>
                ) : null}
              </td>
              <td>
                <RoleBadge $role={m.role}>
                  {roleBadgeLabel(t, m.role)}
                </RoleBadge>
              </td>
              <td>{m.term}</td>
              <td>{m.leaderId === 0 ? '—' : m.leaderId}</td>
              <td>{m.endpoint}</td>
              <td>
                {formatLastContact(m.lastContactMs)}
                {freshLabel ? (
                  <FreshnessBadge $f={freshness}>{freshLabel}</FreshnessBadge>
                ) : null}
              </td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
