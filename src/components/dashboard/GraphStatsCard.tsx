import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@geodedb/ui-core'

import { Card } from './Card'
import type { PerGraphStats } from '../../lib/useOverviewData'

// GraphStatsCard — Bug 4 (2026-05-21 bug-fix bundle) rewrite.
//
// Before: the card hosted a single graph (`pickDefaultGraph(graphs)`)
// behind a "Load stats" button-gated UX so the two full-graph count()
// scans only fired on demand. That made the dashboard feel inert and
// hid stats for every graph other than the picked default.
//
// After: the card renders a small table of per-graph counts that
// auto-load on dashboard mount (driven by useOverviewData::loadAllStats
// with bounded concurrency), exposes a Refresh all affordance, a
// per-row refresh button, and a text filter so an operator with many
// graphs can narrow the view.
//
// The 60s client-side cache (PERF #237) is unchanged, so a remount or
// route flicker within the TTL window does not re-fire the count scans
// for any graph still cached.

interface GraphStatsCardProps {
  graphs: string[] | null
  // Snapshot from useOverviewData; keyed by graph name. Entries
  // materialise lazily as loadAllStats fans out.
  stats: ReadonlyMap<string, PerGraphStats>
  // Refresh affordances. onRefreshAll re-runs every graph; onRefreshOne
  // re-runs just the named graph (cache invalidated first).
  onRefreshAll: () => void
  onRefreshOne: (graph: string) => void
}

export const GraphStatsCard: React.FC<GraphStatsCardProps> = ({
  graphs,
  stats,
  onRefreshAll,
  onRefreshOne,
}) => {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')

  const visible = useMemo(() => {
    const list = graphs ?? []
    const needle = filter.trim().toLowerCase()
    if (!needle) return list
    return list.filter((g) => g.toLowerCase().includes(needle))
  }, [graphs, filter])

  const headerActions = (
    <div className="d-flex align-items-center gap-2">
      <label className="visually-hidden" htmlFor="graph-stats-filter">
        {t('dashboard.graphStatsFilterAria')}
      </label>
      <input
        id="graph-stats-filter"
        type="text"
        className="form-control form-control-sm"
        style={{ width: '8rem' }}
        placeholder={t('dashboard.graphStatsFilterPlaceholder')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        data-testid="graph-stats-filter"
      />
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        onClick={onRefreshAll}
        data-testid="graph-stats-refresh-all"
        aria-label={t('dashboard.graphStatsRefreshAll')}
      >
        <Icon name="rotate" fixedWidth />
      </button>
    </div>
  )

  const pendingCell = (
    <span className="text-body-tertiary" aria-label="loading">
      {t('dashboard.graphStatsPending')}
    </span>
  )

  const renderCount = (
    value: number | null | undefined,
    loading: boolean,
    error: string | null
  ): React.ReactNode => {
    if (error) return null
    if (loading || value === null || value === undefined) return pendingCell
    return value
  }

  const renderBody = (): React.ReactNode => {
    if (!graphs || graphs.length === 0) {
      return (
        <p className="m-0 text-body-secondary" role="status">
          {t('dashboard.graphStatsEmpty')}
        </p>
      )
    }
    if (visible.length === 0) {
      return (
        <p className="m-0 text-body-secondary" role="status">
          {t('dashboard.graphStatsNoMatch')}
        </p>
      )
    }
    return (
      <table
        className="table table-sm m-0 align-middle"
        data-testid="graph-stats-table"
      >
        <thead>
          <tr>
            <th scope="col" className="text-body-tertiary fw-normal">
              {t('dashboard.graphStatsHeaderGraph')}
            </th>
            <th scope="col" className="text-body-tertiary fw-normal text-end">
              {t('dashboard.graphStatsHeaderNodes')}
            </th>
            <th scope="col" className="text-body-tertiary fw-normal text-end">
              {t('dashboard.graphStatsHeaderEdges')}
            </th>
            <th
              scope="col"
              className="text-body-tertiary fw-normal text-end"
              aria-label="actions"
            />
          </tr>
        </thead>
        <tbody>
          {visible.map((g) => {
            const row = stats.get(g)
            const loading = row?.loading ?? false
            const error = row?.error ?? null
            const nodes = row?.nodes
            const edges = row?.edges
            return (
              <tr key={g} data-testid={`graph-stats-row-${g}`}>
                <td className="font-monospace">{g}</td>
                <td className="text-end font-monospace">
                  {error ? (
                    <span
                      className="text-danger"
                      title={error}
                      role="alert"
                      data-testid={`graph-stats-error-${g}`}
                    >
                      !
                    </span>
                  ) : (
                    renderCount(nodes, loading, error)
                  )}
                </td>
                <td className="text-end font-monospace">
                  {renderCount(edges, loading, error)}
                </td>
                <td className="text-end">
                  <button
                    type="button"
                    className="btn btn-sm btn-link p-0"
                    onClick={() => onRefreshOne(g)}
                    data-testid={`graph-stats-refresh-${g}`}
                    aria-label={t('dashboard.graphStatsRefreshOneAria', {
                      graph: g,
                    })}
                    disabled={loading}
                  >
                    <Icon name="rotate" fixedWidth />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  return (
    <Card
      title={t('dashboard.graphStatsTitle')}
      action={headerActions}
      data-testid="dashboard-stats-card"
    >
      {renderBody()}
    </Card>
  )
}
