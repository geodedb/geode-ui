// DashboardPage — mounted at /dashboard. The "overview" home view: a
// responsive grid of small cards summarising the connected server (graph
// list, recent queries, connection/capabilities, default-graph stats).
// Each card is a presentational component from src/components/dashboard/;
// the data is supplied by useOverviewData() and useQueryHistory().

import React from 'react'
import { useTranslation } from 'react-i18next'

import { useOverviewData } from '../lib/useOverviewData'
import { entriesFor, useQueryHistory } from '../lib/useQueryHistory'
import { useMetricsPolling } from '../lib/useMetricsPolling'
import { useActiveConnection } from '../api/connections'
import { GraphsCard } from '../components/dashboard/GraphsCard'
import { RecentQueriesCard } from '../components/dashboard/RecentQueriesCard'
import { ConnectionCard } from '../components/dashboard/ConnectionCard'
import { GraphStatsCard } from '../components/dashboard/GraphStatsCard'
import {
  ConnectionsCard,
  QueryThroughputCard,
  ServerHealthCard,
  StorageCard,
  metricsHidden,
} from '../components/dashboard/MetricsCards'
import { MetricsUpstreamAdvisory } from '../components/dashboard/MetricsUpstreamAdvisory'
import { AuditEventMixCard } from '../components/dashboard/AuditEventMixCard'

// Grid — Bootstrap-migrated to a plain <div>. The auto-fill grid track
// expression has no Bootstrap utility equivalent so it stays inline,
// but the gap and margin-top come from the `gap-3 mt-3` classes (each
// = 1rem = 16 px, matching the previous theme.spacing.md token).
// docs/BOOTSTRAP_MIGRATION.md.
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
}

export const DashboardPage: React.FC = () => {
  const { t } = useTranslation()
  const ov = useOverviewData()
  // 2026-05-22 bug-fix: scope the Session-query-history card to the
  // active profile. Pre-fix the store was a single global array so
  // switching profiles in the ConnectionSwitcher leaked the prior
  // profile's recent queries into the new profile's dashboard view.
  const activeConn = useActiveConnection()
  const profileName = activeConn?.profileName ?? ''
  const entries = useQueryHistory((s) => entriesFor(s, profileName))
  const clearForProfile = useQueryHistory((s) => s.clear)
  const clear = (): void => clearForProfile(profileName)
  // Geode-metrics polling. The hook returns state='disabled' the first
  // time the proxy reports METRICS_DISABLED (the operator hasn't set
  // GEODE_METRICS_URL on the geode-ui server); in that case metricsHidden
  // is true and the metrics cards drop out of the grid entirely.
  const metrics = useMetricsPolling()
  const showMetrics = !metricsHidden(metrics)
  return (
    <div>
      <h1>{t('dashboard.title')}</h1>
      {/* Bug 3 (2026-05-21 bug-fix bundle): rendered above the grid so
          the operator sees the upstream-instrumentation note before
          drawing conclusions about a quiet-looking dashboard. */}
      <MetricsUpstreamAdvisory polling={metrics} />
      <div className="gap-3 mt-3" style={gridStyle}>
        {/* Bug 4 (2026-05-21 bug-fix bundle): the multi-graph stats
            card now lives next to GraphsCard so the operator gets the
            list and its node/edge counts in the same neighbourhood.
            Auto-loads on mount, filterable, refreshable per-row. */}
        <GraphsCard
          graphs={ov.graphs}
          loading={ov.loading}
          error={ov.graphsError}
        />
        <GraphStatsCard
          graphs={ov.graphs}
          stats={ov.allGraphStats}
          onRefreshAll={ov.loadAllStats}
          onRefreshOne={ov.reloadStats}
        />
        <RecentQueriesCard entries={entries} onClear={clear} />
        <ConnectionCard
          geodeVersion={ov.geodeVersion}
          adminWritable={ov.adminWritable}
          loading={ov.loading}
          error={ov.capsError}
        />
        {showMetrics && (
          <>
            <QueryThroughputCard polling={metrics} />
            <ConnectionsCard polling={metrics} />
            <StorageCard polling={metrics} />
            <ServerHealthCard polling={metrics} />
          </>
        )}
        {/* AuditEventMix is independent of the metrics-proxy gate —
            the donut is computed client-side from /api/v1/audit which
            exists regardless of whether the geode metrics listener is
            wired. Render unconditionally so operators always have a
            sense of activity mix, even when GEODE_METRICS_URL is
            empty. */}
        <AuditEventMixCard />
      </div>
    </div>
  )
}
