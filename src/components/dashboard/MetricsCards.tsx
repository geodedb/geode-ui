// src/components/dashboard/MetricsCards.tsx
//
// Four geode-metrics cards plus a small numeric-chip primitive. Cards
// share the existing `Card` shell from this folder so the dashboard
// grid stays visually homogeneous with the existing
// Graphs/RecentQueries/Connection/GraphStats cards.
//
// Co-located in one file because each card is small and they share
// formatting helpers; if a card grows non-trivial state or its own
// tests they can split out cleanly.

import React from 'react'
import { useTranslation } from 'react-i18next'

import { Card } from './Card'
import { Sparkline } from './Sparkline'
import type { UseMetricsPollingResult } from '../../lib/useMetricsPolling'

// formatBytes converts a byte count into a humanised string with one
// fractional digit (1.5 GB, 23.0 MB). Picks the largest unit whose
// quotient is >= 1; falls back to "0 B" for the empty case so the card
// never renders an empty cell.
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatInt(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString()
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const s = Math.floor(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

// (derivativeFromHistory was extracted but unused; the QueryThroughput
// card walks history inline because it needs a full series for the
// sparkline, not just the latest derivative. Kept commented as a hook
// for a future LatencyCard that wants `pick=duration_seconds_sum`.)

// histogramPercentile estimates a percentile (e.g. 0.95) from a
// cumulative-bucketed histogram via standard linear interpolation
// between bucket boundaries. Returns null when the histogram is empty
// or the percentile falls in the +Inf-bucket overflow region.
//
// Reference: Prometheus's own histogram_quantile() function uses the
// same interpolation; results are exact at bucket boundaries and
// approximate within a bucket.
export function histogramPercentile(
  buckets: ReadonlyArray<{ upper_bound: number; count: number }>,
  totalCount: number,
  percentile: number
): number | null {
  if (totalCount <= 0 || buckets.length === 0) return null
  const target = totalCount * percentile
  let prevBound = 0
  let prevCount = 0
  // .reduce so the no-restricted-syntax rule (no for…of) is satisfied;
  // semantics are identical to a manual walk over the cumulative
  // buckets — we just early-return via a sentinel object.
  const found = buckets.reduce<{ result: number | null; done: boolean }>(
    (acc, b) => {
      if (acc.done) return acc
      if (b.count >= target) {
        if (b.upper_bound >= 1e308) return { result: prevBound, done: true }
        const span = b.count - prevCount
        if (span <= 0) return { result: b.upper_bound, done: true }
        const frac = (target - prevCount) / span
        return {
          result: prevBound + (b.upper_bound - prevBound) * frac,
          done: true,
        }
      }
      prevBound = b.upper_bound
      prevCount = b.count
      return acc
    },
    { result: null, done: false }
  )
  return found.result
}

// Chip renders a numeric value with a small caption underneath. Used
// across every card so the dashboard reads consistently.
const Chip: React.FC<{ value: React.ReactNode; caption: string }> = ({
  value,
  caption,
}) => (
  <div>
    <div className="font-monospace fs-4 lh-1 text-body">{value}</div>
    <div className="small text-body-secondary">{caption}</div>
  </div>
)

// metricsHidden is true when the upstream server has reported the
// metrics endpoint disabled. The dashboard render gate uses this to
// hide every metrics card with one branch.
export function metricsHidden(state: UseMetricsPollingResult): boolean {
  return state.state === 'disabled'
}

export interface MetricsCardProps {
  polling: UseMetricsPollingResult
}

// ─── QueryThroughputCard ──────────────────────────────────────────
//
// Total / failed counters as numeric chips, plus a sparkline of QPS
// derived from the last N history samples. p95 latency is computed
// from the histogram buckets via linear interpolation.

function computeP95(latest: UseMetricsPollingResult['latest']): number | null {
  if (!latest) return null
  return histogramPercentile(
    latest.queries.duration_seconds_buckets,
    latest.queries.duration_seconds_count,
    0.95
  )
}

export const QueryThroughputCard: React.FC<MetricsCardProps> = ({
  polling,
}) => {
  const { t } = useTranslation()
  const { latest, history } = polling
  // Per-sample QPS series for the sparkline: dQueries/dt between every
  // adjacent pair of samples. Build via .map+.filter so the lint rule
  // against bare for-loops stays satisfied; semantics are identical.
  const qpsSeries = history
    .slice(1)
    .map((curr, i): number | null => {
      const prev = history[i]!
      const dt = (curr.ts - prev.ts) / 1000
      if (dt <= 0) return null
      const dv = curr.snapshot.queries.total - prev.snapshot.queries.total
      return dv < 0 ? 0 : dv / dt
    })
    .filter((v): v is number => v !== null)
  const p95 = computeP95(latest)
  const totalNode = (
    <span data-testid="metrics-queries-total">
      {latest ? formatInt(latest.queries.total) : '—'}
    </span>
  )
  return (
    <Card
      title={t('dashboard.metricsThroughputTitle')}
      data-testid="dashboard-metrics-throughput"
    >
      <div className="d-flex gap-4 mb-2">
        <Chip
          value={totalNode}
          caption={t('dashboard.metricsThroughputTotal')}
        />
        <Chip
          value={latest ? formatInt(latest.queries.failed) : '—'}
          caption={t('dashboard.metricsThroughputFailed')}
        />
        <Chip
          value={p95 == null ? '—' : `${(p95 * 1000).toFixed(0)} ms`}
          caption={t('dashboard.metricsThroughputP95')}
        />
      </div>
      <Sparkline
        values={qpsSeries}
        ariaLabel={t('dashboard.metricsSparklineQpsAria')}
        data-testid="metrics-throughput-sparkline"
      />
      <div className="small text-body-secondary mt-1">
        {t('dashboard.metricsThroughputQpsCaption', {
          count: Math.max(0, qpsSeries.length),
        })}
      </div>
    </Card>
  )
}

// ─── ConnectionsCard ──────────────────────────────────────────────
//
// Active connection gauge + a sparkline of recent active values.

export const ConnectionsCard: React.FC<MetricsCardProps> = ({ polling }) => {
  const { t } = useTranslation()
  const { latest, history } = polling
  const activeSeries = history.map((s) => s.snapshot.connections.active)
  return (
    <Card
      title={t('dashboard.metricsConnectionsTitle')}
      data-testid="dashboard-metrics-connections"
    >
      <div className="d-flex gap-4 mb-2">
        <Chip
          value={latest ? formatInt(latest.connections.active) : '—'}
          caption={t('dashboard.metricsConnectionsActive')}
        />
        <Chip
          value={latest ? formatInt(latest.connections.total) : '—'}
          caption={t('dashboard.metricsConnectionsTotal')}
        />
      </div>
      <Sparkline
        values={activeSeries}
        ariaLabel={t('dashboard.metricsSparklineActiveAria')}
        data-testid="metrics-connections-sparkline"
      />
    </Card>
  )
}

// ─── StorageCard ──────────────────────────────────────────────────
//
// Nodes, edges, memory. Numeric only — these are gauges with no
// per-second derivative that makes operational sense.

export const StorageCard: React.FC<MetricsCardProps> = ({ polling }) => {
  const { t } = useTranslation()
  const { latest } = polling
  return (
    <Card
      title={t('dashboard.metricsStorageTitle')}
      data-testid="dashboard-metrics-storage"
    >
      <div className="d-flex gap-4">
        <Chip
          value={latest ? formatInt(latest.storage.nodes_total) : '—'}
          caption={t('dashboard.metricsStorageNodes')}
        />
        <Chip
          value={latest ? formatInt(latest.storage.edges_total) : '—'}
          caption={t('dashboard.metricsStorageEdges')}
        />
        <Chip
          value={
            latest && latest.storage.memory_bytes > 0
              ? formatBytes(latest.storage.memory_bytes)
              : '—'
          }
          caption={t('dashboard.metricsStorageMemory')}
        />
      </div>
    </Card>
  )
}

// ─── ServerHealthCard ─────────────────────────────────────────────
//
// Uptime + health pill + transactions counter. Smaller card; doesn't
// need its own row of sparklines.

function pickHealthLabel(
  state: UseMetricsPollingResult['state'],
  healthy: boolean,
  t: (k: string) => string
): string {
  if (state === 'ready') {
    return healthy
      ? t('dashboard.metricsServerHealthy')
      : t('dashboard.metricsServerDegraded')
  }
  if (state === 'error') return t('dashboard.metricsServerProbeError')
  return '—'
}

function pickHealthClass(
  state: UseMetricsPollingResult['state'],
  healthy: boolean
): string {
  if (healthy) return 'text-success'
  if (state === 'ready') return 'text-danger'
  return 'text-body-secondary'
}

export const ServerHealthCard: React.FC<MetricsCardProps> = ({ polling }) => {
  const { t } = useTranslation()
  const { latest, state, error } = polling
  const healthy = !!(latest && latest.server.healthy)
  const healthLabel = pickHealthLabel(state, healthy, t)
  const healthClass = pickHealthClass(state, healthy)
  const healthNode = (
    <span className={healthClass} data-testid="metrics-server-health">
      {healthLabel}
    </span>
  )
  return (
    <Card
      title={t('dashboard.metricsServerTitle')}
      data-testid="dashboard-metrics-server"
    >
      <div className="d-flex gap-4 align-items-start">
        <Chip value={healthNode} caption={t('dashboard.metricsServerHealth')} />
        <Chip
          value={latest ? formatDuration(latest.server.uptime_seconds) : '—'}
          caption={t('dashboard.metricsServerUptime')}
        />
        <Chip
          value={latest ? formatInt(latest.transactions.total) : '—'}
          caption={t('dashboard.metricsServerTransactions')}
        />
      </div>
      {state === 'error' && error ? (
        <div className="small text-danger mt-2" role="alert">
          {error}
        </div>
      ) : null}
    </Card>
  )
}
