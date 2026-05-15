import { useCallback, useEffect, useRef, useState } from 'react'
import { client } from '../api/client'
import { fetchCapabilities, type AdminWritable } from '../api/capabilities'

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

  const loadStats = useCallback((graph: string) => {
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
          if (aliveRef.current) {
            setDefaultGraphStats({
              nodes: scalarCount(nodesResp),
              edges: scalarCount(edgesResp),
            })
          }
        },
        (e) => {
          if (aliveRef.current) setStatsError(errMsg(e))
        }
      )
      .finally(() => {
        if (aliveRef.current) setStatsLoading(false)
      })
  }, [])

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
