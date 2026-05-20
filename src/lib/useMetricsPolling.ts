// src/lib/useMetricsPolling.ts
//
// 5-second polling hook over /api/v1/metrics. Wraps fetchMetrics with
// AbortController + visibility gating + a bounded history ring so the
// dashboard's sparkline cards have a per-sample time-series to render
// without re-fetching their own history.
//
// Three states the hook surfaces:
//
//   - `disabled`: the upstream server returned 503 METRICS_DISABLED on
//     the FIRST probe. The dashboard hides the cards entirely; we
//     stop polling so a misconfigured server doesn't get hammered.
//   - `error`:    a non-disabled failure (upstream 5xx, parse, network).
//     The cards render an error chip. Polling continues so the next
//     tick can recover automatically.
//   - `ready`:    at least one successful sample has landed; `latest`
//     and `history` are populated.
//
// The history ring is bounded by `historyMs` and trimmed lazily on each
// tick. Samples older than the window get evicted as we append; this is
// O(history-length) per tick, which is fine for 5 s × 5 min = 60 samples.

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  fetchMetrics,
  METRICS_DISABLED,
  MetricsError,
  type MetricsSnapshot,
} from '../api/metrics'

const DEFAULT_INTERVAL_MS = 5000
const DEFAULT_HISTORY_MS = 5 * 60 * 1000 // 5 min

export interface MetricsSample {
  /** Server-side stamp (CollectedAt) parsed to ms-since-epoch. */
  ts: number
  snapshot: MetricsSnapshot
}

export type MetricsState = 'idle' | 'loading' | 'ready' | 'error' | 'disabled'

export interface UseMetricsPollingResult {
  state: MetricsState
  latest: MetricsSnapshot | null
  history: ReadonlyArray<MetricsSample>
  error: string | null
}

export interface UseMetricsPollingOptions {
  intervalMs?: number
  historyMs?: number
  // Optional override for tests; production passes undefined to use the
  // real `fetchMetrics`.
  fetcher?: (signal: AbortSignal) => Promise<MetricsSnapshot>
}

export function useMetricsPolling(
  opts?: UseMetricsPollingOptions
): UseMetricsPollingResult {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS
  const historyMs = opts?.historyMs ?? DEFAULT_HISTORY_MS
  const fetcher = opts?.fetcher ?? fetchMetrics

  const [state, setState] = useState<MetricsState>('idle')
  const [latest, setLatest] = useState<MetricsSnapshot | null>(null)
  const [history, setHistory] = useState<ReadonlyArray<MetricsSample>>([])
  const [error, setError] = useState<string | null>(null)

  const aliveRef = useRef(true)
  const disabledRef = useRef(false)
  const inflightRef = useRef<AbortController | null>(null)
  // Keep fetcher in a ref so the polling effect's identity doesn't
  // depend on a stable fetcher reference from the caller.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const tick = useCallback(async (): Promise<void> => {
    if (disabledRef.current) return
    // Skip while the tab is backgrounded — the dashboard's own
    // visibility listener handles the post-resume catch-up.
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden'
    ) {
      return
    }
    // Abort any in-flight to avoid late resolves racing the next tick.
    if (inflightRef.current) inflightRef.current.abort()
    const controller = new AbortController()
    inflightRef.current = controller
    try {
      setState((s) => (s === 'idle' ? 'loading' : s))
      const snapshot = await fetcherRef.current(controller.signal)
      if (!aliveRef.current || controller.signal.aborted) return
      const ts = Date.parse(snapshot.collected_at) || Date.now()
      setLatest(snapshot)
      setHistory((prev) => {
        const cutoff = ts - historyMs
        const trimmed = prev.filter((s) => s.ts >= cutoff)
        trimmed.push({ ts, snapshot })
        return trimmed
      })
      setError(null)
      setState('ready')
    } catch (err: unknown) {
      if (controller.signal.aborted || !aliveRef.current) return
      if (err instanceof MetricsError && err.code === METRICS_DISABLED) {
        // Latch into the disabled state so we stop polling; the
        // dashboard's render gate uses this to hide the cards entirely.
        disabledRef.current = true
        setState('disabled')
        setError(null)
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      setState('error')
      setError(message)
    }
  }, [historyMs])

  useEffect(() => {
    aliveRef.current = true
    // Fire once on mount; the interval is the steady-state cadence.
    // tick() is async-fire-and-forget — failures are swallowed into
    // setError/setState inside the function itself, so awaiting would
    // just block the effect synchronously without changing behavior.
    tick().catch(() => {})
    const id = window.setInterval(() => {
      tick().catch(() => {})
    }, intervalMs)
    // Catch up the moment the tab becomes visible again — without this
    // a user returning after `intervalMs` would wait up to the next
    // tick to see fresh data.
    const onVisibility = (): void => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        !disabledRef.current
      ) {
        tick().catch(() => {})
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }
    return () => {
      aliveRef.current = false
      window.clearInterval(id)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
      if (inflightRef.current) inflightRef.current.abort()
    }
  }, [intervalMs, tick])

  return { state, latest, history, error }
}
