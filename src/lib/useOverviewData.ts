import { useCallback, useEffect, useRef, useState } from 'react'
import { client } from '../api/client'
import { fetchCapabilities, type AdminWritable } from '../api/capabilities'
import { useActiveConnection } from '../api/connections'

export interface PerGraphStats {
  graph: string
  nodes: number | null
  edges: number | null
  loading: boolean
  error: string | null
}

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
  // Bug 4 (2026-05-21 bug-fix bundle): multi-graph view for the
  // Dashboard's graph-stats card. allGraphStats is a snapshot keyed
  // by graph name; entries materialise as loadAllStats fans out node-
  // and edge-count scans across the graph list (bounded concurrency
  // so a server with many graphs is never hit with a thundering herd).
  // reloadStats invalidates a single graph's cache and re-runs its
  // counts — used by per-row refresh affordances in the card.
  allGraphStats: ReadonlyMap<string, PerGraphStats>
  loadAllStats: () => void
  reloadStats: (graph: string) => void
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
// Storage shape: a flat Map<string, CacheEntry> bounded to
// `GRAPH_STATS_CACHE_MAX` entries via insertion-ordered LRU eviction
// (the JS Map iteration contract). The composite key guarantees per-
// connection isolation (e.g. swapping from a dev DB to prod must NOT
// serve dev's counts). A null connectionId yields the literal "null"
// key, which is fine because the dashboard does not render stats
// without an active connection.
//
// PERF-N7 (#286): a long-lived tab that browses through many graphs
// (each with a unique `(connectionId, graphName)` key) would
// otherwise leak entries — the 60s TTL only fires lazily on a
// matching-key read, so unread entries sit forever. The 32-entry cap
// keeps the memory footprint bounded to ~32 * (key + 3 numbers) =
// O(KB) regardless of browsing pattern, while preserving the
// dashboard back-button hot path (which typically reuses 1-3 keys).
interface GraphStatsCacheEntry {
  nodes: number
  edges: number
  expiresAt: number
}

// Bound chosen per PERF-N7 (#286). Picked to be:
//   - Larger than any plausible "graphs the user actively browses in
//     a single session" window (3-5 in practice).
//   - Small enough that the eviction sweep is O(1) amortised.
//   - Aligned with the next-power-of-two heuristic for memory hints.
const GRAPH_STATS_CACHE_MAX = 32

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
  const key = graphStatsCacheKey(connectionId, graph)
  // PERF-N7 (#286): delete-before-set so an existing key is reinserted
  // at the end of the iteration order. The JS Map contract preserves
  // insertion order, so the oldest entry sits at `keys().next().value`
  // and is the LRU victim when the cap is exceeded.
  if (graphStatsCache.has(key)) {
    graphStatsCache.delete(key)
  }
  graphStatsCache.set(key, {
    nodes: value.nodes,
    edges: value.edges,
    expiresAt: now + graphStatsCacheTTL,
  })
  // Bound the cache size. With insertion-ordered iteration the FIRST
  // key in the Map is the oldest (least-recently-set) entry. Eviction
  // is amortised O(1) per write; the loop only iterates when a fresh
  // insertion overshoots the cap.
  while (graphStatsCache.size > GRAPH_STATS_CACHE_MAX) {
    const oldest = graphStatsCache.keys().next().value
    if (oldest === undefined) break
    graphStatsCache.delete(oldest)
  }
}

// testOnlyGraphStatsCacheSize returns the current entry count so tests
// can assert the cap eviction without going through the public hook
// surface. NOT for production use.
export function testOnlyGraphStatsCacheSize(): number {
  return graphStatsCache.size
}

// testOnlyGraphStatsCacheHas returns true when the given (connectionId,
// graph) tuple is currently cached. NOT for production use.
export function testOnlyGraphStatsCacheHas(
  connectionId: string | null,
  graph: string
): boolean {
  return graphStatsCache.has(graphStatsCacheKey(connectionId, graph))
}

// graphStatsCacheMax exposes the eviction cap as a read-only constant
// so tests can derive assertions against it without hard-coding 32.
export const graphStatsCacheMax: number = GRAPH_STATS_CACHE_MAX

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
  // 2026-05-22 bug-fix: track which connection's `graphs` are
  // currently in state. The auto-loadAllStats effect (below) runs in
  // the SAME commit phase as the connection-change clear effect, so
  // its `graphs` read is the PREVIOUS connection's list — without
  // this gate, picking a new profile would fan out stats queries
  // for the prior profile's graphs against the new upstream (the
  // observable 422 in the bug report). We only fire loadAllStats
  // when `graphs` was actually fetched FOR the current
  // connection, so a stale render between clear-and-refetch
  // doesn't trigger a thundering-herd of mismatched queries.
  const [graphsConnId, setGraphsConnId] = useState<string | null>(null)
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

  // 2026-05-22 bug-fix: a generation token guards every in-flight
  // load() against a profile switch that lands while the previous
  // load is still resolving. Without it the older response's
  // setGraphs / setGeodeVersion / etc. would clobber the newer
  // profile's freshly-fetched data. We compare each settle against
  // the captured loadGen — a mismatch means the active connection
  // has rotated since this load was scheduled, and the response is
  // discarded. Bumps live with the connection-change effect below.
  const loadGenRef = useRef(0)
  // activeConnectionIdRef mirrors `connectionId` for callbacks that
  // must compare against the CURRENT active connection rather than
  // the connection that was active when the callback was created.
  // fetchOneGraphStats captures connectionId in a closure (via
  // useCallback deps); when the operator switches profile mid-fetch,
  // the OLD-identity fetchOneGraphStats's in-flight queries can
  // resolve AFTER we cleared `allGraphStats` and writeOneStat the
  // OLD profile's numbers back into the new profile's view. The
  // ref lets fetchOneGraphStats read the LATEST connectionId at
  // write-time and skip the setOneStat call when stale.
  const activeConnectionIdRef = useRef<string | null>(null)

  const load = useCallback(() => {
    loadGenRef.current += 1
    const myGen = loadGenRef.current
    // Capture the connection that this load is fetching for. When
    // graphs land, we tag the state with this id so the auto-load-
    // stats effect can tell whether `graphs` matches the operator's
    // CURRENT active connection. A re-render driven by a profile
    // switch otherwise fires the auto-load effect with the previous
    // profile's `graphs` (state setters haven't applied yet in the
    // same commit phase) and we'd fan out against the wrong upstream.
    const myConnId = activeConnectionIdRef.current
    setLoading(true)
    setGraphsError(null)
    setCapsError(null)
    let pending = 2
    const done = (): void => {
      pending -= 1
      if (pending === 0 && aliveRef.current && loadGenRef.current === myGen) {
        setLoading(false)
      }
    }
    client
      .graphs({})
      .then(
        (g) => {
          if (!aliveRef.current || loadGenRef.current !== myGen) return
          setGraphs(g.graphs ?? [])
          setGraphsConnId(myConnId)
        },
        (e) => {
          if (!aliveRef.current || loadGenRef.current !== myGen) return
          setGraphsError(errMsg(e))
        }
      )
      .finally(done)
    fetchCapabilities()
      .then(
        (c) => {
          if (!aliveRef.current || loadGenRef.current !== myGen) return
          setGeodeVersion(c.geodeVersion)
          setAdminWritable(c.adminWritable)
        },
        (e) => {
          if (!aliveRef.current || loadGenRef.current !== myGen) return
          setCapsError(errMsg(e))
        }
      )
      .finally(done)
  }, [])

  const activeConn = useActiveConnection()
  const connectionId = activeConn?.connectionId ?? null

  // Refetch on EVERY active-connection change — mount is one such
  // change (the initial activeConn). Pre-fix `load()` only fired on
  // mount; switching profile in the chrome dropdown left the
  // dashboard pinned to the prior profile's graphs + capabilities,
  // and the loadAllStats auto-fan-out then re-fired
  // `client.query({ graph: <oldName> })` against the new upstream —
  // observed as a 422 against a Geode that lacked the prior
  // profile's seeded graphs.
  //
  // We also clear EVERY downstream view's state on a real
  // connection change: graphs, geodeVersion, adminWritable,
  // defaultGraphStats, and allGraphStats. The operator must see a
  // visibly-reloading dashboard rather than the prior profile's
  // numbers under a new chrome label. The initial mount renders
  // with `null` graphs anyway so the clear is a no-op on first run.
  const prevConnectionIdRef = useRef<string | null>(null)
  useEffect(() => {
    // Mirror the active connection into the ref synchronously so any
    // callback that captured an older value can detect the rotation.
    activeConnectionIdRef.current = connectionId
    const prev = prevConnectionIdRef.current
    if (prev !== null && prev !== connectionId) {
      setGraphs(null)
      setGraphsConnId(null)
      setGeodeVersion(null)
      setAdminWritable(null)
      setDefaultGraphStats(null)
      setAllGraphStats(new Map())
      setGraphsError(null)
      setCapsError(null)
      setStatsError(null)
      setStatsLoading(false)
    }
    prevConnectionIdRef.current = connectionId
    load()
  }, [connectionId, load])

  // Bug 4 (2026-05-21 bug-fix bundle): per-graph stats map for the
  // Dashboard multi-graph view. Stored as a Map so callers iterating
  // in graph-list order produce a stable render order; updates clone
  // the Map so React sees a new identity.
  const [allGraphStats, setAllGraphStats] = useState<
    ReadonlyMap<string, PerGraphStats>
  >(new Map())

  const setOneStat = useCallback(
    (graph: string, patch: Partial<PerGraphStats>) => {
      if (!aliveRef.current) return
      setAllGraphStats((prev) => {
        const next = new Map(prev)
        const current = next.get(graph) ?? {
          graph,
          nodes: null,
          edges: null,
          loading: false,
          error: null,
        }
        next.set(graph, { ...current, ...patch, graph })
        return next
      })
    },
    []
  )

  const fetchOneGraphStats = useCallback(
    async (graph: string): Promise<void> => {
      // Snapshot the connection at fetch-start. If the operator rotates
      // profile while the queries are in flight, the resolved promise's
      // setOneStat would otherwise leak the OLD profile's stats into
      // the NEW profile's view (the chrome label moved, but the cards
      // still showed yesterday's numbers). Compare against the live
      // ref at every write site and skip stale settles.
      const myConnId = connectionId
      const stale = (): boolean => activeConnectionIdRef.current !== myConnId
      // Cache fast-path. Skip the two full-graph count() scans when a
      // fresh entry is on hand (60s TTL by default, see writeGraphStats
      // Cache).
      const cached = readGraphStatsCache(connectionId, graph)
      if (cached) {
        if (stale()) return
        setOneStat(graph, {
          nodes: cached.nodes,
          edges: cached.edges,
          loading: false,
          error: null,
        })
        return
      }
      if (stale()) return
      setOneStat(graph, { loading: true, error: null })
      try {
        const [nodesResp, edgesResp] = await Promise.all([
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
        if (stale()) return
        const stats = {
          nodes: scalarCount(nodesResp),
          edges: scalarCount(edgesResp),
        }
        writeGraphStatsCache(connectionId, graph, stats)
        setOneStat(graph, {
          nodes: stats.nodes,
          edges: stats.edges,
          loading: false,
          error: null,
        })
      } catch (e) {
        if (stale()) return
        setOneStat(graph, { loading: false, error: errMsg(e) })
      }
    },
    [connectionId, setOneStat]
  )

  // Bounded-concurrency fan-out across the graph list. Picked 3 as a
  // conservative default: a single full-graph count(n) scan is already
  // an upstream load spike, and the dashboard runs in parallel with
  // every other panel the user opens, so 3 inflight node-+edge-count
  // pairs (= 6 wire-level queries) is the practical ceiling before
  // /api/v1/query queueing tail latency drowns the rest of the page.
  const FAN_OUT_LIMIT = 3
  const loadAllStats = useCallback(() => {
    if (!aliveRef.current) return
    const list = graphs ?? []
    if (list.length === 0) return
    let cursor = 0
    const next = (): Promise<void> => {
      if (cursor >= list.length) return Promise.resolve()
      const i = cursor
      cursor += 1
      const g = list[i]
      if (g === undefined) return Promise.resolve()
      return fetchOneGraphStats(g).then(next)
    }
    // Spawn up to FAN_OUT_LIMIT walkers; each pulls the next graph
    // off the shared cursor when its current query pair settles.
    const workers = Array.from(
      { length: Math.min(FAN_OUT_LIMIT, list.length) },
      next
    )
    Promise.all(workers).catch(() => undefined)
  }, [graphs, fetchOneGraphStats])

  const reloadStats = useCallback(
    (graph: string) => {
      // Per-row refresh: drop the cached entry so the cache check in
      // fetchOneGraphStats falls through, then re-run.
      graphStatsCache.delete(graphStatsCacheKey(connectionId, graph))
      fetchOneGraphStats(graph).catch(() => undefined)
    },
    [connectionId, fetchOneGraphStats]
  )

  // Auto-load stats once the graph list lands. Reuses the cache, so a
  // remount within the TTL window is free.
  //
  // 2026-05-22 bug-fix: gate on `graphsConnId === connectionId`. The
  // effect's dep `loadAllStats` changes identity whenever connectionId
  // changes (via fetchOneGraphStats's deps). After a profile switch,
  // this effect re-runs in the SAME commit phase as the
  // connection-change clear effect — at that point `graphs` is still
  // the PREVIOUS profile's list (the clear's `setGraphs(null)` is
  // queued but not yet applied). Without the connId gate we'd fan
  // out queries for old-profile graphs against the new upstream,
  // producing the 422 from the operator's bug report.
  useEffect(() => {
    if (graphs && graphs.length > 0 && graphsConnId === connectionId) {
      loadAllStats()
    }
    // graphs identity changes on each fetch; loadAllStats is memoised
    // on graphs+fetchOneGraphStats so this effect fires once per real
    // graph-list change. graphsConnId is the per-connection
    // freshness token populated by load() on success.
  }, [graphs, graphsConnId, connectionId, loadAllStats])

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
    allGraphStats,
    loadAllStats,
    reloadStats,
  }
}
