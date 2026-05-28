import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { Card } from './Card'
import type { AdminWritable } from '../../api/capabilities'
import { isClusterMode, type ClusterStatusSnapshot } from '../../api/cluster'

// ConnectionCard — the overview card showing which Geode build the SPA
// is talking to (`geode_version`) and whether each admin DDL family is
// writable over the GQL wire (`admin_writable.{users,roles,policies,
// grants}`). Against every released build today all four are `false`;
// when the server-side wire-RBAC work lands the badges flip to enabled
// with no SPA change.
//
// Bootstrap-migrated (docs/BOOTSTRAP_MIGRATION.md):
//   - Version, Status, ErrorText: all single-block text styles with
//     theme tokens that resolve through the `--bs-*` bridge. Replaced
//     with `<p className=...>` using `text-body / text-body-secondary /
//     text-danger / font-monospace / m-0` etc.
//   - Caps: outer flex-column list is Bootstrap (`list-unstyled m-0 p-0
//     d-flex flex-column`); the 2 px gap and 13 px font-size have no
//     exact utility so they stay as inline style.
//   - Badge: KEPT as styled-component. Dynamic theme-token branching on
//     the $on prop (theme.colors.success vs theme.bg.subtle for bg, and
//     theme.text.onSuccess vs theme.text.muted for fg) doesn't map to
//     a single Bootstrap utility class because `text-on-success` /
//     `text-muted-on-subtle` aren't part of the framework — the bridge
//     would have to add per-on-success tokens to `--bs-*` and we don't
//     have those yet.
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

export interface ConnectionCardProps {
  geodeVersion: string | null
  adminWritable: AdminWritable | null
  loading: boolean
  error: string | null
  // Plan 3: when the connected Geode is part of a Raft cluster, the
  // dashboard's DashboardPage threads the snapshot down here so the
  // card can render a single-line "Cluster: N nodes — Role" row at
  // the bottom. Undefined / standalone snapshots leave the row
  // entirely hidden so single-node operators don't see an inert row.
  clusterSnapshot?: ClusterStatusSnapshot | null
}

// ClusterRow — hoisted local component (the alternative in-line IIFE
// trips `react/no-unstable-nested-components`). Renders the single
// "Cluster | N nodes — Role" row at the bottom of the connection
// card. Caller is responsible for the isClusterMode short-circuit;
// this component assumes the snapshot is a real cluster snapshot.
const ROLE_I18N_KEYS = {
  leader: 'dashboard.clusterRoleLeader',
  follower: 'dashboard.clusterRoleFollower',
  candidate: 'dashboard.clusterRoleCandidate',
  shutdown: 'dashboard.clusterRoleShutdown',
} as const

const ClusterRow: React.FC<{ snapshot: ClusterStatusSnapshot }> = ({
  snapshot,
}) => {
  const { t } = useTranslation()
  const self = snapshot.members.find((m) => m.nodeId === snapshot.selfNodeId)
  const role = self?.role ?? 'unknown'
  const roleKey =
    (ROLE_I18N_KEYS as Record<string, string>)[role] ??
    'dashboard.clusterRoleUnknown'
  return (
    <li
      data-testid="connection-card-cluster-row"
      className="d-flex align-items-center justify-content-between text-body-secondary"
      style={{ fontSize: '13px' }}
    >
      <span>{t('dashboard.connectionClusterRow')}</span>
      <span>
        {t('dashboard.connectionClusterNodesFmt', {
          count: snapshot.members.length,
        })}{' '}
        — {t(roleKey)}
      </span>
    </li>
  )
}

export const ConnectionCard: React.FC<ConnectionCardProps> = ({
  geodeVersion,
  adminWritable,
  loading,
  error,
  clusterSnapshot,
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
      return (
        <p className="m-0 text-body-secondary" role="status">
          {t('dashboard.loading')}
        </p>
      )
    }
    if (error) {
      return (
        <p className="m-0 text-danger" role="alert">
          {error}
        </p>
      )
    }
    return (
      <>
        <p className="text-body font-monospace m-0 mb-2">
          {t('dashboard.version', { version: geodeVersion ?? '—' })}
        </p>
        <ul
          className="list-unstyled m-0 p-0 d-flex flex-column"
          style={{ gap: '2px' }}
        >
          {caps.map(([key, label]) => {
            const on = !!adminWritable?.[key]
            return (
              <li
                key={key}
                className="d-flex align-items-center justify-content-between text-body-secondary"
                style={{ fontSize: '13px' }}
              >
                <span>{label}</span>
                <Badge $on={on}>
                  {on ? t('dashboard.capYes') : t('dashboard.capNo')}
                </Badge>
              </li>
            )
          })}
          {clusterSnapshot && isClusterMode(clusterSnapshot.members) ? (
            <ClusterRow snapshot={clusterSnapshot} />
          ) : null}
        </ul>
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
