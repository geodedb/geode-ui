// src/api/metrics.ts
//
// Typed client for GET /api/v1/metrics — the geode-ui proxy in front
// of the upstream geode Prometheus exposition. The proxy itself lives
// in internal/server/handlers_metrics.go and returns the projection
// defined here as MetricsSnapshot.
//
// Why a plain fetch and not the generated client.metrics(): the route
// was added without a genapi regeneration step (see the route comment
// in cmd/server/app_routes.go). When metrics joins genapi.json this
// module can swap to `client.metrics()` without changing the public
// surface — the runtime types are identical.

import { resolveBaseUrl } from './client'

export interface MetricsHistogramBucket {
  upper_bound: number
  count: number
}

export interface MetricsQueries {
  total: number
  failed: number
  duration_seconds_sum: number
  duration_seconds_count: number
  duration_seconds_buckets: MetricsHistogramBucket[]
}

export interface MetricsConnections {
  active: number
  total: number
}

export interface MetricsTransactions {
  total: number
  failed: number
}

export interface MetricsStorage {
  nodes_total: number
  edges_total: number
  memory_bytes: number
}

export interface MetricsServer {
  uptime_seconds: number
  healthy: boolean
}

export interface MetricsSnapshot {
  queries: MetricsQueries
  connections: MetricsConnections
  transactions: MetricsTransactions
  storage: MetricsStorage
  server: MetricsServer
  collected_at: string
}

// METRICS_DISABLED is the sentinel error.code the server returns from
// `/api/v1/metrics` when GEODE_METRICS_URL is not set. The polling hook
// treats this as a non-error "feature off" signal so the dashboard
// renders an empty state instead of an angry red banner.
export const METRICS_DISABLED = 'METRICS_DISABLED'

export class MetricsError extends Error {
  code: string

  status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'MetricsError'
    this.code = code
    this.status = status
  }
}

// fetchMetrics issues a single GET and parses the response into a
// MetricsSnapshot. 5xx and 4xx responses are surfaced as MetricsError
// with the upstream code preserved so callers can branch on
// METRICS_DISABLED specifically.
export async function fetchMetrics(
  signal?: AbortSignal
): Promise<MetricsSnapshot> {
  const res = await fetch(`${resolveBaseUrl()}/api/v1/metrics`, {
    method: 'GET',
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) {
    let code = 'UNKNOWN'
    let message = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as {
        code?: string
        description?: string
      }
      if (body && typeof body.code === 'string') {
        code = body.code
      }
      if (body && typeof body.description === 'string') {
        message = body.description
      }
    } catch {
      // Body wasn't JSON; keep the status-line message.
    }
    throw new MetricsError(message, code, res.status)
  }
  return (await res.json()) as MetricsSnapshot
}
