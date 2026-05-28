# Cluster UI – Plan 3: Topbar Role Chip + ConnectionCard Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cluster awareness pervasive in the UI: a small role chip in the topbar next to the ConnectionSwitcher (only when clustered, with a click-through to `/cluster`), and a new Cluster row inside the Dashboard's existing `ConnectionCard` showing membership count + role.

**Architecture:** Reuses Plan 1's `useClusterStatus()` hook. A new presentational `ClusterRoleChip` component is consumed inside `Shell.tsx` (mounted in the Top nav, only renders when `snapshot && isClusterMode`). The `ConnectionCard` gains an optional `clusterSnapshot` prop and renders a cluster row when set; `DashboardPage` already calls `useClusterStatus()` (Plan 1) so passing the snapshot down is a one-line wiring change. Polling cadence in the shell uses a longer interval (30 s) than the dashboard card (10 s) and the cluster page (5 s) because the chip is ambient and a stale-by-a-few-seconds role indicator is fine.

**Tech Stack:** TypeScript, React 18, react-i18next, react-router-dom v6, styled-components, Jest + React Testing Library, Playwright.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/components/layout/ClusterRoleChip.tsx` (new) | Pure presentational chip — receives a snapshot, renders role + "→ Cluster" link, returns null in standalone/empty. |
| `src/components/layout/ClusterRoleChip.test.tsx` (new) | Unit tests for standalone (null) / clustered / loading-fallback / accessible click. |
| `src/components/layout/Shell.tsx` (modify) | Mount `<ClusterRoleChip />` inside the Top nav, between `<ConnectionSwitcher />` and the right-side controls. Wire `useClusterStatus({ intervalMs: 30000 })`. |
| `src/components/dashboard/ConnectionCard.tsx` (modify) | Accept optional `clusterSnapshot` prop; when present and clustered, render a "Cluster: N nodes — Role" row at the bottom of the card. |
| `src/components/dashboard/ConnectionCard.test.tsx` (modify) | Add tests: cluster row absent without snapshot / absent with standalone snapshot / present with clustered snapshot. |
| `src/pages/DashboardPage.tsx` (modify) | Pass `cluster.snapshot` to `<ConnectionCard … clusterSnapshot={cluster.snapshot} />`. |
| `src/services/i18n/locales/en.ts` (modify) | Add `nav.clusterChipAria`, `dashboard.connectionClusterRow`, `dashboard.connectionClusterNodesFmt`. |
| `e2e/helpers/selectors.ts` (modify) | Add `clusterRoleChip` selector. |
| `e2e/specs/30-cluster.spec.ts` (modify) | Extend smoke: when clustered, assert chip is visible; click it → land on `/cluster`. |

---

### Task 1: Add i18n strings

**Files:**
- Modify: `src/services/i18n/locales/en.ts`

- [ ] **Step 1: Add the keys**

Inside the existing `nav: { … }` block, append:

```ts
    clusterChipAria: 'Cluster role: {{role}}. View cluster details.',
```

Inside the existing `dashboard: { … }` block, append (next to the other cluster* dashboard keys):

```ts
    connectionClusterRow: 'Cluster',
    connectionClusterNodesFmt: '{{count}} nodes',
```

- [ ] **Step 2: Validate translations**

Run: `npm run verify:translations`
Expected: PASS — 0 orphans (the keys are consumed in Tasks 2 and 3).

If validator fails on orphans because Task 2/3 haven't shipped yet, follow the Plan 2 pattern: extend the temporary contract test (`src/services/i18n/__tests__/clusterPageKeys.test.ts`) to also reference these three keys via literal `i18n.t('…')` calls. Keep the references after Task 2/3 ship — it stays as a cheap contract test.

- [ ] **Step 3: Commit**

```bash
git add src/services/i18n/locales/en.ts src/services/i18n/__tests__/clusterPageKeys.test.ts
git commit -m "feat(i18n): cluster topbar chip + connection card cluster row copy"
```

---

### Task 2: Build the `ClusterRoleChip` component

**Files:**
- Create: `src/components/layout/ClusterRoleChip.tsx`
- Test: `src/components/layout/ClusterRoleChip.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/layout/ClusterRoleChip.test.tsx`:

```tsx
/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'

import { ClusterRoleChip } from './ClusterRoleChip'
import { testTheme } from '../../test-utils/theme'
import { i18n } from '../../services/i18n'
import type { ClusterStatusSnapshot, ClusterMember } from '../../api/cluster'

function renderChip(ui: React.ReactElement): void {
  render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={testTheme}>{ui}</ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>
  )
}

function snap(members: ClusterMember[], selfNodeId: number | null): ClusterStatusSnapshot {
  return { members, selfNodeId, fetchedAt: 1 }
}

test('renders null when snapshot is null', () => {
  const { container } = render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={testTheme}>
          <ClusterRoleChip snapshot={null} />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>
  )
  expect(container.firstChild).toBeNull()
})

test('renders null when snapshot is standalone', () => {
  const { container } = render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={testTheme}>
          <ClusterRoleChip
            snapshot={snap(
              [
                {
                  nodeId: 0,
                  role: 'standalone',
                  term: 0,
                  leaderId: 0,
                  endpoint: '0.0.0.0:0',
                  lastContactMs: 0,
                },
              ],
              0
            )}
          />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>
  )
  expect(container.firstChild).toBeNull()
})

test('renders the role label when clustered (leader)', () => {
  renderChip(
    <ClusterRoleChip
      snapshot={snap(
        [
          {
            nodeId: 1,
            role: 'leader',
            term: 5,
            leaderId: 1,
            endpoint: '10.0.0.1:7400',
            lastContactMs: 0,
          },
          {
            nodeId: 2,
            role: 'follower',
            term: 5,
            leaderId: 1,
            endpoint: '10.0.0.2:7400',
            lastContactMs: 10,
          },
        ],
        1
      )}
    />
  )
  const chip = screen.getByTestId('cluster-role-chip')
  expect(chip).toBeVisible()
  expect(chip).toHaveTextContent(/leader/i)
})

test('renders the role label when clustered (follower)', () => {
  renderChip(
    <ClusterRoleChip
      snapshot={snap(
        [
          {
            nodeId: 1,
            role: 'leader',
            term: 5,
            leaderId: 1,
            endpoint: '10.0.0.1:7400',
            lastContactMs: 0,
          },
          {
            nodeId: 2,
            role: 'follower',
            term: 5,
            leaderId: 1,
            endpoint: '10.0.0.2:7400',
            lastContactMs: 10,
          },
        ],
        2
      )}
    />
  )
  expect(screen.getByTestId('cluster-role-chip')).toHaveTextContent(/follower/i)
})

test('is a link that points to /cluster with an aria-label', () => {
  renderChip(
    <ClusterRoleChip
      snapshot={snap(
        [
          {
            nodeId: 1,
            role: 'leader',
            term: 5,
            leaderId: 1,
            endpoint: '10.0.0.1:7400',
            lastContactMs: 0,
          },
          {
            nodeId: 2,
            role: 'follower',
            term: 5,
            leaderId: 1,
            endpoint: '10.0.0.2:7400',
            lastContactMs: 10,
          },
        ],
        1
      )}
    />
  )
  const chip = screen.getByTestId('cluster-role-chip')
  expect(chip.tagName.toLowerCase()).toBe('a')
  expect(chip.getAttribute('href')).toBe('/cluster')
  expect(chip.getAttribute('aria-label')).toMatch(/leader/i)
  expect(chip.getAttribute('aria-label')).toMatch(/cluster/i)
})

test('renders unknown when the self row is missing from members', () => {
  renderChip(
    <ClusterRoleChip
      snapshot={snap(
        [
          {
            nodeId: 7,
            role: 'leader',
            term: 5,
            leaderId: 7,
            endpoint: '10.0.0.7:7400',
            lastContactMs: 0,
          },
        ],
        99 // self id we don't have a row for
      )}
    />
  )
  expect(screen.getByTestId('cluster-role-chip')).toHaveTextContent(/unknown/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/layout/ClusterRoleChip.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the chip**

Create `src/components/layout/ClusterRoleChip.tsx`:

```tsx
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import { isClusterMode, type ClusterRole, type ClusterStatusSnapshot } from '../../api/cluster'

// ClusterRoleChip — ambient cluster role indicator that lives in the
// Top nav. Returns null in standalone mode so the chip never shows up
// on single-node Geode instances; in cluster mode it renders a small
// linked badge that takes the operator to /cluster on click.
//
// Self-node role is derived from `snapshot.members.find(m =>
// m.nodeId === snapshot.selfNodeId)?.role`. If selfNodeId is missing
// from the member list (race between membership change and our
// snapshot), the chip falls through to 'unknown' rather than hiding
// — leaving the chip visible signals "we know this is a cluster, we
// just don't know our own role yet."
const ChipLink = styled(Link)<{ $role: ClusterRole }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
  padding: 2px 10px;
  font-size: ${({ theme }) => theme.font.sizes.xs};
  font-weight: ${({ theme }) => theme.font.weights.medium};
  border-radius: ${({ theme }) => theme.radii.sm};
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
    return theme.text.primary
  }};

  &:hover {
    filter: brightness(1.05);
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.border.focus};
    outline-offset: 2px;
  }
`

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

export interface ClusterRoleChipProps {
  snapshot: ClusterStatusSnapshot | null
}

export const ClusterRoleChip: React.FC<ClusterRoleChipProps> = ({
  snapshot,
}) => {
  const { t } = useTranslation()
  if (!snapshot) return null
  if (!isClusterMode(snapshot.members)) return null
  const self = snapshot.members.find((m) => m.nodeId === snapshot.selfNodeId)
  const role: ClusterRole = self?.role ?? 'unknown'
  const label = roleLabel(t, role)
  return (
    <ChipLink
      to="/cluster"
      $role={role}
      data-testid="cluster-role-chip"
      aria-label={t('nav.clusterChipAria', { role: label })}
    >
      {label}
    </ChipLink>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/layout/ClusterRoleChip.test.tsx`
Expected: PASS — 6 tests for null / standalone / leader / follower / link / unknown.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/ClusterRoleChip.tsx src/components/layout/ClusterRoleChip.test.tsx
git commit -m "feat(cluster): topbar ClusterRoleChip (linked badge)"
```

---

### Task 3: Add a Cluster row to `ConnectionCard`

**Files:**
- Modify: `src/components/dashboard/ConnectionCard.tsx`
- Modify: `src/components/dashboard/ConnectionCard.test.tsx`

- [ ] **Step 1: Read the existing test file for context**

Run: `cat src/components/dashboard/ConnectionCard.test.tsx`
Expected: see existing render helper + the existing assertions on capabilities + version.

- [ ] **Step 2: Add the failing tests**

In `src/components/dashboard/ConnectionCard.test.tsx`, add the following three tests at the end of the existing `describe` (or top-level test list — match the file's existing style):

```tsx
import type { ClusterStatusSnapshot } from '../../api/cluster'

test('cluster row is absent when clusterSnapshot is undefined', () => {
  renderCard(
    <ConnectionCard
      geodeVersion="v1"
      adminWritable={null}
      loading={false}
      error={null}
    />
  )
  expect(screen.queryByTestId('connection-card-cluster-row')).not.toBeInTheDocument()
})

test('cluster row is absent when clusterSnapshot is standalone', () => {
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
  renderCard(
    <ConnectionCard
      geodeVersion="v1"
      adminWritable={null}
      loading={false}
      error={null}
      clusterSnapshot={standaloneSnap}
    />
  )
  expect(screen.queryByTestId('connection-card-cluster-row')).not.toBeInTheDocument()
})

test('cluster row renders membership count + role when clustered', () => {
  const clusteredSnap: ClusterStatusSnapshot = {
    members: [
      {
        nodeId: 1,
        role: 'leader',
        term: 4,
        leaderId: 1,
        endpoint: '10.0.0.1:7400',
        lastContactMs: 0,
      },
      {
        nodeId: 2,
        role: 'follower',
        term: 4,
        leaderId: 1,
        endpoint: '10.0.0.2:7400',
        lastContactMs: 10,
      },
      {
        nodeId: 3,
        role: 'follower',
        term: 4,
        leaderId: 1,
        endpoint: '10.0.0.3:7400',
        lastContactMs: 7,
      },
    ],
    selfNodeId: 1,
    fetchedAt: 1,
  }
  renderCard(
    <ConnectionCard
      geodeVersion="v1"
      adminWritable={null}
      loading={false}
      error={null}
      clusterSnapshot={clusteredSnap}
    />
  )
  const row = screen.getByTestId('connection-card-cluster-row')
  expect(row).toBeInTheDocument()
  expect(row).toHaveTextContent('Cluster')
  expect(row).toHaveTextContent('3 nodes')
  expect(row).toHaveTextContent(/leader/i)
})
```

If `renderCard` is not exported by the test file but the existing tests render inline, mirror the inline render pattern. Don't restructure the existing tests.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest src/components/dashboard/ConnectionCard.test.tsx`
Expected: 3 new tests FAIL (TypeScript error: `clusterSnapshot` is not in the props type).

- [ ] **Step 4: Extend `ConnectionCard`**

In `src/components/dashboard/ConnectionCard.tsx`, add the import for `ClusterStatusSnapshot` and `isClusterMode` at the top:

```ts
import { isClusterMode, type ClusterStatusSnapshot } from '../../api/cluster'
```

Extend `ConnectionCardProps`:

```ts
export interface ConnectionCardProps {
  geodeVersion: string | null
  adminWritable: AdminWritable | null
  loading: boolean
  error: string | null
  // Plan 3: when the connected Geode is part of a Raft cluster, the
  // dashboard's DashboardPage threads the snapshot down here so the
  // card can render a single-line "Cluster: N nodes — Role" row at
  // the bottom. Undefined / standalone snapshots leave the row
  // entirely hidden so single-node operators don't see an inert row.
  clusterSnapshot?: ClusterStatusSnapshot | null
}
```

Extend the destructure to include `clusterSnapshot`. At the bottom of `renderBody()` (after the existing `</ul>`), insert the cluster row inside the same fragment:

```tsx
        {clusterSnapshot && isClusterMode(clusterSnapshot.members) ? (
          <ul
            className="list-unstyled m-0 p-0 d-flex flex-column"
            style={{ gap: '2px', marginTop: '6px' }}
            data-testid="connection-card-cluster-list"
          >
            {(() => {
              const self = clusterSnapshot.members.find(
                (m) => m.nodeId === clusterSnapshot.selfNodeId
              )
              const role = self?.role ?? 'unknown'
              const roleI18n = {
                leader: 'dashboard.clusterRoleLeader',
                follower: 'dashboard.clusterRoleFollower',
                candidate: 'dashboard.clusterRoleCandidate',
                shutdown: 'dashboard.clusterRoleShutdown',
              } as const
              const roleKey = (roleI18n as Record<string, string>)[role] ??
                'dashboard.clusterRoleUnknown'
              return (
                <li
                  data-testid="connection-card-cluster-row"
                  className="d-flex align-items-center justify-content-between text-body-secondary"
                  style={{ fontSize: '13px' }}
                >
                  <span>{t('dashboard.connectionClusterRow')}</span>
                  <span>
                    {t('dashboard.connectionClusterNodesFmt', {
                      count: clusterSnapshot.members.length,
                    })}{' '}
                    — {t(roleKey)}
                  </span>
                </li>
              )
            })()}
          </ul>
        ) : null}
```

If lint complains about the inline IIFE (`react/no-unstable-nested-components`, `arrow-body-style`, etc.), hoist the cluster row into a small local component above the `ConnectionCard` definition (call it `ClusterRow`) that takes `{ snapshot }` and returns the `<li>`. Keep the data-testid the same.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/components/dashboard/ConnectionCard.test.tsx`
Expected: PASS — original tests + 3 new cluster row tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/ConnectionCard.tsx src/components/dashboard/ConnectionCard.test.tsx
git commit -m "feat(dashboard): ConnectionCard renders cluster row when clustered"
```

---

### Task 4: Wire `cluster.snapshot` into DashboardPage's ConnectionCard mount

**Files:**
- Modify: `src/pages/DashboardPage.tsx`
- Modify: `src/pages/DashboardPage.test.tsx` (verify nothing broke)

- [ ] **Step 1: Pass the snapshot down**

In `src/pages/DashboardPage.tsx`, find the `<ConnectionCard …/>` mount and add the prop:

```tsx
        <ConnectionCard
          geodeVersion={ov.geodeVersion}
          adminWritable={ov.adminWritable}
          loading={ov.loading}
          error={ov.capsError}
          clusterSnapshot={cluster.snapshot}
        />
```

- [ ] **Step 2: Re-run the dashboard tests**

Run: `npx jest src/pages/DashboardPage.test.tsx`
Expected: PASS — existing 7 tests still green. The new cluster-row in ConnectionCard is keyed on the fixture's cluster snapshot (standalone by default in this file) so no extra assertion is needed here.

- [ ] **Step 3: Commit**

```bash
git add src/pages/DashboardPage.tsx
git commit -m "feat(dashboard): thread cluster snapshot into ConnectionCard"
```

---

### Task 5: Mount the `ClusterRoleChip` in the Shell

**Files:**
- Modify: `src/components/layout/Shell.tsx`

- [ ] **Step 1: Inspect the Top nav structure**

Run: `grep -n "ConnectionSwitcher\|ThemeSelector\|WindowControls\|useAuth" src/components/layout/Shell.tsx`
Expected: shows where ConnectionSwitcher is mounted inside the Top nav and where the right-side controls live.

- [ ] **Step 2: Add the imports**

In `src/components/layout/Shell.tsx`, add the new imports near the other hook imports:

```ts
import { useClusterStatus } from '../../lib/useClusterStatus'
import { ClusterRoleChip } from './ClusterRoleChip'
```

- [ ] **Step 3: Call the hook**

Inside the `Shell` component body (just after the existing `useAuth()` / `useState` lines — wherever feels natural in the existing top of the component), add:

```ts
  const cluster = useClusterStatus({ intervalMs: 30_000 })
```

Note: the hook is hook-rule-safe to call unconditionally inside Shell — it returns null snapshot when no connection. Shell ALWAYS renders inside `ProtectedRoute`, so an authenticated context is guaranteed.

- [ ] **Step 4: Mount the chip in the Top nav**

Find the `<ConnectionSwitcher … />` element in the Top JSX. Immediately AFTER it (still inside the same flex-row container), add:

```tsx
        <ClusterRoleChip snapshot={cluster.snapshot} />
```

If the Top nav uses a `<Spacer />` to push items right, place the chip BEFORE the Spacer so it sits next to the ConnectionSwitcher rather than at the far right.

- [ ] **Step 5: Run Shell tests**

Run: `npx jest src/components/layout/`
Expected: PASS — existing layout tests still green. If `Shell.test.tsx` has a "renders the topbar" assertion that counts a specific number of children in the Top nav, update it to accommodate the new chip (the chip returns null in standalone, so the count shouldn't change at the test fixture level — but if the test mounts with a clustered fixture or counts elements unconditionally, update accordingly).

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/Shell.tsx
git commit -m "feat(cluster): mount ClusterRoleChip in topbar (30s poll)"
```

---

### Task 6: Extend the e2e cluster spec + add selector

**Files:**
- Modify: `e2e/helpers/selectors.ts`
- Modify: `e2e/specs/30-cluster.spec.ts`

- [ ] **Step 1: Add the selector**

In `e2e/helpers/selectors.ts`, add near the other cluster selectors:

```ts
  clusterRoleChip: (p: Page): Locator =>
    p.getByTestId('cluster-role-chip'),
```

- [ ] **Step 2: Extend the spec**

In `e2e/specs/30-cluster.spec.ts`, add the following test inside the existing `describe`:

```ts
  test('cluster role chip appears in the topbar when clustered and links to /cluster', async ({
    authedPage: page,
  }) => {
    await page.goto('/dashboard')
    const chip = sel.clusterRoleChip(page)
    const chipCount = await chip.count()
    if (chipCount === 0) {
      // Standalone backend — there is nothing to assert here. The
      // chip is intentionally hidden on standalone Geode.
      test.info().annotations.push({
        type: 'note',
        description: 'Standalone backend — cluster chip is hidden by design.',
      })
      return
    }
    await expect(chip).toBeVisible()
    await chip.click()
    await expect(page).toHaveURL(/\/cluster$/)
    await expect(sel.clusterMembersTable(page)).toBeVisible()
  })
```

- [ ] **Step 3: Typecheck e2e**

Run: `npm run e2e:tsc`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/helpers/selectors.ts e2e/specs/30-cluster.spec.ts
git commit -m "test(e2e): topbar cluster chip → /cluster click-through"
```

---

### Task 7: Full validation pass

**Files:** none (validation only)

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: PASS — zero warnings.

- [ ] **Step 2: Translations + hardcoded-strings + html-renderers**

Run: `npm run detect:hardcoded-strings && npm run verify:translations && npm run check:html-renderers`
Expected: PASS.

- [ ] **Step 3: Types**

Run: `npm run test:ts`
Expected: PASS.

- [ ] **Step 4: Touched-file Jest**

Run: `npx jest src/components/layout src/components/dashboard/ConnectionCard src/pages/DashboardPage src/services/i18n`
Expected: PASS.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS — no regressions vs the 1356/1356 baseline at the end of Plan 2.

- [ ] **Step 6: Commit fixups if any**

If anything was auto-formatted or required adjustment:

```bash
git add -p
git commit -m "chore(cluster): lint + type fixups from full-suite run"
```

If nothing changed, skip.

---

## Self-Review

**Spec coverage:**
- "Topbar role chip when clustered" → Tasks 2+5 (`ClusterRoleChip` + Shell mount + 30 s poll).
- "Click chip → cluster page" → Task 2 (anchor `to="/cluster"`); Task 6 (e2e assertion).
- "Cluster info in ConnectionCard" → Tasks 3+4 (`ConnectionCard.clusterSnapshot` prop + DashboardPage threading).
- "Hide in standalone" → Task 2 (`isClusterMode` short-circuit returns null).
- "Independent polling cadence" → Task 5 (30 s — looser than ClusterCard's 10 s and ClusterPage's 5 s).

**Placeholder scan:**
- All test bodies and code blocks complete.
- No "similar to" / "TBD" steps.

**Type consistency:**
- `ClusterStatusSnapshot` consumed unchanged by chip + card.
- `ClusterRole` union and `isClusterMode` from `src/api/cluster.ts` referenced in chip + card, identical to Plan 1 + Plan 2 usage.
- New `ConnectionCardProps.clusterSnapshot?: ClusterStatusSnapshot | null` is additive; DashboardPage passes the same `cluster.snapshot` type the hook returns.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-cluster-ui-3-integration.md`. After this plan ships the cluster UI surface is complete:
- Foundation data layer (Plan 1).
- Dashboard ClusterCard (Plan 1).
- Dedicated `/cluster` page with live membership (Plan 2).
- Topbar role chip + ConnectionCard cluster row (Plan 3).

Execution proceeds via **superpowers:subagent-driven-development** under the active autonomous goal loop.
