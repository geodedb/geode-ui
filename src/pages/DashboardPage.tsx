// DashboardPage — mounted at /dashboard. The "overview" home view: a
// responsive grid of small cards summarising the connected server (graph
// list, recent queries, connection/capabilities, default-graph stats).
// Each card is a presentational component from src/components/dashboard/;
// the data is supplied by useOverviewData() and useQueryHistory().

import React from 'react'
import { useTranslation } from 'react-i18next'

import { useOverviewData } from '../lib/useOverviewData'
import { useQueryHistory } from '../lib/useQueryHistory'
import { useMetricsPolling } from '../lib/useMetricsPolling'
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

// The graph whose stats the GraphStatsCard offers to load. Geode
// auto-provisions an empty graph literally named "default" on first
// boot — the previous heuristic preferred that name, so any operator
// whose real data lived in another graph saw "default stats — Nodes 0
// / Edges 0" no matter what. Prefer the FIRST non-"default" graph in
// the server's list order; only fall back to "default" when it is the
// only graph the operator has. Returns null when the list is empty.
function pickDefaultGraph(graphs: string[] | null): string | null {
  if (!graphs || graphs.length === 0) return null
  const realGraph = graphs.find((g) => g !== 'default')
  return realGraph ?? graphs[0] ?? null
}

export const DashboardPage: React.FC = () => {
  const { t } = useTranslation()
  const ov = useOverviewData()
  const entries = useQueryHistory((s) => s.entries)
  const clear = useQueryHistory((s) => s.clear)
  const defaultGraph = pickDefaultGraph(ov.graphs)
  // Geode-metrics polling. The hook returns state='disabled' the first
  // time the proxy reports METRICS_DISABLED (the operator hasn't set
  // GEODE_METRICS_URL on the geode-ui server); in that case metricsHidden
  // is true and the metrics cards drop out of the grid entirely.
  const metrics = useMetricsPolling()
  const showMetrics = !metricsHidden(metrics)
  return (
    <div>
      <h1>{t('dashboard.title')}</h1>
      <div className="gap-3 mt-3" style={gridStyle}>
        <GraphsCard
          graphs={ov.graphs}
          loading={ov.loading}
          error={ov.graphsError}
        />
        <RecentQueriesCard entries={entries} onClear={clear} />
        <ConnectionCard
          geodeVersion={ov.geodeVersion}
          adminWritable={ov.adminWritable}
          loading={ov.loading}
          error={ov.capsError}
        />
        <GraphStatsCard
          defaultGraph={defaultGraph}
          stats={ov.defaultGraphStats}
          loading={ov.statsLoading}
          error={ov.statsError}
          onLoad={() => {
            if (defaultGraph) ov.loadStats(defaultGraph)
          }}
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
