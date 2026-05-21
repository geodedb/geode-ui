import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { UseMetricsPollingResult } from '../../lib/useMetricsPolling'

// MetricsUpstreamAdvisory — Bug 3 (2026-05-21 bug-fix bundle).
//
// Detects the "upstream emitter declared but not wired" case and
// renders a one-line dismissible banner so the operator does not
// mistake an upstream gap for a SPA defect.
//
// Trigger: every numeric counter / gauge reports literal 0 (a quiet
// server returning a sane scrape) AND uptime exceeds the threshold
// below (so we do NOT fire on a fresh server that simply has not seen
// traffic yet). uptime + health are intentionally excluded from the
// "all zero" check — uptime advances every second by definition, and
// health is a constant 1.
//
// The banner is dismissible per-session via sessionStorage so a
// returning operator who already knows the upstream is incomplete can
// hide it for the remainder of their tab; the next session starts
// fresh.
//
// Self-rendering "null" path so callers can drop it inline above the
// metric cards without their own gate.

const QUIET_UPTIME_THRESHOLD_S = 60
const DISMISS_KEY = 'geode-ui.metrics-upstream-advisory.dismissed'

function isAllZero(latest: UseMetricsPollingResult['latest']): boolean {
  if (!latest) return false
  if (latest.queries.total !== 0) return false
  if (latest.queries.failed !== 0) return false
  if (latest.queries.duration_seconds_count !== 0) return false
  if (latest.connections.active !== 0) return false
  if (latest.connections.total !== 0) return false
  if (latest.transactions.total !== 0) return false
  if (latest.transactions.failed !== 0) return false
  if (latest.storage.nodes_total !== 0) return false
  if (latest.storage.edges_total !== 0) return false
  if (latest.storage.memory_bytes !== 0) return false
  return true
}

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* private mode etc. — best-effort */
  }
}

function formatUptime(seconds: number): string {
  const s = Math.floor(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export interface MetricsUpstreamAdvisoryProps {
  polling: UseMetricsPollingResult
}

export const MetricsUpstreamAdvisory: React.FC<
  MetricsUpstreamAdvisoryProps
> = ({ polling }) => {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed())

  if (dismissed) return null
  if (polling.state !== 'ready') return null
  const latest = polling.latest
  if (!latest) return null
  if (latest.server.uptime_seconds < QUIET_UPTIME_THRESHOLD_S) return null
  if (!isAllZero(latest)) return null

  const onDismiss = (): void => {
    writeDismissed()
    setDismissed(true)
  }

  return (
    <div
      className="alert alert-warning d-flex align-items-start gap-2 mb-3"
      role="status"
      data-testid="metrics-upstream-advisory"
    >
      <div className="flex-grow-1">
        <strong>{t('dashboard.metricsUpstreamAdvisoryTitle')}</strong>{' '}
        <span>
          {t('dashboard.metricsUpstreamAdvisoryBody', {
            uptime: formatUptime(latest.server.uptime_seconds),
          })}
        </span>{' '}
        <a
          href="docs/upstream-issues/geode-metrics-instrumentation.md"
          target="_blank"
          rel="noreferrer noopener"
        >
          {t('dashboard.metricsUpstreamAdvisoryLink')}
        </a>
      </div>
      <button
        type="button"
        className="btn-close"
        aria-label={t('dashboard.metricsUpstreamAdvisoryDismiss')}
        data-testid="metrics-upstream-advisory-dismiss"
        onClick={onDismiss}
      />
    </div>
  )
}
