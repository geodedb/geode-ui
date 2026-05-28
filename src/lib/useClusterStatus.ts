import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchClusterStatus, type ClusterStatusSnapshot } from '../api/cluster'
import { useActiveConnection } from '../api/connections'

export interface UseClusterStatusOptions {
  // Polling interval in ms. Default chosen large enough that an
  // operator who leaves the dashboard open all day doesn't generate
  // sustained WS traffic — every 10 s is fine for "what's the cluster
  // doing", and election storms last fractions of a second so polling
  // faster would not actually help operators react.
  intervalMs?: number
}

export interface UseClusterStatusResult {
  snapshot: ClusterStatusSnapshot | null
  loading: boolean
  error: string | null
  // refresh forces an immediate poll. Returns the in-flight Promise so
  // callers can await it (Plan 2's manual-refresh button).
  refresh: () => Promise<void>
}

const DEFAULT_INTERVAL_MS = 10_000

// useClusterStatus polls SHOW CLUSTER STATUS on a fixed cadence while
// the component is mounted AND there is an active connection. Polling
// stops on unmount, on connection change (and restarts against the new
// connection), and is suppressed entirely when there is no active
// connection (e.g. the user is mid-onboarding).
export function useClusterStatus(
  opts: UseClusterStatusOptions = {}
): UseClusterStatusResult {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  const active = useActiveConnection()
  const connectionId = active?.connectionId ?? null
  const [snapshot, setSnapshot] = useState<ClusterStatusSnapshot | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)
  // generationRef lets us drop late-arriving fetches whose connection
  // has since been swapped out from under us. Bump on every reset.
  const generationRef = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    const gen = generationRef.current
    setLoading(true)
    try {
      const snap = await fetchClusterStatus()
      if (cancelledRef.current || generationRef.current !== gen) return
      setSnapshot(snap)
      setError(null)
    } catch (e) {
      if (cancelledRef.current || generationRef.current !== gen) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!cancelledRef.current && generationRef.current === gen) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    generationRef.current += 1
    if (!connectionId) {
      setSnapshot(null)
      setLoading(false)
      setError(null)
      return undefined
    }
    refresh().catch(() => {})
    const id = window.setInterval(() => {
      refresh().catch(() => {})
    }, intervalMs)
    return () => {
      cancelledRef.current = true
      window.clearInterval(id)
    }
  }, [connectionId, intervalMs, refresh])

  return { snapshot, loading, error, refresh }
}
