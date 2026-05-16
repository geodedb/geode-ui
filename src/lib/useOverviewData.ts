import { useCallback, useEffect, useRef, useState } from 'react'
import { client } from '../api/client'
import { fetchCapabilities, type AdminWritable } from '../api/capabilities'
import { useActiveConnection } from '../api/connections'

export interface OverviewData {
  graphs: string[] | null
  geodeVersion: string | null
  adminWritable: AdminWritable | null
  loading: boolean
  graphsError: string | null
  capsError: string | null
  reload: () => void
  defaultGraphStats: { nodes: number; edges: number } | null
  statsLoading: boolean
  statsError: string | null
  loadStats: (graph: string) => void
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function scalarCount(resp: { rows?: unknown[][] }): number {
  const v = resp.rows?.[0]?.[0]
  return typeof v === 'number' ? v : Number(v) || 0
}

// PERF #237: cache the (nodes, edges) full-graph counts client-side
// keyed on (connectionId, graphName) with a 60s TTL. The dashboard
// rendered twice in quick succession (mount + capabilities settle)
// previously fired two `MATCH (n) RETURN count(n)` and one `MATCH ()-[r]->()
// RETURN count(r)` per render, both of which are full-graph scans on
// the Geode backend. The cache lives at module scope so it survives
// unmount/remount within the TTL window — a dashboard back-button
// round-trip now serves stats from memory instead of re-issuing both
// scans.
//
// Sensible default: 60s TTL. Picked to balance "fresh enough that a
// user reading the card doesn't see stale numbers" against "long
// enough that quick remount/route flicker doesn't refire the count
// queries." Override at test time via `setGraphStatsCacheTTL(ms)`.
//
// Storage shape: a flat Map<string, CacheEntry>. The composite key
// guarantees per-connection isolation (e.g. swapping from a dev DB to
// prod must NOT serve dev's counts). A null connectionId yields the
// literal "null" key, which is fine because the dashboard does not
// render stats without an active connection.
interface GraphStatsCacheEntry {
  nodes: number
  edges: number
  expiresAt: number
}

const graphStatsCache = new Map<string, GraphStatsCacheEntry>()
let graphStatsCacheTTL = 60_000 // ms

function graphStatsCacheKey(
  connectionId: string | null,
  graph: string
): string {
  // Use a delimiter that cannot appear in graph names per
  // sanitizeGraphName (alphanumerics + underscore only) so the key is
  // unambiguous even if a connection ID contains '::'.
  return `${connectionId ?? 'null'}::${graph}`
}

function readGraphStatsCache(
  connectionId: string | null,
  graph: string,
  now: number = Date.now()
): { nodes: number; edges: number } | null {
  const entry = graphStatsCache.get(graphStatsCacheKey(connectionId, graph))
  if (!entry) return null
  if (entry.expiresAt <= now) {
    graphStatsCache.delete(graphStatsCacheKey(connectionId, graph))
    return null
  }
  return { nodes: entry.nodes, edges: entry.edges }
}

function writeGraphStatsCache(
  connectionId: string | null,
  graph: string,
  value: { nodes: number; edges: number },
  now: number = Date.now()
): void {
  graphStatsCache.set(graphStatsCacheKey(connectionId, graph), {
    nodes: value.nodes,
    edges: value.edges,
    expiresAt: now + graphStatsCacheTTL,
  })
}

// testOnlyResetGraphStatsCache clears the module-level cache so each
// test starts from a known state. NOT for production use.
export function testOnlyResetGraphStatsCache(): void {
  graphStatsCache.clear()
}

// testOnlySetGraphStatsCacheTTL overrides the TTL for tests that
// need to assert eviction without sleeping the real 60s window.
export function testOnlySetGraphStatsCacheTTL(ms: number): void {
  graphStatsCacheTTL = ms
}

// testOnlyGetGraphStatsCacheTTL returns the configured TTL so tests
// can restore it via try/finally.
export function testOnlyGetGraphStatsCacheTTL(): number {
  return graphStatsCacheTTL
}

// useOverviewData powers the homepage dashboard: on mount it fetches the
// graph list and the server capabilities in parallel, each with its own
// error slot so a failure of one does not blank the other. It also exposes
// an on-demand `loadStats(graph)` that runs node-count + edge-count queries
// against the given graph.
export function useOverviewData(): OverviewData {
  const [graphs, setGraphs] = useState<string[] | null>(null)
  const [geodeVersion, setGeodeVersion] = useState<string | null>(null)
  const [adminWritable, setAdminWritable] = useState<AdminWritable | null>(null)
  const [loading, setLoading] = useState(true)
  const [graphsError, setGraphsError] = useState<string | null>(null)
  const [capsError, setCapsError] = useState<string | null>(null)
  const [defaultGraphStats, setDefaultGraphStats] = useState<{
    nodes: number
    edges: number
  } | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState<string | null>(null)
  const aliveRef = useRef(true)
  useEffect(
    () => () => {
      aliveRef.current = false
    },
    []
  )

  const load = useCallback(() => {
    setLoading(true)
    setGraphsError(null)
    setCapsError(null)
    let pending = 2
    const done = (): void => {
      pending -= 1
      if (pending === 0 && aliveRef.current) setLoading(false)
    }
    client
      .graphs({})
      .then(
        (g) => {
          if (aliveRef.current) setGraphs(g.graphs ?? [])
        },
        (e) => {
          if (aliveRef.current) setGraphsError(errMsg(e))
        }
      )
      .finally(done)
    fetchCapabilities()
      .then(
        (c) => {
          if (aliveRef.current) {
            setGeodeVersion(c.geodeVersion)
            setAdminWritable(c.adminWritable)
          }
        },
        (e) => {
          if (aliveRef.current) setCapsError(errMsg(e))
        }
      )
      .finally(done)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const activeConn = useActiveConnection()
  const connectionId = activeConn?.connectionId ?? null

  const loadStats = useCallback(
    (graph: string) => {
      // PERF #237: cache check FIRST. A cached entry returns the
      // counts synchronously and skips both full-graph count queries.
      const cached = readGraphStatsCache(connectionId, graph)
      if (cached) {
        setStatsError(null)
        setStatsLoading(false)
        setDefaultGraphStats(cached)
        return
      }
      setStatsLoading(true)
      setStatsError(null)
      setDefaultGraphStats(null)
      Promise.all([
        client.query({
          statement: 'MATCH (n) RETURN count(n) AS c',
          page_size: 1000,
          timeout_ms: 30000,
          graph,
        }),
        client.query({
          statement: 'MATCH ()-[r]->() RETURN count(r) AS c',
          page_size: 1000,
          timeout_ms: 30000,
          graph,
        }),
      ])
        .then(
          ([nodesResp, edgesResp]) => {
            const stats = {
              nodes: scalarCount(nodesResp),
              edges: scalarCount(edgesResp),
            }
            // Cache regardless of whether the hook is still alive: a
            // remount within the TTL window should hit the cache even
            // if the original loader was unmounted before its promise
            // resolved.
            writeGraphStatsCache(connectionId, graph, stats)
            if (aliveRef.current) {
              setDefaultGraphStats(stats)
            }
          },
          (e) => {
            if (aliveRef.current) setStatsError(errMsg(e))
          }
        )
        .finally(() => {
          if (aliveRef.current) setStatsLoading(false)
        })
    },
    [connectionId]
  )

  return {
    graphs,
    geodeVersion,
    adminWritable,
    loading,
    graphsError,
    capsError,
    reload: load,
    defaultGraphStats,
    statsLoading,
    statsError,
    loadStats,
  }
}
