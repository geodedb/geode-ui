// src/components/dashboard/AuditEventMixCard.tsx
//
// Donut chart of audit-event type counts over the most recent N
// entries fetched from `/api/v1/audit`. Powers the "what kinds of
// things are happening" panel on the Dashboard.
//
// Open-question #4 from the plan: `access_token_query` is emitted by
// the security middleware for every request that carries a
// `?access_token=…` query parameter; in a normal cookie-auth session
// it never fires, but legacy clients (CLIs, the MCP HTTP transport)
// hammer it and would otherwise dominate the donut. We collapse it
// (and any other middleware-only events that match the SYSTEM_EVENTS
// pattern) into a single "system" slice that the operator can ignore
// at a glance.

import React from 'react'
import { useTranslation } from 'react-i18next'
// Per-chart imports (plan open-question #1 fallback) — pulling from
// recharts/es6/* keeps the bundle delta under the 1.5 MiB webpack
// budget. See the matching note in Sparkline.tsx.
import { Cell } from 'recharts/es6/component/Cell'
import { Legend } from 'recharts/es6/component/Legend'
import { Pie } from 'recharts/es6/polar/Pie'
import { PieChart } from 'recharts/es6/chart/PieChart'
import { ResponsiveContainer } from 'recharts/es6/component/ResponsiveContainer'
import { Tooltip } from 'recharts/es6/component/Tooltip'

import { Card } from './Card'
import { useApiResource } from '../../hooks/useApiResource'
import { client } from '../../api/client'
import { usePollingClock } from '../../lib/usePollingClock'

// AUDIT_DONUT_LIMIT — how many recent audit entries we sample for the
// mix view. 200 matches the server-side default cap on
// `GET /api/v1/audit?limit=` (parseAuditLimit in handlers_audit.go)
// so we always pull a complete page in one round-trip.
const AUDIT_DONUT_LIMIT = 200

// AUDIT_DONUT_INTERVAL_MS — refresh cadence. Audit is a slowly-
// growing append-only log; a 30s refresh is fast enough to feel live
// when the operator stays on the dashboard and quiet enough that the
// /api/v1/audit endpoint never becomes a hot path.
const AUDIT_DONUT_INTERVAL_MS = 30_000

// SYSTEM_EVENT_NAMES are the audit event types that are emitted by
// middleware (no user actor) and would otherwise dominate the mix.
// We group them under the "system" label so a real action (login,
// query, profile_created, etc.) is always visible on the donut.
const SYSTEM_EVENT_NAMES = new Set<string>([
  'access_token_query',
  'auth_role_resolved',
])

// MAX_SLICES — beyond this many distinct event types, the tail rolls
// up into a single "other" slice. Keeps the donut legible at 200
// samples spread across diverse event types.
const MAX_SLICES = 7

// PALETTE — Bootstrap CSS-variable tokens so the donut re-themes for
// dark mode without a per-mode prop. The fallback path comes from
// Bootstrap itself when the variable isn't defined; we don't hardcode
// hex literals here (the project's lint:hardcoded-styles gate forbids
// raw colors outside src/theme/).
const PALETTE = [
  'var(--bs-primary)',
  'var(--bs-success)',
  'var(--bs-info)',
  'var(--bs-warning)',
  'var(--bs-danger)',
  'var(--bs-purple)',
  'var(--bs-orange)',
  'var(--bs-secondary)',
]

interface AuditEntry {
  event?: string
}

interface MixSlice {
  name: string
  value: number
}

// computeMix groups entries by event name, collapses every event in
// SYSTEM_EVENT_NAMES under "system", and truncates the tail to
// MAX_SLICES with an "other" rollup. Exported for the unit test.
export function computeMix(entries: ReadonlyArray<AuditEntry>): MixSlice[] {
  const counts = new Map<string, number>()
  entries.forEach((e) => {
    const event = e.event ?? 'unknown'
    const key = SYSTEM_EVENT_NAMES.has(event) ? 'system' : event
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  const sorted = Array.from(counts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
  if (sorted.length <= MAX_SLICES) return sorted
  const head = sorted.slice(0, MAX_SLICES - 1)
  const tail = sorted.slice(MAX_SLICES - 1)
  const otherValue = tail.reduce((sum, s) => sum + s.value, 0)
  return [...head, { name: 'other', value: otherValue }]
}

export const AuditEventMixCard: React.FC = () => {
  const { t } = useTranslation()
  const { data, status, refetch } = useApiResource<AuditEntry[]>(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_signal) => {
      const r = (await client.audit({
        // No since/event/user filters — the mix is "everything we
        // can see"; server caps at 200 entries which matches our
        // AUDIT_DONUT_LIMIT.
        since: '',
        event: '',
        user: '',
      })) as { entries?: AuditEntry[] }
      return r.entries ?? []
    },
    []
  )
  // Loose-cadence refresh via the shared polling clock — one
  // window.setInterval is multiplexed across every poller on the
  // page (PERF-2026-05-21-02 / Item 5, 2026-05-21 audit). The clock
  // already gates on document.visibilityState, so the per-card check
  // is no longer needed here.
  usePollingClock(AUDIT_DONUT_INTERVAL_MS, refetch)

  const entries = (data ?? []).slice(0, AUDIT_DONUT_LIMIT)
  const slices = computeMix(entries)
  const total = slices.reduce((sum, s) => sum + s.value, 0)

  let body: React.ReactNode
  if (status === 'loading' && entries.length === 0) {
    body = (
      <p className="m-0 text-body-secondary" role="status">
        {t('dashboard.loading')}
      </p>
    )
  } else if (total === 0) {
    body = (
      <p className="m-0 text-body-secondary">
        {t('dashboard.metricsAuditMixEmpty')}
      </p>
    )
  } else {
    body = (
      <div style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices as unknown as Record<string, unknown>[]}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="80%"
              paddingAngle={1}
              isAnimationActive={false}
            >
              {slices.map((s, i) => (
                <Cell
                  key={s.name}
                  fill={PALETTE[i % PALETTE.length]}
                  data-testid={`audit-mix-slice-${s.name}`}
                />
              ))}
            </Pie>
            <Tooltip
              isAnimationActive={false}
              formatter={(value: number | string, name: string) => [
                String(value),
                name,
              ]}
            />
            <Legend
              verticalAlign="bottom"
              height={36}
              wrapperStyle={{ fontSize: '0.75rem' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    )
  }

  return (
    <Card
      title={t('dashboard.metricsAuditMixTitle', { count: total })}
      data-testid="dashboard-metrics-audit-mix"
    >
      {body}
    </Card>
  )
}
