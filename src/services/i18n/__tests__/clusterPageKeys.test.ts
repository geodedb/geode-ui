// clusterPageKeys.test.ts
//
// Holds the Plan 2 `cluster.*` namespace + `nav.cluster` alive against
// the `verify:translations --max-warnings-total=0` orphan-key gate
// while Tasks 3-6 of the cluster UI series are still in flight (the
// MembersTable, ClusterPage, and Shell nav link are landed in
// subsequent commits). Every key listed below is referenced via a
// literal `i18n.t('…')` call so the locale-validator regex sees it.
//
// This file doubles as a contract test: each key must resolve to a
// non-key string (i18next falls back to returning the key itself when
// the lookup misses). Once the downstream consumers ship, this file
// stays — it's a cheap regression guard against accidental key
// deletion during locale-file refactors.
//
// Plan 3 extension: the same orphan-key gate covers the three new
// keys added for the topbar chip + ConnectionCard cluster row. The
// chip key (`nav.clusterChipAria`) ships its consumer in Plan 3 Task 2
// alongside this entry; the two `dashboard.connectionCluster*` keys
// are consumed in Plan 3 Task 3, so the literal references below keep
// them alive in the meantime. References remain after Task 3 lands —
// cheap contract test, same rationale as the Plan 2 batch above.
import { i18n } from '..'

describe('plan-2 cluster page keys exist in en', () => {
  test('cluster.* + nav.cluster all resolve', () => {
    expect(i18n.t('cluster.title')).not.toBe('cluster.title')
    expect(i18n.t('cluster.subtitle')).not.toBe('cluster.subtitle')
    expect(i18n.t('cluster.refresh')).not.toBe('cluster.refresh')
    expect(i18n.t('cluster.refreshAria')).not.toBe('cluster.refreshAria')
    expect(i18n.t('cluster.refreshing')).not.toBe('cluster.refreshing')
    expect(i18n.t('cluster.lastUpdated')).not.toBe('cluster.lastUpdated')
    expect(i18n.t('cluster.standaloneTitle')).not.toBe(
      'cluster.standaloneTitle'
    )
    expect(i18n.t('cluster.standaloneBody')).not.toBe('cluster.standaloneBody')
    expect(i18n.t('cluster.errorTitle')).not.toBe('cluster.errorTitle')
    expect(i18n.t('cluster.loading')).not.toBe('cluster.loading')
    expect(i18n.t('cluster.membersHeading')).not.toBe('cluster.membersHeading')
    expect(i18n.t('cluster.selfBadge')).not.toBe('cluster.selfBadge')
    expect(i18n.t('cluster.leaderBadge')).not.toBe('cluster.leaderBadge')
    expect(i18n.t('cluster.followerBadge')).not.toBe('cluster.followerBadge')
    expect(i18n.t('cluster.candidateBadge')).not.toBe('cluster.candidateBadge')
    expect(i18n.t('cluster.shutdownBadge')).not.toBe('cluster.shutdownBadge')
    expect(i18n.t('cluster.unknownBadge')).not.toBe('cluster.unknownBadge')
    expect(i18n.t('cluster.freshnessFresh')).not.toBe('cluster.freshnessFresh')
    expect(i18n.t('cluster.freshnessStale')).not.toBe('cluster.freshnessStale')
    expect(i18n.t('cluster.freshnessLost')).not.toBe('cluster.freshnessLost')
    expect(i18n.t('cluster.columnNodeId')).not.toBe('cluster.columnNodeId')
    expect(i18n.t('cluster.columnRole')).not.toBe('cluster.columnRole')
    expect(i18n.t('cluster.columnTerm')).not.toBe('cluster.columnTerm')
    expect(i18n.t('cluster.columnLeader')).not.toBe('cluster.columnLeader')
    expect(i18n.t('cluster.columnEndpoint')).not.toBe('cluster.columnEndpoint')
    expect(i18n.t('cluster.columnLastContact')).not.toBe(
      'cluster.columnLastContact'
    )
    expect(i18n.t('nav.cluster')).not.toBe('nav.cluster')
  })
})

describe('plan-3 cluster topbar + connection card keys exist in en', () => {
  test('nav.clusterChipAria + dashboard.connectionCluster* all resolve', () => {
    expect(i18n.t('nav.clusterChipAria')).not.toBe('nav.clusterChipAria')
    expect(i18n.t('dashboard.connectionClusterRow')).not.toBe(
      'dashboard.connectionClusterRow'
    )
    expect(i18n.t('dashboard.connectionClusterNodesFmt')).not.toBe(
      'dashboard.connectionClusterNodesFmt'
    )
  })
})
