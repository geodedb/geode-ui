import { streamQuery, type StreamMsg } from '../lib/queryStream'

// CLUSTER_STATUS_STMT is the GQL statement the SPA submits to retrieve
// cluster state. Geode's executor returns one row per cluster member with
// columns (node_id, role, term, leader_id, endpoint, last_contact_ms).
// In standalone mode the server returns exactly one row with
// role='standalone' so every caller can rely on a non-empty result set.
export const CLUSTER_STATUS_STMT = 'SHOW CLUSTER STATUS'

export type ClusterRole =
  | 'standalone'
  | 'leader'
  | 'follower'
  | 'candidate'
  | 'shutdown'
  | 'unknown'

export interface ClusterMember {
  nodeId: number
  role: ClusterRole
  term: number
  leaderId: number
  endpoint: string
  lastContactMs: number
}

const KNOWN_ROLES: ReadonlySet<string> = new Set([
  'standalone',
  'leader',
  'follower',
  'candidate',
  'shutdown',
])

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function toRole(v: unknown): ClusterRole {
  if (typeof v !== 'string') return 'unknown'
  return KNOWN_ROLES.has(v) ? (v as ClusterRole) : 'unknown'
}

// parseClusterStatusRows normalises the wire row shape into a typed
// ClusterMember[]. Malformed rows (wrong arity, unusable node_id) are
// dropped silently so a single bad row doesn't break the dashboard;
// callers always get a clean array.
export function parseClusterStatusRows(rows: unknown[][]): ClusterMember[] {
  const out: ClusterMember[] = []
  rows.forEach((row) => {
    if (row.length < 6) return
    const nodeId = toNumber(row[0])
    if (nodeId === null) return
    const role = toRole(row[1])
    const term = toNumber(row[2]) ?? 0
    const leaderId = toNumber(row[3]) ?? 0
    const endpoint = typeof row[4] === 'string' ? row[4] : ''
    const lastContactMs = toNumber(row[5]) ?? 0
    out.push({ nodeId, role, term, leaderId, endpoint, lastContactMs })
  })
  return out
}

// isClusterMode reports whether the connected backend is participating
// in a Raft cluster. Standalone-mode servers return exactly one row with
// role='standalone'; anything else (and any multi-row response) means a
// cluster is wired. An empty response is treated as not-a-cluster — the
// only way to observe it is a backend that misbehaves, and rendering the
// cluster surfaces against it would be misleading.
export function isClusterMode(members: ClusterMember[]): boolean {
  if (members.length === 0) return false
  if (members.length > 1) return true
  return members[0]!.role !== 'standalone'
}

export interface ClusterStatusSnapshot {
  members: ClusterMember[]
  // selfNodeId is the node_id we believe corresponds to this connection.
  // The server emits "self" as row 0, so we propagate that here for the
  // UI's "this is you" highlighting on the cluster page (Plan 2).
  selfNodeId: number | null
  // fetchedAt is the wall-clock epoch ms the SPA finished reading rows.
  fetchedAt: number
}

// fetchClusterStatus issues a single SHOW CLUSTER STATUS over the
// streaming WS transport and resolves with the parsed snapshot. The
// hook in useClusterStatus.ts owns lifecycle (polling, cancellation);
// this fetcher only handles one round-trip and the Promise rejects with
// an Error carrying the server's error message on stream-level failures.
export function fetchClusterStatus(): Promise<ClusterStatusSnapshot> {
  return new Promise((resolve, reject) => {
    const rows: unknown[][] = []
    let failed: Error | null = null
    let settled = false
    const handle = streamQuery(
      CLUSTER_STATUS_STMT,
      undefined,
      (m: StreamMsg) => {
        if (m.kind === 'row') {
          rows.push(m.row)
        } else if (m.kind === 'rowBatch') {
          m.rows.forEach((r) => rows.push(r))
        } else if (m.kind === 'error') {
          failed = new Error(`${m.code}: ${m.message}`)
        }
        // 'schema' / 'summary' / 'end' carry no row payload here.
      }
    )
    handle.done.then(() => {
      if (settled) return
      settled = true
      if (failed) {
        reject(failed)
        return
      }
      const members = parseClusterStatusRows(rows)
      const selfNodeId = members.length > 0 ? members[0]!.nodeId : null
      resolve({ members, selfNodeId, fetchedAt: Date.now() })
    })
  })
}
