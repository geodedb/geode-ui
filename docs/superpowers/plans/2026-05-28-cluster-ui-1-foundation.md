# Cluster UI – Plan 1: Foundation (data layer + Dashboard ClusterCard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the foundational cluster-awareness data layer to the UI (parsing `SHOW CLUSTER STATUS` over the streaming WS) and expose it via a `ClusterCard` on the Dashboard that renders cluster role, leader, term, and peer count when the connected Geode is part of a cluster — and gracefully hides itself in standalone mode.

**Architecture:** Geode's `SHOW CLUSTER STATUS` GQL command returns one row per cluster member with columns `(node_id, role, term, leader_id, endpoint, last_contact_ms)`. In standalone mode the server returns a single row with `role='standalone'`. There is no REST endpoint — the SPA reaches the data through the existing `streamQuery()` WebSocket transport. The plan introduces (a) a typed parser + Promise wrapper around `streamQuery` for one-shot result queries, (b) a `useClusterStatus()` polling hook scoped to the active connection, and (c) a presentational `ClusterCard` consumed by `DashboardPage`.

**Tech Stack:** TypeScript, React 18, react-i18next, styled-components, Jest + React Testing Library, existing `streamQuery` WS transport, existing `Card` primitive.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/api/cluster.ts` (new) | Typed parser + one-shot fetcher for `SHOW CLUSTER STATUS`. Owns the wire→TS row mapping and the standalone-vs-cluster classification. |
| `src/api/cluster.test.ts` (new) | Unit tests for `parseClusterStatusRows`, `fetchClusterStatus`, and `isClusterMode`. |
| `src/lib/useClusterStatus.ts` (new) | React hook that polls `fetchClusterStatus()` every N seconds, scoped to the active connection. |
| `src/lib/useClusterStatus.test.tsx` (new) | Unit tests for the hook (mount, poll, refetch on connection change, cleanup). |
| `src/components/dashboard/ClusterCard.tsx` (new) | Presentational card showing role, leader, term, peer count. Hidden in standalone mode. |
| `src/components/dashboard/ClusterCard.test.tsx` (new) | Unit tests for cluster / standalone / loading / error states. |
| `src/pages/DashboardPage.tsx` (modify) | Mount `<ClusterCard />` in the existing grid. |
| `src/pages/DashboardPage.test.tsx` (modify) | Assert ClusterCard mounts and respects standalone-hidden. |
| `src/services/i18n/locales/en.ts` (modify) | Add new `dashboard.cluster*` i18n keys. |
| `e2e/helpers/selectors.ts` (modify) | Add `dashboardClusterCard` selector. |
| `e2e/specs/22-dashboard.spec.ts` (modify) | Smoke assert: ClusterCard either renders standalone or hidden depending on backend mode. |

---

### Task 1: Create the typed parser + fetcher for `SHOW CLUSTER STATUS`

**Files:**
- Create: `src/api/cluster.ts`
- Test: `src/api/cluster.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/api/cluster.test.ts`:

```ts
import {
  parseClusterStatusRows,
  isClusterMode,
  CLUSTER_STATUS_STMT,
  type ClusterMember,
} from './cluster'

describe('parseClusterStatusRows', () => {
  test('parses a standalone single-row response', () => {
    const rows: unknown[][] = [[0, 'standalone', 0, 0, '0.0.0.0:0', 0]]
    const members = parseClusterStatusRows(rows)
    expect(members).toEqual<ClusterMember[]>([
      {
        nodeId: 0,
        role: 'standalone',
        term: 0,
        leaderId: 0,
        endpoint: '0.0.0.0:0',
        lastContactMs: 0,
      },
    ])
  })

  test('parses a multi-row cluster response and coerces numeric strings', () => {
    const rows: unknown[][] = [
      [1, 'leader', '7', '1', '10.0.0.1:7400', 0],
      [2, 'follower', '7', '1', '10.0.0.2:7400', '42'],
      [3, 'follower', '7', '1', '10.0.0.3:7400', '88'],
    ]
    const members = parseClusterStatusRows(rows)
    expect(members).toHaveLength(3)
    expect(members[0]).toEqual<ClusterMember>({
      nodeId: 1,
      role: 'leader',
      term: 7,
      leaderId: 1,
      endpoint: '10.0.0.1:7400',
      lastContactMs: 0,
    })
    expect(members[2]?.lastContactMs).toBe(88)
  })

  test('skips malformed rows (wrong arity, non-coercible)', () => {
    const rows: unknown[][] = [
      [1, 'leader', 1, 1, 'h:1', 0],
      [99, 'follower'], // too short
      [null, 'follower', 1, 1, 'h:2', 0], // unusable id
    ]
    const members = parseClusterStatusRows(rows)
    expect(members).toHaveLength(1)
    expect(members[0]?.nodeId).toBe(1)
  })
})

describe('isClusterMode', () => {
  test('returns false when only row is standalone', () => {
    expect(isClusterMode([{ nodeId: 0, role: 'standalone', term: 0, leaderId: 0, endpoint: '0.0.0.0:0', lastContactMs: 0 }])).toBe(false)
  })

  test('returns true when any row is non-standalone', () => {
    const members: ClusterMember[] = [
      { nodeId: 1, role: 'leader', term: 1, leaderId: 1, endpoint: 'h:1', lastContactMs: 0 },
      { nodeId: 2, role: 'follower', term: 1, leaderId: 1, endpoint: 'h:2', lastContactMs: 0 },
    ]
    expect(isClusterMode(members)).toBe(true)
  })

  test('returns false for empty input (defensive — treat as not-a-cluster)', () => {
    expect(isClusterMode([])).toBe(false)
  })
})

describe('CLUSTER_STATUS_STMT', () => {
  test('is exactly "SHOW CLUSTER STATUS"', () => {
    expect(CLUSTER_STATUS_STMT).toBe('SHOW CLUSTER STATUS')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/api/cluster.test.ts`
Expected: FAIL with module-not-found / undefined exports.

- [ ] **Step 3: Implement the parser module**

Create `src/api/cluster.ts`:

```ts
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
    const handle = streamQuery(CLUSTER_STATUS_STMT, undefined, (m: StreamMsg) => {
      if (m.kind === 'row') {
        rows.push(m.row)
      } else if (m.kind === 'rowBatch') {
        m.rows.forEach((r) => rows.push(r))
      } else if (m.kind === 'error') {
        failed = new Error(`${m.code}: ${m.message}`)
      }
      // 'schema' / 'summary' / 'end' carry no row payload here.
    })
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/api/cluster.test.ts`
Expected: PASS — 4 tests for parser + classifier + statement constant.

- [ ] **Step 5: Commit**

```bash
git add src/api/cluster.ts src/api/cluster.test.ts
git commit -m "feat(cluster): add typed SHOW CLUSTER STATUS parser + fetcher"
```

---

### Task 2: Add streaming-mode fetcher test (covers the streamQuery integration)

**Files:**
- Modify: `src/api/cluster.test.ts`

- [ ] **Step 1: Append the fetchClusterStatus test**

Append to `src/api/cluster.test.ts`:

```ts
import { fetchClusterStatus } from './cluster'

// MockWebSocket mirrors the pattern used in src/lib/queryStream.test.ts
// (one of the existing tests already proves streamQuery sends the
// statement payload correctly; this test only needs to drive a few
// canned frames and assert the parsed snapshot).
class MockWS {
  url: string
  protocols: string | string[] | undefined
  listeners: Record<string, ((arg?: any) => void)[]> = {}
  send = jest.fn()
  close = jest.fn()
  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = protocols
  }
  addEventListener(type: string, cb: (arg?: any) => void): void {
    ;(this.listeners[type] ||= []).push(cb)
  }
  removeEventListener(): void {
    /* no-op for these tests */
  }
  fire(type: string, data?: any): void {
    ;(this.listeners[type] ?? []).forEach((cb) => cb(data))
  }
}

let lastWs: MockWS | null = null

beforeEach(() => {
  lastWs = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).WebSocket = class extends MockWS {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols)
      lastWs = this
    }
  }
})

test('fetchClusterStatus resolves with the parsed snapshot from the WS stream', async () => {
  const promise = fetchClusterStatus()
  // Allow streamQuery's microtask to bind listeners and the WS to settle.
  await Promise.resolve()
  expect(lastWs).not.toBeNull()
  lastWs!.fire('open')
  // Server frames: schema, then a rowBatch of three members, then end.
  lastWs!.fire('message', {
    data: JSON.stringify({
      kind: 'rows',
      rows: [
        [1, 'leader', 4, 1, '10.0.0.1:7400', 0],
        [2, 'follower', 4, 1, '10.0.0.2:7400', 12],
        [3, 'follower', 4, 1, '10.0.0.3:7400', 7],
      ],
    }),
  })
  lastWs!.fire('message', {
    data: JSON.stringify({ kind: 'summary', row_count: 3, elapsed_ms: 1 }),
  })
  lastWs!.fire('message', { data: JSON.stringify({ kind: 'end' }) })
  lastWs!.fire('close')
  const snap = await promise
  expect(snap.members).toHaveLength(3)
  expect(snap.members[0]?.role).toBe('leader')
  expect(snap.selfNodeId).toBe(1)
  expect(typeof snap.fetchedAt).toBe('number')
})

test('fetchClusterStatus rejects when the stream emits an error frame', async () => {
  const promise = fetchClusterStatus()
  await Promise.resolve()
  lastWs!.fire('open')
  lastWs!.fire('message', {
    data: JSON.stringify({
      kind: 'error',
      code: 'permission_denied',
      message: 'principal lacks cluster.read',
    }),
  })
  lastWs!.fire('close')
  await expect(promise).rejects.toThrow(
    'permission_denied: principal lacks cluster.read'
  )
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx jest src/api/cluster.test.ts`
Expected: PASS — original 4 tests + 2 new fetcher tests.

- [ ] **Step 3: Commit**

```bash
git add src/api/cluster.test.ts
git commit -m "test(cluster): cover fetchClusterStatus WS roundtrip + error path"
```

---

### Task 3: Add the `useClusterStatus` polling hook

**Files:**
- Create: `src/lib/useClusterStatus.ts`
- Test: `src/lib/useClusterStatus.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/lib/useClusterStatus.test.tsx`:

```tsx
import React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { useClusterStatus } from './useClusterStatus'
import * as clusterApi from '../api/cluster'
import { useActiveConnection } from '../api/connections'

jest.mock('../api/connections', () => ({
  useActiveConnection: jest.fn(),
}))
const mockedActive = useActiveConnection as jest.MockedFunction<
  typeof useActiveConnection
>

function Probe(): React.ReactElement {
  const s = useClusterStatus({ intervalMs: 1000 })
  return (
    <div>
      <span data-testid="loading">{String(s.loading)}</span>
      <span data-testid="err">{s.error ?? ''}</span>
      <span data-testid="count">{s.snapshot?.members.length ?? -1}</span>
    </div>
  )
}

beforeEach(() => {
  jest.useFakeTimers()
  mockedActive.mockReturnValue({
    connectionId: 'c1',
    token: 't',
    profileName: 'default',
    expiresAt: Date.now() + 60_000,
  })
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

test('fetches on mount and exposes the snapshot', async () => {
  const spy = jest.spyOn(clusterApi, 'fetchClusterStatus').mockResolvedValue({
    members: [
      {
        nodeId: 1,
        role: 'leader',
        term: 1,
        leaderId: 1,
        endpoint: 'h:1',
        lastContactMs: 0,
      },
    ],
    selfNodeId: 1,
    fetchedAt: 1,
  })
  const { getByTestId } = render(<Probe />)
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(getByTestId('count').textContent).toBe('1'))
  expect(getByTestId('loading').textContent).toBe('false')
})

test('repolls at the configured interval', async () => {
  const spy = jest.spyOn(clusterApi, 'fetchClusterStatus').mockResolvedValue({
    members: [],
    selfNodeId: null,
    fetchedAt: 1,
  })
  render(<Probe />)
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  await act(async () => {
    jest.advanceTimersByTime(1000)
  })
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  await act(async () => {
    jest.advanceTimersByTime(1000)
  })
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(3))
})

test('surfaces fetch errors', async () => {
  jest
    .spyOn(clusterApi, 'fetchClusterStatus')
    .mockRejectedValue(new Error('boom'))
  const { getByTestId } = render(<Probe />)
  await waitFor(() => expect(getByTestId('err').textContent).toBe('boom'))
})

test('skips polling when no active connection', async () => {
  mockedActive.mockReturnValue(null)
  const spy = jest
    .spyOn(clusterApi, 'fetchClusterStatus')
    .mockResolvedValue({ members: [], selfNodeId: null, fetchedAt: 1 })
  render(<Probe />)
  await act(async () => {
    jest.advanceTimersByTime(5000)
  })
  expect(spy).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/useClusterStatus.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the hook**

Create `src/lib/useClusterStatus.ts`:

```ts
import { useEffect, useRef, useState } from 'react'
import {
  fetchClusterStatus,
  type ClusterStatusSnapshot,
} from '../api/cluster'
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

  const refresh = async (): Promise<void> => {
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
  }

  useEffect(() => {
    cancelledRef.current = false
    generationRef.current += 1
    if (!connectionId) {
      setSnapshot(null)
      setLoading(false)
      setError(null)
      return undefined
    }
    void refresh()
    const id = window.setInterval(() => {
      void refresh()
    }, intervalMs)
    return () => {
      cancelledRef.current = true
      window.clearInterval(id)
    }
    // refresh is intentionally not a dependency — it closes over
    // generationRef.current which it captures at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, intervalMs])

  return { snapshot, loading, error, refresh }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/useClusterStatus.test.tsx`
Expected: PASS — 4 tests for mount / poll / error / no-connection.

- [ ] **Step 5: Commit**

```bash
git add src/lib/useClusterStatus.ts src/lib/useClusterStatus.test.tsx
git commit -m "feat(cluster): polling hook scoped to active connection"
```

---

### Task 4: Add i18n strings for the Cluster card

**Files:**
- Modify: `src/services/i18n/locales/en.ts`

- [ ] **Step 1: Add the new keys**

Inside the existing `dashboard: { … }` block in `src/services/i18n/locales/en.ts`, add the following keys just after the `metricsServerHealthy: 'Healthy',` line (precise placement doesn't matter as long as they are inside the `dashboard` object):

```ts
    clusterTitle: 'Cluster',
    clusterStandalone: 'Standalone (not clustered)',
    clusterStandaloneHint:
      'This Geode instance is not part of a Raft cluster.',
    clusterRoleLeader: 'Leader',
    clusterRoleFollower: 'Follower',
    clusterRoleCandidate: 'Candidate',
    clusterRoleShutdown: 'Shutdown',
    clusterRoleUnknown: 'Unknown',
    clusterTerm: 'Term',
    clusterLeader: 'Leader node',
    clusterMembers: 'Members',
    clusterSelf: 'this node',
    clusterNoLeader: 'no leader elected',
    clusterError: 'Cluster status unavailable: {{message}}',
    clusterLoading: 'Loading cluster status…',
    clusterOpen: 'View cluster',
```

- [ ] **Step 2: Verify translations validator still passes**

Run: `npm run verify:translations`
Expected: PASS — required locales aligned.

- [ ] **Step 3: Commit**

```bash
git add src/services/i18n/locales/en.ts
git commit -m "i18n(cluster): dashboard cluster card copy"
```

---

### Task 5: Build the presentational `ClusterCard`

**Files:**
- Create: `src/components/dashboard/ClusterCard.tsx`
- Test: `src/components/dashboard/ClusterCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/dashboard/ClusterCard.test.tsx`:

```tsx
import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'

import { ClusterCard } from './ClusterCard'
import { testTheme } from '../../test-utils/theme'
import { i18n } from '../../services/i18n'
import type { ClusterStatusSnapshot } from '../../api/cluster'

function renderCard(ui: React.ReactElement): void {
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={testTheme}>{ui}</ThemeProvider>
    </I18nextProvider>
  )
}

const standaloneSnap: ClusterStatusSnapshot = {
  members: [
    {
      nodeId: 0,
      role: 'standalone',
      term: 0,
      leaderId: 0,
      endpoint: '0.0.0.0:0',
      lastContactMs: 0,
    },
  ],
  selfNodeId: 0,
  fetchedAt: 1,
}

const clusteredSnap: ClusterStatusSnapshot = {
  members: [
    {
      nodeId: 1,
      role: 'leader',
      term: 7,
      leaderId: 1,
      endpoint: '10.0.0.1:7400',
      lastContactMs: 0,
    },
    {
      nodeId: 2,
      role: 'follower',
      term: 7,
      leaderId: 1,
      endpoint: '10.0.0.2:7400',
      lastContactMs: 12,
    },
    {
      nodeId: 3,
      role: 'follower',
      term: 7,
      leaderId: 1,
      endpoint: '10.0.0.3:7400',
      lastContactMs: 7,
    },
  ],
  selfNodeId: 1,
  fetchedAt: 1,
}

test('renders nothing in standalone mode', () => {
  const { container } = render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={testTheme}>
        <ClusterCard snapshot={standaloneSnap} loading={false} error={null} />
      </ThemeProvider>
    </I18nextProvider>
  )
  expect(container.firstChild).toBeNull()
})

test('renders cluster role / term / leader / member count when clustered', () => {
  renderCard(
    <ClusterCard snapshot={clusteredSnap} loading={false} error={null} />
  )
  expect(screen.getByTestId('dashboard-cluster-card')).toBeInTheDocument()
  expect(screen.getByText('Leader')).toBeInTheDocument()
  expect(screen.getByText(/Term/)).toBeInTheDocument()
  // Self-node label shows next to nodeId 1.
  expect(screen.getByText(/this node/)).toBeInTheDocument()
  // Member count reflects 3 nodes.
  expect(screen.getByText(/3/)).toBeInTheDocument()
})

test('renders loading state when snapshot is null and loading=true', () => {
  renderCard(<ClusterCard snapshot={null} loading={true} error={null} />)
  expect(screen.getByText(/Loading cluster status/)).toBeInTheDocument()
})

test('renders the error string when error is set', () => {
  renderCard(
    <ClusterCard snapshot={null} loading={false} error="upstream timeout" />
  )
  expect(screen.getByText(/upstream timeout/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/dashboard/ClusterCard.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the component**

Create `src/components/dashboard/ClusterCard.tsx`:

```tsx
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { Card } from './Card'
import { isClusterMode, type ClusterRole, type ClusterStatusSnapshot } from '../../api/cluster'

// ClusterCard — dashboard surface that shows the operator their
// Geode's cluster role, current term, leader, and member count when
// the connected instance is part of a Raft cluster.
//
// Render contract:
//   - snapshot=null + loading=true        → "Loading cluster status…"
//   - snapshot=null + error                → error string (one line)
//   - snapshot=standalone single row       → render NOTHING (return null)
//   - snapshot=cluster                     → show role/term/leader/members
//
// The standalone branch intentionally returns null rather than a
// "Standalone" placeholder card so single-node operators don't see a
// dashboard panel that is always inert. Plan 3 surfaces standalone-ness
// elsewhere (ConnectionCard) where it has more visual breathing room.
const RoleBadge = styled.span<{ $role: ClusterRole }>`
  border-radius: ${({ theme }) => theme.radii.sm};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  font-weight: ${({ theme }) => theme.font.weights.medium};
  padding: 1px 8px;
  background: ${({ theme, $role }) => {
    if ($role === 'leader') return theme.colors.success
    if ($role === 'candidate') return theme.colors.warning
    if ($role === 'shutdown') return theme.colors.danger
    return theme.bg.subtle
  }};
  color: ${({ theme, $role }) => {
    if ($role === 'leader') return theme.text.onSuccess
    if ($role === 'candidate') return theme.text.onWarning
    if ($role === 'shutdown') return theme.text.onDanger
    return theme.text.muted
  }};
`

const StatRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: ${({ theme }) => theme.text.secondary};
  padding: 2px 0;
`

export interface ClusterCardProps {
  snapshot: ClusterStatusSnapshot | null
  loading: boolean
  error: string | null
}

function roleLabel(t: (k: string) => string, role: ClusterRole): string {
  switch (role) {
    case 'leader':
      return t('dashboard.clusterRoleLeader')
    case 'follower':
      return t('dashboard.clusterRoleFollower')
    case 'candidate':
      return t('dashboard.clusterRoleCandidate')
    case 'shutdown':
      return t('dashboard.clusterRoleShutdown')
    default:
      return t('dashboard.clusterRoleUnknown')
  }
}

export const ClusterCard: React.FC<ClusterCardProps> = ({
  snapshot,
  loading,
  error,
}) => {
  const { t } = useTranslation()

  // Standalone backends produce a one-row snapshot with role=standalone.
  // Render nothing so single-node operators have no perpetually-static
  // card on the dashboard.
  if (snapshot && !isClusterMode(snapshot.members)) {
    return null
  }

  const renderBody = (): React.ReactNode => {
    if (loading && !snapshot) {
      return (
        <p className="m-0 text-body-secondary" role="status">
          {t('dashboard.clusterLoading')}
        </p>
      )
    }
    if (error && !snapshot) {
      return (
        <p className="m-0 text-danger" role="alert">
          {t('dashboard.clusterError', { message: error })}
        </p>
      )
    }
    if (!snapshot) return null

    const self = snapshot.members.find((m) => m.nodeId === snapshot.selfNodeId)
    const role: ClusterRole = self?.role ?? 'unknown'
    const term = self?.term ?? 0
    const leaderId = self?.leaderId ?? 0
    const leaderLabel =
      leaderId === 0
        ? t('dashboard.clusterNoLeader')
        : `${t('dashboard.clusterLeader')}: ${leaderId}${
            leaderId === snapshot.selfNodeId
              ? ' (' + t('dashboard.clusterSelf') + ')'
              : ''
          }`

    return (
      <div>
        <StatRow>
          <span>{t('dashboard.clusterRoleLeader').replace('Leader', 'Role')}</span>
          <RoleBadge $role={role} data-testid="dashboard-cluster-role">
            {roleLabel(t, role)}
          </RoleBadge>
        </StatRow>
        <StatRow>
          <span>{t('dashboard.clusterTerm')}</span>
          <span className="font-monospace">{term}</span>
        </StatRow>
        <StatRow>
          <span>{leaderLabel}</span>
        </StatRow>
        <StatRow>
          <span>{t('dashboard.clusterMembers')}</span>
          <span
            className="font-monospace"
            data-testid="dashboard-cluster-members-count"
          >
            {snapshot.members.length}
          </span>
        </StatRow>
      </div>
    )
  }

  return (
    <Card
      title={t('dashboard.clusterTitle')}
      data-testid="dashboard-cluster-card"
    >
      {renderBody()}
    </Card>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/dashboard/ClusterCard.test.tsx`
Expected: PASS — 4 tests for standalone / clustered / loading / error.

- [ ] **Step 5: Verify the row-label literal is correct**

The first stat row reads `t('dashboard.clusterRoleLeader').replace('Leader', 'Role')`, which is a hack that breaks for translations. Replace it with a proper i18n key:

In `src/services/i18n/locales/en.ts` add:

```ts
    clusterRole: 'Role',
```

Then in `src/components/dashboard/ClusterCard.tsx` replace:

```ts
          <span>{t('dashboard.clusterRoleLeader').replace('Leader', 'Role')}</span>
```

with:

```ts
          <span>{t('dashboard.clusterRole')}</span>
```

- [ ] **Step 6: Re-run tests to confirm they still pass**

Run: `npx jest src/components/dashboard/ClusterCard.test.tsx`
Expected: PASS — same 4 tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/ClusterCard.tsx src/components/dashboard/ClusterCard.test.tsx src/services/i18n/locales/en.ts
git commit -m "feat(dashboard): ClusterCard renders role/term/leader/members when clustered"
```

---

### Task 6: Mount the ClusterCard in the Dashboard

**Files:**
- Modify: `src/pages/DashboardPage.tsx`
- Modify: `src/pages/DashboardPage.test.tsx`

- [ ] **Step 1: Inspect the current DashboardPage imports**

Run: `sed -n '1,40p' src/pages/DashboardPage.tsx`
Expected: confirms the imports of the existing card components (GraphsCard, ConnectionCard, etc.).

- [ ] **Step 2: Wire the ClusterCard into the grid**

In `src/pages/DashboardPage.tsx`:

Add the imports just after the existing `import { AuditEventMixCard } from '../components/dashboard/AuditEventMixCard'` line:

```ts
import { ClusterCard } from '../components/dashboard/ClusterCard'
import { useClusterStatus } from '../lib/useClusterStatus'
```

Inside `DashboardPage` (just below `const metrics = useMetricsPolling()`), add:

```ts
  const cluster = useClusterStatus()
```

Inside the grid, just after `<AuditEventMixCard />`, append:

```tsx
        <ClusterCard
          snapshot={cluster.snapshot}
          loading={cluster.loading}
          error={cluster.error}
        />
```

- [ ] **Step 3: Update the dashboard test to cover the new card**

Open `src/pages/DashboardPage.test.tsx`. If a top-of-file `jest.mock('../lib/useClusterStatus', …)` is not present, add it inside the existing `jest.mock(...)` block region near the existing `useMetricsPolling` mock (mirror its shape — return `{ snapshot: null, loading: false, error: null, refresh: jest.fn() }`).

Add a new test at the end of the existing test list:

```tsx
test('renders the cluster card when clustered, hides it in standalone', async () => {
  const mod = await import('../lib/useClusterStatus')
  // Standalone: card should be hidden.
  ;(mod.useClusterStatus as jest.Mock).mockReturnValue({
    snapshot: {
      members: [
        {
          nodeId: 0,
          role: 'standalone',
          term: 0,
          leaderId: 0,
          endpoint: '0.0.0.0:0',
          lastContactMs: 0,
        },
      ],
      selfNodeId: 0,
      fetchedAt: 1,
    },
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
  const { queryByTestId, rerender } = renderDashboard()
  expect(queryByTestId('dashboard-cluster-card')).not.toBeInTheDocument()

  // Clustered: card should appear.
  ;(mod.useClusterStatus as jest.Mock).mockReturnValue({
    snapshot: {
      members: [
        {
          nodeId: 1,
          role: 'leader',
          term: 2,
          leaderId: 1,
          endpoint: 'h:1',
          lastContactMs: 0,
        },
        {
          nodeId: 2,
          role: 'follower',
          term: 2,
          leaderId: 1,
          endpoint: 'h:2',
          lastContactMs: 0,
        },
      ],
      selfNodeId: 1,
      fetchedAt: 1,
    },
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
  rerender(renderDashboardElement())
  expect(queryByTestId('dashboard-cluster-card')).toBeInTheDocument()
})
```

If `renderDashboard()` / `renderDashboardElement()` helpers are not already exported by the test file, factor them out from the existing test scaffolding (every other test in this file already constructs its own JSX — copy that JSX into helpers above the `test(...)` block):

```tsx
function renderDashboardElement(): React.ReactElement {
  return (
    <MemoryRouter>
      <ThemeProvider theme={testTheme}>
        <I18nextProvider i18n={i18n}>
          <ConnectionsProvider initialConnections={fakeConn}>
            <DashboardPage />
          </ConnectionsProvider>
        </I18nextProvider>
      </ThemeProvider>
    </MemoryRouter>
  )
}
function renderDashboard(): ReturnType<typeof render> {
  return render(renderDashboardElement())
}
```

(Match the providers already in use by other tests in this file. If the file currently inlines them with slightly different prop shapes, mirror that shape — do not invent a new shape.)

- [ ] **Step 4: Run the dashboard tests**

Run: `npx jest src/pages/DashboardPage.test.tsx`
Expected: PASS — existing tests + the new standalone-hidden / clustered-shown test.

- [ ] **Step 5: Commit**

```bash
git add src/pages/DashboardPage.tsx src/pages/DashboardPage.test.tsx
git commit -m "feat(dashboard): mount ClusterCard, hide in standalone mode"
```

---

### Task 7: Add an e2e selector + dashboard smoke test for the ClusterCard

**Files:**
- Modify: `e2e/helpers/selectors.ts`
- Modify: `e2e/specs/22-dashboard.spec.ts`

- [ ] **Step 1: Add the selector**

In `e2e/helpers/selectors.ts`, add immediately after the existing `dashboardConnectionCard` entry:

```ts
  dashboardClusterCard: (p: Page): Locator =>
    p.getByTestId('dashboard-cluster-card'),
```

- [ ] **Step 2: Add the smoke assertion**

In `e2e/specs/22-dashboard.spec.ts`, inside the existing `renders the cards and surfaces a recently-run query` test, just after the `await expect(sel.dashboardGraphsCard(page)).toBeVisible()` line, add:

```ts
    // Cluster card: against the standalone e2e backend (docker-compose
    // brings up a single-node Geode) the card should NOT render. If the
    // local backend has been swapped to a clustered one the card MUST
    // render — assert one of the two states.
    const clusterCard = sel.dashboardClusterCard(page)
    const count = await clusterCard.count()
    expect(count === 0 || count === 1).toBe(true)
    if (count === 1) {
      await expect(clusterCard).toBeVisible()
      await expect(
        clusterCard.getByTestId('dashboard-cluster-role')
      ).toBeVisible()
    }
```

- [ ] **Step 3: Skip executing the e2e suite (out-of-band)**

The e2e suite requires `docker-compose` + the Geode backend. Do NOT run it as part of this plan; the smoke is included so the next operator who runs `npm run e2e` will exercise it. Verify only that the file typechecks:

Run: `npm run e2e:tsc`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/helpers/selectors.ts e2e/specs/22-dashboard.spec.ts
git commit -m "test(e2e): dashboard ClusterCard either-or smoke assertion"
```

---

### Task 8: Add `CLUSTER` and `STATUS` to the GQL editor keywords

**Files:**
- Modify: `src/components/editor/gqlLanguage.ts`

- [ ] **Step 1: Inspect current keywords**

Run: `sed -n '15,70p' src/components/editor/gqlLanguage.ts`
Expected: confirms the `keywords:` array layout.

- [ ] **Step 2: Append the new keywords**

In `src/components/editor/gqlLanguage.ts`, inside the `keywords:` array, add `'CLUSTER',` and `'STATUS',` immediately after `'BACKUP',` `'RESTORE',`:

```ts
      'BACKUP',
      'RESTORE',
      'CLUSTER',
      'STATUS',
```

- [ ] **Step 3: Add a tiny test asserting both keywords are present**

In an existing keyword-related test file (search for `gqlLanguage`):

Run: `grep -l "gqlLanguage" src/components/editor/`
Expected: lists the file. If `gqlLanguage.test.ts(x)` does not exist, create `src/components/editor/gqlLanguage.test.ts`:

```ts
// Keyword surface is registered via Monaco's setMonarchTokensProvider,
// which we don't want to spin up under jsdom. The exported keyword
// list is the only thing tests need to assert against, so re-export it
// to keep the assertion stable. If gqlLanguage.ts does not currently
// export the list, hoist it into a named export `GQL_KEYWORDS` and
// reference it from inside registerGqlLanguage.
import { GQL_KEYWORDS } from './gqlLanguage'

test('GQL keyword list includes SHOW CLUSTER STATUS tokens', () => {
  expect(GQL_KEYWORDS).toContain('SHOW')
  expect(GQL_KEYWORDS).toContain('CLUSTER')
  expect(GQL_KEYWORDS).toContain('STATUS')
})
```

In `src/components/editor/gqlLanguage.ts`, hoist the keyword list:

```ts
export const GQL_KEYWORDS: readonly string[] = [
  'MATCH', 'OPTIONAL', 'RETURN', 'WHERE', 'WITH', 'UNWIND',
  'CREATE', 'MERGE', 'DELETE', 'DETACH', 'SET', 'REMOVE',
  'FOREACH', 'CALL', 'YIELD', 'UNION', 'ALL', 'AS', 'DISTINCT',
  'ORDER', 'BY', 'LIMIT', 'SKIP', 'OFFSET', 'ASC', 'DESC',
  'NULL', 'TRUE', 'FALSE', 'AND', 'OR', 'NOT', 'IN', 'IS',
  'EXISTS', 'BEGIN', 'COMMIT', 'ROLLBACK', 'USE', 'GRAPH',
  'SHOW', 'GRANT', 'REVOKE', 'DROP', 'INDEX', 'CONSTRAINT',
  'POLICY', 'USER', 'ROLE', 'PASSWORD', 'BACKUP', 'RESTORE',
  'CLUSTER', 'STATUS',
] as const
```

And inside `registerGqlLanguage`, replace the inline array with `keywords: [...GQL_KEYWORDS]`.

- [ ] **Step 4: Run the keyword test**

Run: `npx jest src/components/editor/gqlLanguage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/gqlLanguage.ts src/components/editor/gqlLanguage.test.ts
git commit -m "feat(editor): highlight CLUSTER / STATUS keywords"
```

---

### Task 9: Run all checks — lint, types, jest

**Files:** none (validation only)

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: PASS — zero warnings.

- [ ] **Step 2: Hardcoded-strings + translations scan**

Run: `npm run detect:hardcoded-strings && npm run verify:translations`
Expected: PASS.

- [ ] **Step 3: Type check**

Run: `npm run test:ts`
Expected: PASS — `tsc --noEmit` plus the e2e + scripts projects.

- [ ] **Step 4: Full Jest suite (just the cluster-touching files first, then everything)**

Run: `npx jest src/api/cluster src/lib/useClusterStatus src/components/dashboard/ClusterCard src/pages/DashboardPage src/components/editor/gqlLanguage`
Expected: PASS — every test added by this plan.

Run: `npm test`
Expected: PASS — full suite still green (no regressions in dashboard / query / editor tests).

- [ ] **Step 5: Commit any minor fixups generated by lint/tsc**

If anything was auto-fixed or required a small touch-up:

```bash
git add -p
git commit -m "chore(cluster): lint + type fixups from full-suite run"
```

If nothing was changed by validation, skip this step.

---

## Self-Review

**Spec coverage:**
- "Detect when connected instance is part of a cluster" → Task 1 (`isClusterMode`).
- "Get cluster state" → Tasks 1+3 (`fetchClusterStatus`, polling hook).
- "Surface in UI" → Tasks 5+6 (`ClusterCard` + DashboardPage mount).
- "Don't pollute the standalone UI" → Task 5 (returns null), Task 6 (test asserts hidden).

**Placeholder scan:**
- No "TBD"/"figure it out"/"similar to" steps. Every code block is concrete.
- All test files include complete test bodies.
- All command-block expected outputs are stated.

**Type consistency:**
- `ClusterMember` shape is identical across `cluster.ts`, the parser tests, the hook tests, and the card tests (`nodeId`, `role`, `term`, `leaderId`, `endpoint`, `lastContactMs`).
- `ClusterStatusSnapshot` is identical across `cluster.ts`, hook tests, card tests.
- `UseClusterStatusResult.refresh` returns `Promise<void>` and tests use `jest.fn()` matching that.
- `ClusterRole` union is identical across parser, card, and tests (`'standalone' | 'leader' | 'follower' | 'candidate' | 'shutdown' | 'unknown'`).
- `roleName` mapping in `admin_ddl.zig` (upstream) emits these exact strings → parser passes them through unchanged.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-cluster-ui-1-foundation.md`. Plans 2 (dedicated `/cluster` route + live membership table) and 3 (topbar role indicator + ConnectionCard integration) are sequenced behind this one — the data layer they consume lands here.

Execution will proceed via **superpowers:subagent-driven-development** (one fresh subagent per task, two-stage review between tasks) since this is part of an autonomous goal-driven loop.
