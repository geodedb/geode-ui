# Cluster UI – Plan 2: Dedicated `/cluster` Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `/cluster` route that renders the full Raft cluster membership table — one row per node with live polling, last-contact freshness, leader highlighting, self-node tagging, manual refresh, error states, and a standalone fallback panel. Wire it into the Shell nav.

**Architecture:** Built on top of Plan 1's data layer (`useClusterStatus()` + `ClusterStatusSnapshot`). A new page component `ClusterPage` consumes the hook with a faster poll interval (5 s instead of 10 s) and renders a single `<MembersTable>` that exposes per-row leader / self / freshness affordances. In standalone mode the page shows a hint card explaining that this Geode is not part of a Raft cluster (rather than redirecting away). The nav link is rendered for every authenticated user; the page itself reads the existing per-connection token via the `streamQuery` transport so no extra capability gate is needed (the GQL execution already enforces `SHOW CLUSTER STATUS` access in Geode).

**Tech Stack:** TypeScript, React 18, react-i18next, react-router-dom v6, styled-components, Jest + React Testing Library, Playwright.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/pages/ClusterPage.tsx` (new) | Page shell, hook wiring, branching between standalone / loading / error / clustered. |
| `src/pages/ClusterPage.test.tsx` (new) | Unit tests for all branches (standalone, loading, error, clustered with leader highlighting, self tag, manual refresh). |
| `src/components/cluster/MembersTable.tsx` (new) | Pure presentational table — sortable not yet; just renders the row set with role badge, self chip, freshness chip. |
| `src/components/cluster/MembersTable.test.tsx` (new) | Unit tests for the table (column header presence, leader row highlighting, freshness coloring, self badge presence on `nodeId === selfNodeId`). |
| `src/components/cluster/formatLastContact.ts` (new) | Helper formatting `lastContactMs` (e.g. `0 → "—"`, `12 → "12 ms"`, `1500 → "1.5 s"`, `90_000 → "1.5 m"`). |
| `src/components/cluster/formatLastContact.test.ts` (new) | Unit tests for the formatter (boundary cases — 0, < 1s, < 1m, < 1h, >= 1h). |
| `src/App.tsx` (modify) | Mount the `/cluster` route inside the existing `ProtectedShell`. |
| `src/App.test.tsx` (modify, if it exists; otherwise add a small route smoke) | Assert `/cluster` mounts the page. |
| `src/components/layout/Shell.tsx` (modify) | Add a Cluster nav link (desktop + mobile drawer) between Schema and Admin. |
| `src/services/i18n/locales/en.ts` (modify) | Re-add `clusterStandalone`, `clusterStandaloneHint`, `clusterOpen` (dropped in Plan 1 because they had no consumer); add new `cluster.*` page-scoped keys. |
| `e2e/helpers/selectors.ts` (modify) | Add `navCluster`, `clusterMembersTable`, `clusterMemberRow`, `clusterRefreshBtn`, `clusterStandalonePanel`. |
| `e2e/specs/30-cluster.spec.ts` (new) | Smoke test: navigate via nav link, assert page renders one of (standalone panel OR members table); click refresh, assert no error. |

---

### Task 1: Add the `formatLastContact` helper

**Files:**
- Create: `src/components/cluster/formatLastContact.ts`
- Test: `src/components/cluster/formatLastContact.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/cluster/formatLastContact.test.ts`:

```ts
import { formatLastContact, lastContactFreshness } from './formatLastContact'

describe('formatLastContact', () => {
  test('returns em-dash for 0 (self / never)', () => {
    expect(formatLastContact(0)).toBe('—')
  })

  test('renders ms granularity below 1 second', () => {
    expect(formatLastContact(1)).toBe('1 ms')
    expect(formatLastContact(999)).toBe('999 ms')
  })

  test('renders seconds with one decimal below 60 s', () => {
    expect(formatLastContact(1000)).toBe('1.0 s')
    expect(formatLastContact(1500)).toBe('1.5 s')
    expect(formatLastContact(59_900)).toBe('59.9 s')
  })

  test('renders minutes below 60 m', () => {
    expect(formatLastContact(60_000)).toBe('1.0 m')
    expect(formatLastContact(90_000)).toBe('1.5 m')
    expect(formatLastContact(59 * 60_000)).toBe('59.0 m')
  })

  test('renders hours at and above 60 m', () => {
    expect(formatLastContact(60 * 60_000)).toBe('1.0 h')
    expect(formatLastContact(2 * 60 * 60_000)).toBe('2.0 h')
  })

  test('treats negative input as 0 (clock skew safety)', () => {
    expect(formatLastContact(-5)).toBe('—')
  })
})

describe('lastContactFreshness', () => {
  test('"self" for 0', () => {
    expect(lastContactFreshness(0)).toBe('self')
  })
  test('"fresh" under 2 seconds', () => {
    expect(lastContactFreshness(1)).toBe('fresh')
    expect(lastContactFreshness(1999)).toBe('fresh')
  })
  test('"stale" between 2 s and 30 s', () => {
    expect(lastContactFreshness(2000)).toBe('stale')
    expect(lastContactFreshness(29_999)).toBe('stale')
  })
  test('"lost" at or above 30 s', () => {
    expect(lastContactFreshness(30_000)).toBe('lost')
    expect(lastContactFreshness(120_000)).toBe('lost')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/cluster/formatLastContact.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the helper**

Create `src/components/cluster/formatLastContact.ts`:

```ts
// formatLastContact renders the `last_contact_ms` field from
// SHOW CLUSTER STATUS in operator-friendly units. The server emits
// `last_contact_ms` as the delta between "now" (on the server) and
// the last successful contact with that peer; self-rows always emit
// 0 (we are talking to ourselves). Negative values can occur if the
// server clock jumped backward between probes — clamp to 0 so the
// table never shows a confusing negative duration.
export function formatLastContact(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  if (ms < 60 * 60_000) return `${(ms / 60_000).toFixed(1)} m`
  return `${(ms / (60 * 60_000)).toFixed(1)} h`
}

// lastContactFreshness classifies a peer's freshness into one of four
// states used by the table's row coloring:
//   - 'self'   → render no chip; this is us.
//   - 'fresh'  → contacted within the last 2 s (typical heartbeat).
//   - 'stale'  → contacted between 2 s and 30 s ago (transient blip).
//   - 'lost'   → no contact for >= 30 s; likely partitioned or down.
// Thresholds chosen to align with the operator-facing semantics:
// "fresh" should cover the normal AppendEntries cadence (~100 ms);
// "lost" should match the leader-election timeout window after which
// most operators consider a peer down. The middle "stale" band gives
// a yellow-flag affordance without crying wolf at every burst.
export type Freshness = 'self' | 'fresh' | 'stale' | 'lost'

export function lastContactFreshness(ms: number): Freshness {
  if (!Number.isFinite(ms) || ms <= 0) return 'self'
  if (ms < 2000) return 'fresh'
  if (ms < 30_000) return 'stale'
  return 'lost'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/cluster/formatLastContact.test.ts`
Expected: PASS — 10 assertions (6 formatter + 4 freshness).

- [ ] **Step 5: Commit**

```bash
git add src/components/cluster/formatLastContact.ts src/components/cluster/formatLastContact.test.ts
git commit -m "feat(cluster): formatLastContact + freshness classifier"
```

---

### Task 2: Add i18n strings for the cluster page

**Files:**
- Modify: `src/services/i18n/locales/en.ts`

- [ ] **Step 1: Identify the home for the new keys**

Run: `grep -n "^  cluster: {" src/services/i18n/locales/en.ts`
Expected: NO match (no top-level `cluster` namespace yet — we will add one alongside `dashboard`).

- [ ] **Step 2: Add the cluster namespace**

In `src/services/i18n/locales/en.ts`, add a NEW top-level object literal `cluster: { ... }` immediately after the `dashboard: { ... }` block. The new keys are page-scoped and should not pollute the dashboard namespace. Add an entry for the new nav link inside the existing `nav: { ... }` block as well.

Inside `nav:` add:

```ts
    cluster: 'Cluster',
```

After the `dashboard: { … }` block add:

```ts
  cluster: {
    title: 'Cluster',
    subtitle:
      'Live Raft cluster membership for the connected Geode instance.',
    refresh: 'Refresh',
    refreshAria: 'Refresh cluster status',
    refreshing: 'Refreshing…',
    lastUpdated: 'Last updated {{when}}',
    standaloneTitle: 'Standalone instance',
    standaloneBody:
      'This Geode instance is not part of a Raft cluster. Start Geode with --cluster-port and --peers (or set GEODE_CLUSTER_TOKEN) to enable distributed mode.',
    errorTitle: 'Cluster status unavailable',
    loading: 'Loading cluster status…',
    membersHeading: 'Members',
    selfBadge: 'this node',
    leaderBadge: 'leader',
    followerBadge: 'follower',
    candidateBadge: 'candidate',
    shutdownBadge: 'shutdown',
    unknownBadge: 'unknown',
    freshnessFresh: 'fresh',
    freshnessStale: 'stale',
    freshnessLost: 'lost',
    columnNodeId: 'Node',
    columnRole: 'Role',
    columnTerm: 'Term',
    columnLeader: 'Leader',
    columnEndpoint: 'Endpoint',
    columnLastContact: 'Last contact',
  },
```

- [ ] **Step 3: Verify the translations validator**

Run: `npm run verify:translations`
Expected: PASS — 0 missing, 0 orphan in `en`. (Orphan keys will fail this gate; every key above is consumed in Task 3 or Task 4.)

- [ ] **Step 4: Commit**

```bash
git add src/services/i18n/locales/en.ts
git commit -m "feat(i18n): cluster page namespace"
```

---

### Task 3: Build the `MembersTable` presentational component

**Files:**
- Create: `src/components/cluster/MembersTable.tsx`
- Test: `src/components/cluster/MembersTable.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/cluster/MembersTable.test.tsx`:

```tsx
import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'

import { MembersTable } from './MembersTable'
import { testTheme } from '../../test-utils/theme'
import { i18n } from '../../services/i18n'
import type { ClusterMember } from '../../api/cluster'

function renderTable(ui: React.ReactElement): void {
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={testTheme}>{ui}</ThemeProvider>
    </I18nextProvider>
  )
}

const members: ClusterMember[] = [
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
    lastContactMs: 45_000,
  },
]

test('renders all six column headers', () => {
  renderTable(<MembersTable members={members} selfNodeId={1} />)
  expect(screen.getByRole('columnheader', { name: 'Node' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Role' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Term' })).toBeInTheDocument()
  expect(
    screen.getByRole('columnheader', { name: 'Leader' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('columnheader', { name: 'Endpoint' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('columnheader', { name: 'Last contact' })
  ).toBeInTheDocument()
})

test('renders one row per member with the right data', () => {
  renderTable(<MembersTable members={members} selfNodeId={1} />)
  const rows = screen.getAllByTestId('cluster-member-row')
  expect(rows).toHaveLength(3)
  expect(within(rows[0]!).getByText('10.0.0.1:7400')).toBeInTheDocument()
  expect(within(rows[1]!).getByText('10.0.0.2:7400')).toBeInTheDocument()
  expect(within(rows[2]!).getByText('10.0.0.3:7400')).toBeInTheDocument()
})

test('marks the self row with the self badge and a data-self="true" attribute', () => {
  renderTable(<MembersTable members={members} selfNodeId={2} />)
  const rows = screen.getAllByTestId('cluster-member-row')
  expect(rows[0]).toHaveAttribute('data-self', 'false')
  expect(rows[1]).toHaveAttribute('data-self', 'true')
  expect(within(rows[1]!).getByText(/this node/i)).toBeInTheDocument()
})

test('marks the leader row with data-leader="true"', () => {
  renderTable(<MembersTable members={members} selfNodeId={1} />)
  const rows = screen.getAllByTestId('cluster-member-row')
  expect(rows[0]).toHaveAttribute('data-leader', 'true')
  expect(rows[1]).toHaveAttribute('data-leader', 'false')
})

test('formats freshness — fresh (< 2s), stale (2-30s), lost (>= 30s)', () => {
  const variedMembers: ClusterMember[] = [
    { ...members[0]!, nodeId: 10, lastContactMs: 0 },
    { ...members[1]!, nodeId: 11, lastContactMs: 500 },
    { ...members[2]!, nodeId: 12, lastContactMs: 5000 },
    { ...members[2]!, nodeId: 13, lastContactMs: 90_000 },
  ]
  renderTable(<MembersTable members={variedMembers} selfNodeId={10} />)
  const rows = screen.getAllByTestId('cluster-member-row')
  expect(rows[0]).toHaveAttribute('data-freshness', 'self')
  expect(rows[1]).toHaveAttribute('data-freshness', 'fresh')
  expect(rows[2]).toHaveAttribute('data-freshness', 'stale')
  expect(rows[3]).toHaveAttribute('data-freshness', 'lost')
})

test('renders empty state when members is empty', () => {
  renderTable(<MembersTable members={[]} selfNodeId={null} />)
  expect(screen.queryByTestId('cluster-member-row')).not.toBeInTheDocument()
  // The table itself still renders (the operator should see "Members" + headers).
  expect(
    screen.getByRole('columnheader', { name: 'Node' })
  ).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/cluster/MembersTable.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the table**

Create `src/components/cluster/MembersTable.tsx`:

```tsx
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { ClusterMember, ClusterRole } from '../../api/cluster'
import {
  formatLastContact,
  lastContactFreshness,
  type Freshness,
} from './formatLastContact'

// MembersTable — pure presentational table of cluster members.
//
// Rendering contract:
//   - 6 column headers (semantic role="columnheader").
//   - One <tr data-testid="cluster-member-row"> per ClusterMember.
//   - Each row carries machine-readable attributes for tests / styling:
//       data-self      ("true" if nodeId === selfNodeId, else "false")
//       data-leader    ("true" if role === 'leader', else "false")
//       data-freshness (Freshness string from lastContactFreshness())
//   - Leader rows get a subtle accent border-left so the operator can
//     spot the leader without scanning the Role column.
//   - The "this node" badge is rendered inside the Node cell of the
//     self row only.
const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  thead th {
    text-align: left;
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    border-bottom: 1px solid ${({ theme }) => theme.border.subtle};
    padding: 6px 12px;
    color: ${({ theme }) => theme.text.secondary};
  }
  tbody td {
    padding: 6px 12px;
    border-bottom: 1px solid ${({ theme }) => theme.border.subtle};
    color: ${({ theme }) => theme.text.primary};
    font-family: ${({ theme }) => theme.font.family.mono};
  }
  tbody tr[data-leader='true'] td:first-child {
    border-left: 3px solid ${({ theme }) => theme.colors.success};
  }
  tbody tr[data-freshness='lost'] td {
    color: ${({ theme }) => theme.text.muted};
  }
`

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
    if ($role === 'candidate') return theme.text.primary
    if ($role === 'shutdown') return theme.text.onDanger
    return theme.text.muted
  }};
`

const FreshnessBadge = styled.span<{ $f: Freshness }>`
  border-radius: ${({ theme }) => theme.radii.sm};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  padding: 0 6px;
  margin-left: 6px;
  background: ${({ theme, $f }) => {
    if ($f === 'lost') return theme.colors.danger
    if ($f === 'stale') return theme.colors.warning
    return theme.bg.subtle
  }};
  color: ${({ theme, $f }) => {
    if ($f === 'lost') return theme.text.onDanger
    if ($f === 'stale') return theme.text.primary
    return theme.text.muted
  }};
`

const SelfBadge = styled.span`
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  font-size: ${({ theme }) => theme.font.sizes.xs};
  background: ${({ theme }) => theme.colors.info ?? theme.bg.subtle};
  color: ${({ theme }) => theme.text.primary};
  border-radius: ${({ theme }) => theme.radii.sm};
`

function roleBadgeLabel(
  t: (k: string) => string,
  role: ClusterRole
): string {
  switch (role) {
    case 'leader':
      return t('cluster.leaderBadge')
    case 'follower':
      return t('cluster.followerBadge')
    case 'candidate':
      return t('cluster.candidateBadge')
    case 'shutdown':
      return t('cluster.shutdownBadge')
    case 'standalone':
      return t('cluster.unknownBadge')
    default:
      return t('cluster.unknownBadge')
  }
}

function freshnessLabel(
  t: (k: string) => string,
  f: Freshness
): string | null {
  if (f === 'self') return null
  if (f === 'fresh') return t('cluster.freshnessFresh')
  if (f === 'stale') return t('cluster.freshnessStale')
  return t('cluster.freshnessLost')
}

export interface MembersTableProps {
  members: ClusterMember[]
  selfNodeId: number | null
}

export const MembersTable: React.FC<MembersTableProps> = ({
  members,
  selfNodeId,
}) => {
  const { t } = useTranslation()
  return (
    <Table data-testid="cluster-members-table">
      <thead>
        <tr>
          <th scope="col">{t('cluster.columnNodeId')}</th>
          <th scope="col">{t('cluster.columnRole')}</th>
          <th scope="col">{t('cluster.columnTerm')}</th>
          <th scope="col">{t('cluster.columnLeader')}</th>
          <th scope="col">{t('cluster.columnEndpoint')}</th>
          <th scope="col">{t('cluster.columnLastContact')}</th>
        </tr>
      </thead>
      <tbody>
        {members.map((m) => {
          const isSelf = m.nodeId === selfNodeId
          const isLeader = m.role === 'leader'
          const freshness = lastContactFreshness(m.lastContactMs)
          const freshLabel = freshnessLabel(t, freshness)
          return (
            <tr
              key={m.nodeId}
              data-testid="cluster-member-row"
              data-self={isSelf ? 'true' : 'false'}
              data-leader={isLeader ? 'true' : 'false'}
              data-freshness={freshness}
            >
              <td>
                {m.nodeId}
                {isSelf ? <SelfBadge>{t('cluster.selfBadge')}</SelfBadge> : null}
              </td>
              <td>
                <RoleBadge $role={m.role}>{roleBadgeLabel(t, m.role)}</RoleBadge>
              </td>
              <td>{m.term}</td>
              <td>{m.leaderId === 0 ? '—' : m.leaderId}</td>
              <td>{m.endpoint}</td>
              <td>
                {formatLastContact(m.lastContactMs)}
                {freshLabel ? (
                  <FreshnessBadge $f={freshness}>{freshLabel}</FreshnessBadge>
                ) : null}
              </td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/cluster/MembersTable.test.tsx`
Expected: PASS — 6 tests for headers / rows / self / leader / freshness / empty.

- [ ] **Step 5: Theme-token safety check**

If the test fails due to `theme.colors.info` or `theme.colors.warning` being `undefined`, fall back to existing tokens. The `?? theme.bg.subtle` guard on `info` already handles missing-token gracefully; `warning` is referenced unconditionally — verify with `grep "theme.colors.warning" src/`. If no other code uses it, replace with `theme.colors.success` (badge background only).

- [ ] **Step 6: Commit**

```bash
git add src/components/cluster/MembersTable.tsx src/components/cluster/MembersTable.test.tsx
git commit -m "feat(cluster): MembersTable with self/leader/freshness affordances"
```

---

### Task 4: Build the `ClusterPage`

**Files:**
- Create: `src/pages/ClusterPage.tsx`
- Test: `src/pages/ClusterPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/pages/ClusterPage.test.tsx`:

```tsx
/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'
import { LocalizationProvider } from '../services/i18n'
import { testTheme as theme } from '../test-utils/theme'
import type {
  ClusterStatusSnapshot,
  ClusterMember,
} from '../api/cluster'
import type { UseClusterStatusResult } from '../lib/useClusterStatus'

const clusterFixture: {
  current: UseClusterStatusResult
} = {
  current: {
    snapshot: null,
    loading: true,
    error: null,
    refresh: jest.fn().mockResolvedValue(undefined),
  },
}

jest.mock('../lib/useClusterStatus', () => ({
  useClusterStatus: (): UseClusterStatusResult => clusterFixture.current,
}))

import { ClusterPage } from './ClusterPage'

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <LocalizationProvider>
        <ThemeProvider theme={theme}>
          <ClusterPage />
        </ThemeProvider>
      </LocalizationProvider>
    </MemoryRouter>
  )
}

function makeMember(
  partial: Partial<ClusterMember> & { nodeId: number }
): ClusterMember {
  return {
    nodeId: partial.nodeId,
    role: partial.role ?? 'follower',
    term: partial.term ?? 1,
    leaderId: partial.leaderId ?? 1,
    endpoint: partial.endpoint ?? `10.0.0.${partial.nodeId}:7400`,
    lastContactMs: partial.lastContactMs ?? 0,
  }
}

describe('ClusterPage', () => {
  afterEach(() => {
    cleanup()
    clusterFixture.current = {
      snapshot: null,
      loading: true,
      error: null,
      refresh: jest.fn().mockResolvedValue(undefined),
    }
  })

  it('renders loading state when no snapshot yet', () => {
    renderPage()
    expect(screen.getByText(/Loading cluster status/)).toBeInTheDocument()
  })

  it('renders the error panel when error is set and no snapshot', () => {
    clusterFixture.current = {
      snapshot: null,
      loading: false,
      error: 'permission_denied: principal lacks cluster.read',
      refresh: jest.fn().mockResolvedValue(undefined),
    }
    renderPage()
    expect(screen.getByText(/Cluster status unavailable/)).toBeInTheDocument()
    expect(
      screen.getByText(/permission_denied: principal lacks cluster.read/)
    ).toBeInTheDocument()
  })

  it('renders the standalone panel when snapshot has a single standalone row', () => {
    const snap: ClusterStatusSnapshot = {
      members: [
        makeMember({ nodeId: 0, role: 'standalone', leaderId: 0 }),
      ],
      selfNodeId: 0,
      fetchedAt: 1,
    }
    clusterFixture.current = {
      snapshot: snap,
      loading: false,
      error: null,
      refresh: jest.fn().mockResolvedValue(undefined),
    }
    renderPage()
    expect(screen.getByTestId('cluster-standalone-panel')).toBeInTheDocument()
    expect(
      screen.queryByTestId('cluster-members-table')
    ).not.toBeInTheDocument()
  })

  it('renders the members table when clustered', () => {
    const snap: ClusterStatusSnapshot = {
      members: [
        makeMember({ nodeId: 1, role: 'leader', term: 4, leaderId: 1 }),
        makeMember({ nodeId: 2, role: 'follower', term: 4, leaderId: 1, lastContactMs: 10 }),
      ],
      selfNodeId: 1,
      fetchedAt: 1,
    }
    clusterFixture.current = {
      snapshot: snap,
      loading: false,
      error: null,
      refresh: jest.fn().mockResolvedValue(undefined),
    }
    renderPage()
    expect(screen.getByTestId('cluster-members-table')).toBeInTheDocument()
    expect(screen.getAllByTestId('cluster-member-row')).toHaveLength(2)
  })

  it('manual refresh button calls hook.refresh()', () => {
    const refresh = jest.fn().mockResolvedValue(undefined)
    clusterFixture.current = {
      snapshot: {
        members: [makeMember({ nodeId: 1, role: 'leader' })],
        selfNodeId: 1,
        fetchedAt: 1,
      },
      loading: false,
      error: null,
      refresh,
    }
    renderPage()
    fireEvent.click(screen.getByTestId('cluster-refresh-btn'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/pages/ClusterPage.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the page**

Create `src/pages/ClusterPage.tsx`:

```tsx
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { useClusterStatus } from '../lib/useClusterStatus'
import { isClusterMode } from '../api/cluster'
import { MembersTable } from '../components/cluster/MembersTable'

// ClusterPage — full Raft cluster view at /cluster.
//
// Branches by hook state:
//   - snapshot=null + loading      → "Loading cluster status…"
//   - snapshot=null + error        → error panel
//   - snapshot && !isClusterMode   → standalone panel
//   - snapshot && isClusterMode    → header + MembersTable
//
// Polling is owned by the hook (5 s interval here for a fresher
// "operator is watching an election" view; dashboard card uses 10 s).
// Manual refresh button fires hook.refresh() so an operator can pull
// fresh state immediately without waiting for the next tick.
const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.lg};
`

const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.spacing.md};
`

const HeaderText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const Subtitle = styled.p`
  margin: 0;
  color: ${({ theme }) => theme.text.secondary};
  font-size: 13px;
`

const Updated = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.text.muted};
  margin-right: 8px;
`

const RefreshBtn = styled.button`
  background: ${({ theme }) => theme.bg.subtle};
  color: ${({ theme }) => theme.text.primary};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.bg.surface};
  }
  &:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.border.focus};
    outline-offset: 2px;
  }
`

const Panel = styled.section`
  padding: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  color: ${({ theme }) => theme.text.primary};
`

const ErrorPanel = styled(Panel)`
  border-color: ${({ theme }) => theme.colors.danger};
  color: ${({ theme }) => theme.text.primary};
`

function formatUpdated(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const d = new Date(ms)
  return d.toLocaleTimeString()
}

export const ClusterPage: React.FC = () => {
  const { t } = useTranslation()
  const cluster = useClusterStatus({ intervalMs: 5000 })

  const renderBody = (): React.ReactNode => {
    if (cluster.error && !cluster.snapshot) {
      return (
        <ErrorPanel role="alert" data-testid="cluster-error-panel">
          <h2 style={{ margin: 0, fontSize: '15px' }}>
            {t('cluster.errorTitle')}
          </h2>
          <p style={{ margin: '6px 0 0 0' }}>{cluster.error}</p>
        </ErrorPanel>
      )
    }
    if (!cluster.snapshot) {
      return (
        <Panel role="status" data-testid="cluster-loading">
          <p style={{ margin: 0 }}>{t('cluster.loading')}</p>
        </Panel>
      )
    }
    if (!isClusterMode(cluster.snapshot.members)) {
      return (
        <Panel data-testid="cluster-standalone-panel">
          <h2 style={{ margin: 0, fontSize: '15px' }}>
            {t('cluster.standaloneTitle')}
          </h2>
          <p style={{ margin: '6px 0 0 0' }}>
            {t('cluster.standaloneBody')}
          </p>
        </Panel>
      )
    }
    return (
      <Panel data-testid="cluster-members-panel">
        <h2 style={{ margin: 0, marginBottom: '8px', fontSize: '15px' }}>
          {t('cluster.membersHeading')}
        </h2>
        <MembersTable
          members={cluster.snapshot.members}
          selfNodeId={cluster.snapshot.selfNodeId}
        />
      </Panel>
    )
  }

  const updatedLabel = cluster.snapshot
    ? t('cluster.lastUpdated', {
        when: formatUpdated(cluster.snapshot.fetchedAt),
      })
    : ''

  return (
    <Page>
      <HeaderRow>
        <HeaderText>
          <h1 style={{ margin: 0 }}>{t('cluster.title')}</h1>
          <Subtitle>{t('cluster.subtitle')}</Subtitle>
        </HeaderText>
        <div>
          {updatedLabel ? <Updated>{updatedLabel}</Updated> : null}
          <RefreshBtn
            type="button"
            data-testid="cluster-refresh-btn"
            aria-label={t('cluster.refreshAria')}
            disabled={cluster.loading}
            onClick={() => {
              cluster.refresh().catch(() => {
                /* error surfaces via hook state */
              })
            }}
          >
            {cluster.loading ? t('cluster.refreshing') : t('cluster.refresh')}
          </RefreshBtn>
        </div>
      </HeaderRow>
      {renderBody()}
    </Page>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/pages/ClusterPage.test.tsx`
Expected: PASS — 5 tests for loading / error / standalone / clustered / refresh.

- [ ] **Step 5: Theme-token guard**

If `theme.colors.info` is undefined and any test fails, see the `MembersTable` fallback note in Task 3 Step 5; apply the same `?? theme.bg.subtle` guard here. If `theme.text.primary` (used as candidate text color) is fine in this theme but a future change breaks it, the React Testing Library output will show a styled-components warning — note it but don't block.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ClusterPage.tsx src/pages/ClusterPage.test.tsx
git commit -m "feat(cluster): ClusterPage with live polling + standalone fallback"
```

---

### Task 5: Wire the `/cluster` route into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Inspect existing route layout**

Run: `grep -n "Route path=" src/App.tsx`
Expected: lists the routes inside the protected shell (query, dashboard, schema, admin, profiles, docs).

- [ ] **Step 2: Add the import**

In `src/App.tsx`, add the import near the other page imports (e.g. just after the `SchemaPage` import):

```ts
import { ClusterPage } from './pages/ClusterPage'
```

- [ ] **Step 3: Add the route**

Inside the protected shell's `<Route element={<ProtectedShell />}>` block, add the cluster route between `schema` and `admin` (alphabetical-ish but more importantly grouped with operator-facing surfaces):

```tsx
                  <Route path="cluster" element={<ClusterPage />} />
```

- [ ] **Step 4: Run any App-level routing tests**

Run: `npx jest src/App` (matches every test file with App in its name)
Expected: PASS — pre-existing route tests still green; no new test added in this task.

If no `src/App.test.tsx` exists, that's fine — Task 7 covers the page end-to-end and the unit test in Task 4 already exercises the page directly.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(cluster): mount /cluster route in protected shell"
```

---

### Task 6: Add the Cluster nav link to the Shell

**Files:**
- Modify: `src/components/layout/Shell.tsx`

- [ ] **Step 1: Inspect existing nav structure**

Run: `grep -n 'to="/' src/components/layout/Shell.tsx`
Expected: lists the existing NavLinks — desktop (around line 304) and mobile drawer (around line 339).

- [ ] **Step 2: Add the desktop nav link**

In `src/components/layout/Shell.tsx`, in the desktop nav block, insert between Schema and Admin:

```tsx
          <NavLink to="/cluster">{t('nav.cluster')}</NavLink>
```

- [ ] **Step 3: Add the mobile drawer nav link**

In the mobile drawer block (the lower `<NavLink to="/schema">...</NavLink>` group), insert between Schema and Admin:

```tsx
        <NavLink to="/cluster">{t('nav.cluster')}</NavLink>
```

- [ ] **Step 4: Run the Shell unit tests if any**

Run: `npx jest src/components/layout/`
Expected: PASS. If a snapshot or "nav contains these links" assertion exists, update it to include "Cluster".

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/Shell.tsx
git commit -m "feat(cluster): add Cluster nav link (desktop + mobile)"
```

---

### Task 7: Add e2e selectors + smoke spec

**Files:**
- Modify: `e2e/helpers/selectors.ts`
- Create: `e2e/specs/30-cluster.spec.ts`

- [ ] **Step 1: Add selectors**

In `e2e/helpers/selectors.ts`, find the existing `navProfiles` (or `navAdmin`) selector and add immediately after it:

```ts
  navCluster: (p: Page): Locator => p.getByRole('link', { name: 'Cluster' }),
```

Just before the closing `}` of the `sel` object, add:

```ts
  clusterMembersTable: (p: Page): Locator =>
    p.getByTestId('cluster-members-table'),
  clusterMemberRow: (p: Page): Locator =>
    p.getByTestId('cluster-member-row'),
  clusterRefreshBtn: (p: Page): Locator =>
    p.getByTestId('cluster-refresh-btn'),
  clusterStandalonePanel: (p: Page): Locator =>
    p.getByTestId('cluster-standalone-panel'),
```

- [ ] **Step 2: Create the spec**

Create `e2e/specs/30-cluster.spec.ts`:

```ts
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'

// /cluster page — operator view of Raft cluster membership.
// The e2e backend (docker-compose) runs a single-node Geode, so this
// test exercises the standalone branch: nav link must be present, the
// page must render the standalone fallback panel, and the refresh
// button must remain interactive.
//
// If the local backend is swapped to a clustered build (3-node compose
// override), the assertion below relaxes — either the members table OR
// the standalone panel must render, and the refresh button must stay
// clickable in both states.
test.describe('cluster page', () => {
  test('nav link mounts the page; standalone-or-clustered branch renders', async ({
    authedPage: page,
  }) => {
    await page.goto('/dashboard')
    await expect(sel.navCluster(page)).toBeVisible()
    await sel.navCluster(page).click()
    await expect(page).toHaveURL(/\/cluster$/)
    // Either the standalone panel or the members table must be present.
    const standalone = sel.clusterStandalonePanel(page)
    const table = sel.clusterMembersTable(page)
    await expect(async () => {
      const sCount = await standalone.count()
      const tCount = await table.count()
      expect(sCount + tCount).toBeGreaterThanOrEqual(1)
    }).toPass({ timeout: 10_000 })
    // Refresh button must always be present and clickable.
    await expect(sel.clusterRefreshBtn(page)).toBeVisible()
    await sel.clusterRefreshBtn(page).click()
    // No error panel should appear after a manual refresh against a
    // healthy local backend.
    await expect(page.getByTestId('cluster-error-panel')).toHaveCount(0)
  })
})
```

- [ ] **Step 3: Typecheck the e2e suite**

Run: `npm run e2e:tsc`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/helpers/selectors.ts e2e/specs/30-cluster.spec.ts
git commit -m "test(e2e): cluster page nav + standalone-or-clustered smoke"
```

---

### Task 8: Full validation pass

**Files:** none (validation only)

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: PASS — zero warnings.

- [ ] **Step 2: Hardcoded-strings + translations + html-renderers**

Run: `npm run detect:hardcoded-strings && npm run verify:translations && npm run check:html-renderers`
Expected: PASS.

- [ ] **Step 3: Type check**

Run: `npm run test:ts`
Expected: PASS.

- [ ] **Step 4: Cluster-touched Jest**

Run: `npx jest src/components/cluster src/pages/ClusterPage src/App src/components/layout`
Expected: PASS — every test added by this plan plus any existing layout / App tests still green.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS — no regressions.

- [ ] **Step 6: Commit fixups, if any**

If anything was auto-formatted or required a minor adjustment:

```bash
git add -p
git commit -m "chore(cluster): lint + type fixups from full-suite run"
```

If nothing changed, skip.

---

## Self-Review

**Spec coverage:**
- "Dedicated cluster page with full membership table" → Tasks 3+4 (`MembersTable` + `ClusterPage`).
- "Live polling" → Task 4 (5 s interval via `useClusterStatus({ intervalMs: 5000 })`).
- "Last-contact freshness" → Tasks 1+3 (`formatLastContact` + `lastContactFreshness` + freshness badge in table).
- "Leader highlighting" → Task 3 (`data-leader="true"` + `border-left` accent).
- "Self node tagging" → Task 3 (`data-self="true"` + SelfBadge in Node cell).
- "Manual refresh" → Task 4 (RefreshBtn → `cluster.refresh()`).
- "Standalone fallback" → Task 4 (`isClusterMode` branch → `cluster-standalone-panel`).
- "Error states" → Task 4 (error panel branch when `snapshot=null + error`).
- "Nav link" → Task 6.
- "Route wiring" → Task 5.
- "e2e smoke" → Task 7.

**Placeholder scan:**
- No "TBD" / "similar to" / "figure it out" steps.
- Every test body and code block is complete.

**Type consistency:**
- `ClusterMember` shape from Plan 1's `src/api/cluster.ts` consumed unchanged by `MembersTable` and `ClusterPage`.
- `UseClusterStatusResult` from Plan 1's `src/lib/useClusterStatus.ts` consumed unchanged by `ClusterPage` test fixture and component.
- `Freshness` union (`'self' | 'fresh' | 'stale' | 'lost'`) consistent between `formatLastContact.ts` and `MembersTable.tsx`.
- `data-*` attribute values are strings ('true' / 'false') — tests use `toHaveAttribute(..., 'true')` with the string form (DOM attributes are always strings).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-cluster-ui-2-page.md`. Plan 3 (topbar role indicator + ConnectionCard integration) is sequenced behind this one.

Execution proceeds via **superpowers:subagent-driven-development** under the active autonomous goal loop.
