# Multi-Pane Query Workspace + Homepage Dashboard — Implementation Plan

> **Status: SHIPPED 2026-05-12.** GAP-027 closure note (2026-05-16): the
> 64 `- [ ]` checkboxes below are retained as historical notes of the
> implementation steps. The work shipped across commits `a90cb62`,
> `c07668b`, `b614d20`, `ce40930`, and `a4a787b`. Subsequent perf/quality
> closures (PERF #237 dashboard graph-stats cache, PERF #213 pane
> visibility-gating) build on this delivery.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add (Part A) a multi-pane query workspace at a new `/workspace` route — 2–4 independent editor+result panes tiled side-by-side, each with its own WebSocket stream and result tabs — and (Part B) a homepage overview dashboard at a new `/dashboard` route — summary cards for the graph list, recent queries, and connection/capabilities status. This is Phases 4 & 5 of the broader Geode-Dashboard-integration effort (`docs/superpowers/plans/2026-05-12-geode-dashboard-integration.md`), now planned in detail with the design decisions settled.

**Architecture:** Part A first extracts the result-tab switcher (Table/JSON/Graph/Matrix + the maximize toggle) out of `src/pages/QueryPage.tsx` into a shared `src/components/results/ResultPanel.tsx` that both `QueryPage` and each workspace pane render. A `usePane()` hook owns one pane's worth of state (statement, a `useReducer(streamReducer, …)`, a `streamQuery` handle, the `streamResp` memo, the active result tab, `run()`/`cancel()`); a `WorkspacePane` component composes the lazy `GqlEditor` + a small toolbar + `<ResultPanel>` around one `usePane()` instance; `WorkspacePage` keeps an ordered list of 1–4 pane ids and CSS-grid-tiles the panes (1 → full width, 2 → two columns, 3–4 → 2×2). The WS infra is already re-entrant (each `streamQuery()` call opens its own same-origin `/ws/query` connection), so N panes = N concurrent streams, all cookie-authenticated. Part B adds a `useQueryHistory` zustand store (persisted, FIFO-capped at 20, recorded on every query completion in `QueryPage` and `usePane`), a `useOverviewData()` hook (eager `client.graphs()` + `fetchCapabilities()`, on-demand default-graph node/edge counts via `client.query()`), a `<Card>` shell + four cards (`GraphsCard`, `RecentQueriesCard`, `ConnectionCard`, `GraphStatsCard`), and a `DashboardPage`. Recent-query rows prefill the editor by navigating to `/?statement=<encoded>`, which `QueryPage` reads from `useSearchParams()` on mount. `/` stays the query page; `/dashboard` and `/workspace` are new nav items.

**Tech Stack:** React 18 + TypeScript, styled-components (theme tokens in `src/theme/types.ts` — `theme.colors.{primary,success,danger,primaryScale,…}`, `theme.bg.{canvas,surface,subtle}`, `theme.text.{primary,secondary,muted,danger,onPrimary}`, `theme.spacing.{xxs..xxl}`, `theme.breakpoints.{xs..xxl}` (pixel ints), `theme.radii`, `theme.shadows.{sm,md,focus}`, `theme.font.{sizes,weights}`, `theme.zIndex`, `theme.border.{default,strong}`), zustand (persisted to `localStorage`; existing example: `src/components/results/useGraphPrefs.ts`), react-router-dom v7, i18next (`src/services/i18n/locales/en.ts` — nested keys; `npm run detect:hardcoded-strings -- --strict` requires every UI string to be a literal `t('key.path')` call; `npm run verify:translations` rejects orphan keys, so a new key must land in the same commit as its first use), the generated API client `client` (`src/api/client.ts` — `client.query(QueryReq): Promise<QueryResp>`, `client.graphs({}): Promise<{graphs: string[]}>`, `client.getCapabilities({})`), `streamQuery`/`streamReducer` (`src/lib/queryStream.ts`, `src/pages/queryStreamReducer.ts`). Tests: Jest + Testing Library, `*.test.tsx`/`*.test.ts` next to the file, `src/test-utils/theme.ts` exports `testTheme` (the dark theme), components rendered in `<ThemeProvider theme={testTheme}>` (and `<MemoryRouter>` where routing is involved). Playwright e2e: `e2e/specs/NN-*.spec.ts`, the `authedPage` fixture from `e2e/fixtures.ts`, the Monaco-typing pattern (`page.locator('.monaco-editor').first().click(); page.keyboard.press('ControlOrMeta+A'); page.keyboard.type(...)`), `e2e/helpers/selectors.ts` (`sel.*`), next free spec number is **21**. Build/test: `npm test`, `npx jest <path>`, `npm run test:ts`, `npm run lint` (eslint `--max-warnings=0`; bans `for...of` and `any`; no `argsIgnorePattern: '^_'` — an unused fn param needs a `// eslint-disable-next-line @typescript-eslint/no-unused-vars`), `npm run prettier:check`, `npm run detect:hardcoded-strings -- --strict`, `npm run verify:translations`, `npm run e2e -- <spec>` (the e2e stack: `make e2e-up` if not running — `docker ps | grep geode-ui`; rebuild the image with `make e2e-up` whenever a frontend change must be exercised by an e2e spec). `gopls`/IDE TS diagnostics in this repo are noisy (encoding/json/v2 build constraints, "Cannot find module" for files that exist, deprecated `act` signature) — ignore them; `npm run test:ts` / `npm run lint` / `npm test` are the source of truth. Go side unaffected.

---

## Scope & Phasing

This plan covers **two independent subsystems** — Part A (workspace) and Part B (dashboard). They share no state and can be executed and PR'd separately. Recommended order: **Part A first** (its Task A0 — the `ResultPanel` extraction — is also a standalone improvement to `QueryPage`), then **Part B**. Within Part B, **Task B1 (`useQueryHistory`)** is independently shippable as a "recent queries" feature even if the dashboard itself never lands.

**Decisions (settled, do not re-litigate):**
- Dashboard lives at `/dashboard`; `/` stays the query page (no route rename, no Shell-nav reorder beyond adding two items).
- Workspace lives at a new `/workspace` route (a dedicated `WorkspacePage`); panes are **tiled** (all visible, CSS grid), 2–4 of them.
- Task A0 extracts `<ResultPanel>` before the workspace work depends on it.
- Dashboard graph stats (node/edge counts) are **on-demand for the default graph only** (a "Load stats" button), not eager-for-all-graphs.

**Out of scope:** any change to the rendering engine (Cytoscape stays); any reagraph; charts/visx/recharts (no metric in v1 warrants a chart — graph stats are just two numbers); cross-pane state sync in the workspace (each pane is fully independent — the only shared state is "which panes exist"); persisting the workspace pane set across reloads (the workspace is ephemeral; `useGraphPrefs` is still the shared persisted graph-prefs store, and `useQueryHistory` persists query history); a "duplicate this pane's query into a new pane" affordance (nice, but YAGNI for v1 — note it as a follow-up).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/components/results/ResultPanel.tsx` | **create** (Task A0) | The result-view tab switcher: a `<Tabs>` row of Table/JSON/Graph/Matrix tab buttons + the optional maximize toggle, and the `{tab === ...}` switch rendering `<TableView>`/`<JsonView>`/`<GraphView>`/`<MatrixView>` with the right props. Props: `{ resp, query?, tab, onTabChange, expand?, maximized?, onToggleMaximize? }`. Owns no data — pure presentation given a `QueryResp` + the active tab. Both `QueryPage` and `WorkspacePane` render it. |
| `src/components/results/ResultPanel.test.tsx` | **create** (Task A0) | Tab list renders 4 tabs; clicking calls `onTabChange`; the right view component renders per `tab`; the maximize toggle appears only when `onToggleMaximize` is given and calls it. |
| `src/pages/QueryPage.tsx` | **modify** (A0, B1, B4) | A0: replace the inline result-panel JSX (the `Tabs`/`TabBtn` map + the `{tab === ...}` switch + `MaximizeBtn`) with `<ResultPanel resp={activeResp} query={stmt} tab={tab} onTabChange={setTab} expand={expand} maximized={maximized} onToggleMaximize={() => setMaximized(m => !m)} />`; keep the portal-into-`document.body` overlay logic, the editor, the toolbar, the `runSync`/`runStream`, the `activeResp` memo — all unchanged. B1: call `useQueryHistory.getState().record(...)` on query completion in both `runSync` and `runStream`. B4: read `useSearchParams()` on mount — if `?statement=<x>` is present, `setStmt(x)` (and clear the param). |
| `src/pages/QueryPage.test.tsx` | **modify** (A0, B1, B4) | A0: existing tab/result tests must still pass against the extracted `<ResultPanel>` (no behavior change). B1: a test that running a query records an entry. B4: a test that `/?statement=FOO` prefills the editor. |
| `src/pages/workspace/usePane.ts` | **create** (Task A1) | A hook owning one pane's state: `statement` (string), a `useReducer(streamReducer, initialStreamState)`, a `StreamHandle` ref, the `streamResp` memo, the active result `tab`, `setStatement`, `setTab`, `run()` (always streaming — workspace panes use the WS path for consistency), `cancel()`. Returns `{ statement, setStatement, tab, setTab, resp, err, busy, run, cancel }`. Calls `useQueryHistory.getState().record(...)` on completion (same as `QueryPage`). |
| `src/pages/workspace/usePane.test.ts` | **create** (Task A1) | `run()` opens a stream with the pane's statement, dispatches `start`, exposes the streamed rows; `cancel()` cancels the handle; two `usePane()` instances are independent (one's `run` doesn't touch the other's state); on completion the history store gets an entry. |
| `src/pages/workspace/WorkspacePane.tsx` | **create** (Task A2) | One pane's UI: the lazy `GqlEditor` (value=`statement`, onChange=`setStatement`, onRun=`run`), a small toolbar (Run/Cancel buttons + a "close pane" `×` button, disabled when it's the only pane), a row-count/error line, and `<ResultPanel resp={resp} query={statement} tab={tab} onTabChange={setTab} expand />` (no maximize toggle inside a pane — too cramped). Props: `{ paneId, canClose, onClose }`. Uses one `usePane()` instance internally. |
| `src/pages/workspace/WorkspacePane.test.tsx` | **create** (Task A2) | Renders an editor + toolbar + result panel; typing a statement and clicking Run drives the (mocked) stream and shows results; the close button calls `onClose` and is disabled when `canClose` is false. |
| `src/pages/workspace/useWorkspacePanes.ts` | **create** (Task A3) | A hook (or plain helper used by `WorkspacePage`) managing the ordered pane-id list: `panes: string[]` (starts with one id), `addPane()` (no-op past `MAX_PANES = 4`), `removePane(id)` (no-op when only one pane). Pane ids are stable opaque strings (`'pane-1'`, `'pane-2'`, … via an incrementing counter — so removing pane-2 and adding again gives `pane-3`, never reusing an id, so React keys stay stable). |
| `src/pages/workspace/useWorkspacePanes.test.ts` | **create** (Task A3) | starts with 1 pane; `addPane` grows to 4 then no-ops; `removePane` shrinks but no-ops at 1; ids are unique and never reused. |
| `src/pages/WorkspacePage.tsx` | **create** (Task A4) | Renders `useWorkspacePanes()` + an "Add pane" button (disabled at 4) + a CSS-grid layout of `<WorkspacePane>`s keyed by pane id (grid columns: 1 pane → `1fr`; 2 → `1fr 1fr`; 3–4 → `1fr 1fr` with rows wrapping). i18n `workspace.*`. |
| `src/pages/WorkspacePage.test.tsx` | **create** (Task A4) | Renders one pane initially; "Add pane" adds a second; with two panes each is independent; "Add pane" disabled at 4; closing a pane removes it. |
| `src/lib/useQueryHistory.ts` | **create** (Task B1) | zustand store, persisted to `localStorage` key `geode-ui.query-history`: `{ entries: QueryHistoryEntry[]; record(e: Omit<QueryHistoryEntry,'ranAt'> & {ranAt?: number}): void; clear(): void }`; `QueryHistoryEntry = { statement: string; ranAt: number; rowCount: number | null; ok: boolean }`; `record` prepends, dedups consecutive identical statements (don't add a new entry if the most recent entry has the same `statement` and `ok` — just update its `ranAt`/`rowCount`), caps at `MAX_HISTORY = 20` (FIFO). |
| `src/lib/useQueryHistory.test.ts` | **create** (Task B1) | default empty; `record` prepends newest-first; the 21st distinct entry evicts the oldest; recording the same statement twice in a row coalesces (not 2 entries); persists to `localStorage`; `clear` empties. |
| `src/lib/useOverviewData.ts` | **create** (Task B2) | A hook: on mount, `client.graphs({})` + `fetchCapabilities()` (in parallel, each with its own error so one failing doesn't blank the other); returns `{ graphs: string[] | null; geodeVersion: string | null; adminWritable: AdminWritable | null; loading: boolean; graphsError: string | null; capsError: string | null; reload(): void; defaultGraphStats: { nodes: number; edges: number } | null; statsLoading: boolean; statsError: string | null; loadStats(graph: string): void }`. `loadStats` runs `client.query({ statement: 'MATCH (n) RETURN count(n) AS c', page_size: 1000, timeout_ms: 30000, graph })` then a second for edges (`MATCH ()-[r]->() RETURN count(r) AS c`) — parses the single scalar cell out of `resp.rows[0][0]`. |
| `src/lib/useOverviewData.test.ts` | **create** (Task B2) | mock `client`: `graphs`/`getCapabilities` resolve → the hook exposes them; one rejecting doesn't blank the other; `loadStats` runs the two count queries and exposes `{nodes, edges}`; `loadStats` error → `statsError` set, `defaultGraphStats` stays null. |
| `src/components/dashboard/Card.tsx` | **create** (Task B3) | A styled shell: `<section>` with `theme.bg.surface` bg, `theme.shadows.sm`, `theme.radii.lg`, padding `theme.spacing.md`; props `{ title: string; action?: React.ReactNode; children: React.ReactNode }` — renders an `<h2>` (or `<h3>` — match the page's heading level) with the title + the optional action node in the header row, then the children. |
| `src/components/dashboard/Card.test.tsx` | **create** (Task B3) | renders the title heading + children; renders the action node when given. |
| `src/components/dashboard/GraphsCard.tsx` | **create** (Task B3) | Given `{ graphs: string[] | null; loading: boolean; error: string | null }`: a `<Card title={t('dashboard.graphsTitle', {count})}>` listing the graph names (each a link to `/schema` — the schema explorer — or just text in v1; v1: text is fine), an empty state, a loading state, an error state. |
| `src/components/dashboard/RecentQueriesCard.tsx` | **create** (Task B3) | Given `{ entries: QueryHistoryEntry[] }` from `useQueryHistory`: a `<Card title={t('dashboard.recentTitle')} action={<button onClick={clear}>{t('dashboard.clearHistory')}</button>}>` listing the entries (truncated statement + relative time + row count + an ok/fail dot); each row is a `<Link to={{ pathname: '/', search: '?statement=' + encodeURIComponent(entry.statement) }}>` that navigates to the query page with the editor prefilled; an empty state. |
| `src/components/dashboard/ConnectionCard.tsx` | **create** (Task B3) | Given `{ geodeVersion: string | null; adminWritable: AdminWritable | null; loading: boolean; error: string | null }`: a `<Card title={t('dashboard.connectionTitle')}>` showing the Geode version and the four admin-DDL capability flags (users/roles/policies/grants) as enabled/disabled badges; loading/error states. |
| `src/components/dashboard/GraphStatsCard.tsx` | **create** (Task B3) | Given `{ defaultGraph: string | null; stats: {nodes:number;edges:number} | null; loading: boolean; error: string | null; onLoad: () => void }`: a `<Card title={t('dashboard.statsTitle', {graph})}>` with — if `stats` null and not loading — a "Load stats" button (`onLoad`); if loading → a spinner; if `stats` → the node/edge counts; if `error` → the error. |
| `src/components/dashboard/*.test.tsx` | **create** (Task B3) | one per card: render with fixture props, assert the values + the empty/loading/error states + (RecentQueriesCard) the link href is `/?statement=...`. |
| `src/pages/DashboardPage.tsx` | **create** (Task B4) | Renders `useOverviewData()` + `useQueryHistory()` and lays the four cards in a responsive CSS grid (`grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))` or 3-col → 1-col at `theme.breakpoints.md`). i18n `dashboard.*`. |
| `src/pages/DashboardPage.test.tsx` | **create** (Task B4) | mock `useOverviewData`/`useQueryHistory` (or the underlying `client`): renders all four cards with the mocked data. |
| `src/App.tsx` | **modify** (A4, B4) | A4: import `WorkspacePage`, add `<Route path="workspace" element={<WorkspacePage />} />` inside the `<ProtectedShell>` block (alongside `schema`/`admin`/`ops`/`profiles`). B4: import `DashboardPage`, add `<Route path="dashboard" element={<DashboardPage />} />` there too. |
| `src/components/layout/Shell.tsx` | **modify** (A4, B4) | Add `<NavLink to="/workspace">{t('nav.workspace')}</NavLink>` and `<NavLink to="/dashboard">{t('nav.dashboard')}</NavLink>` to **both** the `<DesktopNav>` block and the mobile `<Drawer>` block (the existing pattern lists Query/Schema/Admin/Ops/Profiles in both). |
| `src/services/i18n/locales/en.ts` | **modify** (A2/A4, B1/B3/B4) | Add `nav.workspace: 'Workspace'`, `nav.dashboard: 'Dashboard'`; a `workspace` block (`title`, `addPane`, `closePane`, `panesFull`, `paneRun`, `paneCancel`, `paneEmpty`, etc.); a `dashboard` block (`title`, `graphsTitle` (`'Graphs ({{count}})'`), `graphsEmpty`, `recentTitle`, `recentEmpty`, `clearHistory`, `rerun`, `connectionTitle`, `version`, `capYes`, `capNo`, `statsTitle` (`'{{graph}} stats'`), `statsLoad`, `statsNodes`, `statsEdges`, `loading`, `loadFailed`, etc.). Add keys in the same commit as their first use (`verify:translations` is strict). |
| `src/services/i18n/locales/en.test.ts` (if it exists — check) | **modify** if present | If there's a test asserting the en.ts shape, update it; otherwise N/A. |
| `e2e/specs/21-workspace.spec.ts` | **create** (Task A5) | log in (`authedPage`), `/workspace`, add a 2nd pane, run a different query in each, assert both populate independently. |
| `e2e/specs/22-dashboard.spec.ts` | **create** (Task B5) | log in, `/dashboard` → graphs card lists ≥1 graph + version card non-empty; run a query on `/`, back to `/dashboard` → it's in Recent Queries; click it → `/` with editor prefilled. |
| `e2e/helpers/selectors.ts` | **modify** (A5, B5) | add `sel.*` entries for the new `data-testid`s (`workspace-add-pane`, `workspace-pane`, `pane-run-btn`, `pane-close-btn`, `dashboard-graphs-card`, `dashboard-recent-card`, `dashboard-recent-row`, `dashboard-connection-card`, `dashboard-stats-load`). |

---
---

# PART A — Multi-pane query workspace

## Task A0: Extract `<ResultPanel>` from `QueryPage`

**Files:**
- Create: `src/components/results/ResultPanel.tsx`
- Create: `src/components/results/ResultPanel.test.tsx`
- Modify: `src/pages/QueryPage.tsx`

> **Context:** `QueryPage.tsx` currently inlines the result-tab UI: a `<Tabs role="tablist">` containing a `.map` over `[['table',…],['json',…],['graph',…],['matrix',…]] as const` producing `<TabBtn>`s, plus a `<MaximizeBtn>`, then a `<div role="tabpanel">` with `{tab === 'table' && <TableView resp={activeResp} expand={expand} fillHeight={maximized} />}` / `json` (`<JsonView data={activeResp} fillHeight={maximized} />`) / `graph` (`<Suspense fallback={graphFallback}><GraphView resp={activeResp} query={stmt} fillHeight={maximized} /></Suspense>`) / `matrix` (`<MatrixView resp={activeResp} />`). `GraphView` is `React.lazy`'d at module scope in `QueryPage.tsx`. The `Tabs`/`TabBtn`/`MaximizeBtn` styled-components live in `QueryPage.tsx`. We move all of that into `ResultPanel.tsx`. `QueryPage` keeps the `maximized` state + the portal-into-`document.body` overlay; `ResultPanel` just gets `maximized` (for the `fillHeight` props) and an optional `onToggleMaximize` (which, when given, renders the maximize button — `QueryPage` passes it; `WorkspacePane` won't).

- [ ] **Step 1: Write the failing test** — `src/components/results/ResultPanel.test.tsx`:
```tsx
/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../test-utils/theme'
import { ResultPanel } from './ResultPanel'

// GraphView is React.lazy'd inside ResultPanel; mock it so the lazy
// chunk + Cytoscape don't load in jsdom.
jest.mock('./GraphView', () => ({
  __esModule: true,
  GraphView: () => <div data-testid="mock-graphview" />,
}))

const resp = {
  columns: [{ name: 'n', type: 'NODE' }],
  rows: [[{ id: 1, labels: ['A'], properties: {} }]],
  row_count: 1,
  elapsed_ms: 1,
  graph_summary: { nodes: [{ id: 1, labels: ['A'], properties: {} }], edges: [] },
}

function renderPanel(props: Partial<React.ComponentProps<typeof ResultPanel>> = {}) {
  const onTabChange = jest.fn()
  const utils = render(
    <ThemeProvider theme={theme}>
      <ResultPanel resp={resp} query="MATCH (n) RETURN n" tab="table" onTabChange={onTabChange} {...props} />
    </ThemeProvider>,
  )
  return { ...utils, onTabChange }
}

describe('ResultPanel', () => {
  it('renders the four result tabs and reports tab changes', () => {
    const { onTabChange } = renderPanel()
    expect(screen.getAllByRole('tab')).toHaveLength(4)
    fireEvent.click(screen.getByRole('tab', { name: /json/i }))
    expect(onTabChange).toHaveBeenCalledWith('json')
  })

  it('renders the active view per the tab prop', () => {
    renderPanel({ tab: 'json' })
    // JsonView renders a <pre> with the stringified resp
    expect(screen.getByText(/"row_count": 1/)).toBeInTheDocument()
  })

  it('renders the maximize toggle only when onToggleMaximize is given', () => {
    const { rerender } = renderPanel()
    expect(screen.queryByRole('button', { name: /maximize|fullscreen/i })).toBeNull()
    const onToggle = jest.fn()
    rerender(
      <ThemeProvider theme={theme}>
        <ResultPanel resp={resp} query="" tab="table" onTabChange={jest.fn()} onToggleMaximize={onToggle} />
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /maximize|fullscreen/i }))
    expect(onToggle).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it → FAIL** — `npx jest src/components/results/ResultPanel.test.tsx` → `Cannot find module './ResultPanel'`.

- [ ] **Step 3: Create `src/components/results/ResultPanel.tsx`** — move the JSX + the `Tabs`/`TabBtn`/`MaximizeBtn` styled-components + the `tabBg`/`tabColor`/`tabBorder` helper functions out of `QueryPage.tsx` into here, and add the props interface:
```tsx
import React, { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import type { QueryResp } from '@api'
import type { Theme } from '../../theme'
import { TableView } from './TableView'
import { JsonView } from './JsonView'
import { MatrixView } from './MatrixView'

const GraphView = React.lazy(() => import('./GraphView').then((m) => ({ default: m.GraphView })))

export type ResultTab = 'table' | 'json' | 'graph' | 'matrix'

export type ResultPanelProps = {
  resp: QueryResp
  /** Original query text — GraphView uses it to synthesise nodes from scalar-only RETURNs. */
  query?: string
  tab: ResultTab
  onTabChange: (t: ResultTab) => void
  /** When true (set by QueryPage's maximized overlay) the views fill the viewport. */
  maximized?: boolean
  /** When true, the table view projects node/edge columns into one column per property. */
  expand?: boolean
  /** If given, render the maximize toggle (QueryPage passes this; workspace panes don't). */
  onToggleMaximize?: () => void
}

// ── styled-components moved from QueryPage.tsx (tabBg/tabColor/tabBorder, Tabs, TabBtn, MaximizeBtn) ──
// (paste them here verbatim; they reference `theme.bg.subtle`, `theme.text.primary`, `theme.radii.md`,
//  `theme.shadows.focus`, `theme.font.weights.medium`, `theme.border.{default,strong}`, `theme.spacing.{xs,md,sm}`)
const tabBg = ({ theme, $active }: { theme: Theme; $active: boolean }): string =>
  $active ? theme.bg.subtle : 'transparent'
const tabColor = ({ theme, $active }: { theme: Theme; $active: boolean }): string =>
  $active ? theme.text.primary : theme.text.secondary
const tabBorder = ({ theme, $active }: { theme: Theme; $active: boolean }): string =>
  $active ? theme.border.strong : theme.border.default
const Tabs = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xs};
  margin: ${({ theme }) => theme.spacing.md} 0 ${({ theme }) => theme.spacing.sm};
`
const TabBtn = styled.button<{ $active: boolean }>`
  padding: 6px 14px;
  background: ${tabBg};
  color: ${tabColor};
  border: 1px solid ${tabBorder};
  border-radius: ${({ theme }) => theme.radii.md};
  cursor: pointer;
  font-family: inherit;
  font-weight: ${({ theme }) => theme.font.weights.medium};
  text-transform: capitalize;
  min-height: 32px;
  &:hover { background: ${({ theme }) => theme.bg.subtle}; color: ${({ theme }) => theme.text.primary}; }
  &:focus-visible { outline: none; box-shadow: ${({ theme }) => theme.shadows.focus}; }
`
const MaximizeBtn = styled.button`
  margin-left: auto;
  padding: 6px 12px;
  background: transparent;
  color: ${({ theme }) => theme.text.secondary};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.md};
  cursor: pointer;
  font-family: inherit;
  font-weight: ${({ theme }) => theme.font.weights.medium};
  min-height: 32px;
  &:hover { background: ${({ theme }) => theme.bg.subtle}; color: ${({ theme }) => theme.text.primary}; }
  &[aria-pressed='true'] { background: ${({ theme }) => theme.bg.subtle}; color: ${({ theme }) => theme.text.primary}; border-color: ${({ theme }) => theme.border.strong}; }
  &:focus-visible { outline: none; box-shadow: ${({ theme }) => theme.shadows.focus}; }
`

export const ResultPanel: React.FC<ResultPanelProps> = ({
  resp, query, tab, onTabChange, maximized = false, expand = true, onToggleMaximize,
}) => {
  const { t } = useTranslation()
  const graphFallback = <div role="status">{t('query.loadingGraph')}</div>
  return (
    <>
      <Tabs role="tablist" aria-label={t('query.resultViewLabel')}>
        {(
          [
            ['table', t('query.tabTable')],
            ['json', t('query.tabJson')],
            ['graph', t('query.tabGraph')],
            ['matrix', t('query.tabMatrix')],
          ] as const
        ).map(([kind, label]) => (
          <TabBtn
            key={kind}
            role="tab"
            aria-selected={tab === kind}
            aria-controls={`result-panel-${kind}`}
            tabIndex={tab === kind ? 0 : -1}
            $active={tab === kind}
            onClick={() => onTabChange(kind)}
          >
            {label}
          </TabBtn>
        ))}
        {onToggleMaximize && (
          <MaximizeBtn
            type="button"
            data-testid="result-fullscreen-toggle"
            aria-pressed={maximized}
            aria-label={maximized ? t('query.exitFullscreen') : t('query.maximizeResults')}
            title={maximized ? t('query.exitFullscreen') : t('query.maximizeResults')}
            onClick={onToggleMaximize}
          >
            {maximized ? '⤡' : '⤢'}
          </MaximizeBtn>
        )}
      </Tabs>
      <div id={`result-panel-${tab}`} role="tabpanel" aria-labelledby={`result-panel-${tab}`}>
        {tab === 'table' && <TableView resp={resp} expand={expand} fillHeight={maximized} />}
        {tab === 'json' && <JsonView data={resp} fillHeight={maximized} />}
        {tab === 'graph' && (
          <Suspense fallback={graphFallback}>
            <GraphView resp={resp} query={query} fillHeight={maximized} />
          </Suspense>
        )}
        {tab === 'matrix' && <MatrixView resp={resp} />}
      </div>
    </>
  )
}
```
(Use the **exact** `tabBg`/`tabColor`/`tabBorder` definitions that are currently in `QueryPage.tsx` — read them and copy verbatim, adjusting only the import paths. The sketch above is the likely shape; the real ones win.)

- [ ] **Step 4: Run the test → PASS** — `npx jest src/components/results/ResultPanel.test.tsx`.

- [ ] **Step 5: Rewire `QueryPage.tsx` to use `<ResultPanel>`** — delete the `Tabs`/`TabBtn`/`MaximizeBtn` styled-components and the `tabBg`/`tabColor`/`tabBorder` helpers and the `GraphView` `React.lazy` and the `graphFallback`/the inline result-panel `resultPanel` JSX from `QueryPage.tsx`; remove the now-unused `TableView`/`JsonView`/`MatrixView`/`Suspense`(if otherwise unused — `GqlEditor` still needs `Suspense`)/`createPortal`(still needed for the overlay) imports as appropriate; keep `Tab` type — actually replace it with `import type { ResultTab as Tab } from '../components/results/ResultPanel'`. Replace the `resultPanel`/`overlayEl`/`resultRegion` block with:
```tsx
import { ResultPanel, type ResultTab } from '../components/results/ResultPanel'
// ...
const [tab, setTab] = useState<ResultTab>('table')
// ...
const panel = activeResp && (
  <ResultPanel
    resp={activeResp}
    query={stmt}
    tab={tab}
    onTabChange={setTab}
    expand={expand}
    maximized={maximized}
    onToggleMaximize={() => setMaximized((m) => !m)}
  />
)
// The maximized overlay still portals into document.body:
const overlayEl = <ResultOverlay data-testid="result-fullscreen-overlay">{panel}</ResultOverlay>
const resultRegion: React.ReactNode = panel ? (maximized ? createPortal(overlayEl, document.body) : panel) : null
```
Keep `ResultOverlay` styled-component in `QueryPage.tsx` (it's QueryPage-specific). Keep the `Bar` toolbar and everything else.

- [ ] **Step 6: Run the QueryPage tests + gates → PASS** — `npx jest src/pages/QueryPage.test.tsx src/components/results/ResultPanel.test.tsx && npm run test:ts && npm run lint && npm run prettier:check`. The existing `QueryPage` tests (tab switching, the maximize overlay, etc.) must still pass — if a test reaches into `QueryPage`'s now-removed internals, update it to assert via `<ResultPanel>`'s rendered output instead (the DOM — `role="tab"`, `role="tabpanel"` — is unchanged, so most should just work).

- [ ] **Step 7: Commit** —
```bash
git add src/components/results/ResultPanel.tsx src/components/results/ResultPanel.test.tsx src/pages/QueryPage.tsx src/pages/QueryPage.test.tsx
git commit -m "refactor(results): extract ResultPanel from QueryPage (shared tab switcher)"
```

---

## Task A1: `usePane()` — one pane's stream state

**Files:**
- Create: `src/pages/workspace/usePane.ts`
- Create: `src/pages/workspace/usePane.test.ts`

> **Context:** This mirrors the streaming machinery in `QueryPage.tsx` (`useReducer(streamReducer, initialStreamState)`, `streamQuery(stmt, undefined, onMessage)`, the `handleRef`, `streamStateToResp`, the `streamResp` memo) but packaged as a reusable hook so each workspace pane gets its own. Workspace panes always stream (no sync-vs-stream toggle — keeps the pane chrome simple). `streamQuery` is re-entrant (each call → its own WS), so N `usePane()` instances → N concurrent streams. Recording into `useQueryHistory` happens here on completion — but `useQueryHistory` doesn't exist until Task B1, so: if Part A is executed before Part B, skip the `record(...)` call (leave a `// TODO(B1): record into useQueryHistory` and a test placeholder); if B1 is already done, wire it. The plan's recommended order is Part A then Part B, so write `usePane` without the history call now and add it in Task B1 (Task B1's spec includes "wire `record` into `usePane` if it exists").

- [ ] **Step 1: Write the failing test** — `src/pages/workspace/usePane.test.ts`:
```ts
import { act, renderHook } from '@testing-library/react'
import { usePane } from './usePane'

// Mock streamQuery so we can drive messages and assert independence.
const handles: Array<{ statement: string; onMessage: (m: unknown) => void; cancel: jest.Mock; resolveDone: () => void }> = []
jest.mock('../../lib/queryStream', () => ({
  streamQuery: (statement: string, _graph: unknown, onMessage: (m: unknown) => void) => {
    let resolveDone = (): void => {}
    const done = new Promise<void>((r) => { resolveDone = r })
    const cancel = jest.fn()
    handles.push({ statement, onMessage, cancel, resolveDone })
    return { cancel, done }
  },
}))

describe('usePane', () => {
  beforeEach(() => { handles.length = 0 })

  it('run() opens a stream with the pane statement and exposes streamed rows', async () => {
    const { result } = renderHook(() => usePane())
    act(() => result.current.setStatement('MATCH (n) RETURN n LIMIT 2'))
    act(() => result.current.run())
    expect(handles).toHaveLength(1)
    expect(handles[0].statement).toBe('MATCH (n) RETURN n LIMIT 2')
    act(() => {
      handles[0].onMessage({ kind: 'schema', columns: [{ name: 'n', type: 'NODE' }] })
      handles[0].onMessage({ kind: 'rowBatch', rows: [[1], [2]] })
      handles[0].onMessage({ kind: 'summary', row_count: 2, elapsed_ms: 5 })
      handles[0].onMessage({ kind: 'end' })
    })
    expect(result.current.resp?.row_count).toBe(2)
    expect(result.current.resp?.rows).toHaveLength(2)
  })

  it('cancel() cancels the active handle', () => {
    const { result } = renderHook(() => usePane())
    act(() => result.current.run())
    act(() => result.current.cancel())
    expect(handles[0].cancel).toHaveBeenCalled()
  })

  it('two pane instances are independent', () => {
    const a = renderHook(() => usePane())
    const b = renderHook(() => usePane())
    act(() => a.result.current.setStatement('A'))
    act(() => b.result.current.setStatement('B'))
    act(() => a.result.current.run())
    expect(handles).toHaveLength(1)
    expect(handles[0].statement).toBe('A')
    expect(b.result.current.busy).toBe(false) // b unaffected
  })
})
```

- [ ] **Step 2: Run it → FAIL** — `npx jest src/pages/workspace/usePane.test.ts` → module not found.

- [ ] **Step 3: Implement `src/pages/workspace/usePane.ts`**:
```ts
import { useCallback, useMemo, useReducer, useRef, useState } from 'react'
import type { QueryResp } from '@api'
import { streamQuery, type StreamHandle } from '../../lib/queryStream'
import { initialStreamState, streamReducer, type StreamState } from '../queryStreamReducer'
import type { ResultTab } from '../../components/results/ResultPanel'

const DEFAULT_STATEMENT = 'MATCH (n) RETURN n LIMIT 25'

function streamStateToResp(s: StreamState): QueryResp {
  return {
    columns: s.columns as unknown as Array<Record<string, unknown>>,
    rows: s.rows as Array<Array<unknown>>,
    row_count: s.rowCount || s.rows.length,
    elapsed_ms: s.elapsedMs,
  }
}

export type Pane = {
  statement: string
  setStatement: (s: string) => void
  tab: ResultTab
  setTab: (t: ResultTab) => void
  resp: QueryResp | null
  err: string | null
  busy: boolean
  run: () => void
  cancel: () => void
}

export function usePane(initialStatement: string = DEFAULT_STATEMENT): Pane {
  const [statement, setStatement] = useState(initialStatement)
  const [tab, setTab] = useState<ResultTab>('table')
  const [busy, setBusy] = useState(false)
  const [stream, dispatch] = useReducer(streamReducer, initialStreamState)
  const handleRef = useRef<StreamHandle | null>(null)

  const cancel = useCallback(() => {
    if (handleRef.current) {
      handleRef.current.cancel()
      handleRef.current = null
    }
    setBusy(false)
  }, [])

  const run = useCallback(() => {
    if (handleRef.current) {
      handleRef.current.cancel()
      handleRef.current = null
    }
    dispatch({ type: 'reset' })
    dispatch({ type: 'start' })
    setBusy(true)
    const h = streamQuery(statement, undefined, (m) => {
      dispatch({ type: 'msg', msg: m })
      if (m.kind === 'end' || m.kind === 'error') setBusy(false)
    })
    handleRef.current = h
    h.done.then(() => {
      dispatch({ type: 'closed' })
      setBusy(false)
      handleRef.current = null
      // TODO(B1): useQueryHistory.getState().record({ statement, rowCount: ..., ok: ... })
    })
  }, [statement])

  const resp = useMemo<QueryResp | null>(
    () => (stream.status === 'idle' ? null : streamStateToResp(stream)),
    [stream.status, stream.columns, stream.rows, stream.rowsVersion, stream.rowCount, stream.elapsedMs],
  )
  const err = stream.error

  return { statement, setStatement, tab, setTab, resp, err, busy, run, cancel }
}
```

- [ ] **Step 4: Run the test → PASS** — `npx jest src/pages/workspace/usePane.test.ts`.

- [ ] **Step 5: Gates** — `npm run test:ts && npm run lint && npm run prettier:check`.

- [ ] **Step 6: Commit** —
```bash
git add src/pages/workspace/usePane.ts src/pages/workspace/usePane.test.ts
git commit -m "feat(workspace): usePane hook — one pane's streaming query state"
```

---

## Task A2: `WorkspacePane` component

**Files:**
- Create: `src/pages/workspace/WorkspacePane.tsx`
- Create: `src/pages/workspace/WorkspacePane.test.tsx`
- Modify: `src/services/i18n/locales/en.ts` (add the `workspace.*` keys used here: `workspace.paneRun`, `workspace.paneCancel`, `workspace.closePane`, `workspace.paneEmpty`)

- [ ] **Step 1: Write the failing test** — `src/pages/workspace/WorkspacePane.test.tsx`:
```tsx
/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../test-utils/theme'

// Mock the heavy lazy deps and the stream layer.
jest.mock('../../components/editor/GqlEditor', () => ({
  __esModule: true,
  GqlEditor: ({ value, onChange, onRun }: { value: string; onChange: (v: string) => void; onRun: () => void }) => (
    <div>
      <textarea data-testid="pane-editor" value={value} onChange={(e) => onChange(e.target.value)} />
      <button data-testid="pane-editor-run" onClick={onRun}>run</button>
    </div>
  ),
}))
jest.mock('../../components/results/GraphView', () => ({ __esModule: true, GraphView: () => <div /> }))
const streamHandles: Array<{ statement: string; onMessage: (m: unknown) => void }> = []
jest.mock('../../lib/queryStream', () => ({
  streamQuery: (statement: string, _g: unknown, onMessage: (m: unknown) => void) => {
    streamHandles.push({ statement, onMessage })
    return { cancel: jest.fn(), done: Promise.resolve() }
  },
}))
import { WorkspacePane } from './WorkspacePane'

describe('WorkspacePane', () => {
  beforeEach(() => { streamHandles.length = 0 })

  it('runs the pane statement and shows results', async () => {
    render(<ThemeProvider theme={theme}><WorkspacePane paneId="pane-1" canClose={false} onClose={jest.fn()} /></ThemeProvider>)
    fireEvent.change(screen.getByTestId('pane-editor'), { target: { value: 'MATCH (n) RETURN n LIMIT 1' } })
    fireEvent.click(screen.getByTestId('pane-run-btn'))
    expect(streamHandles[0].statement).toBe('MATCH (n) RETURN n LIMIT 1')
    // feed a result, assert the result panel shows the table tab
    fireEvent.change(screen.getByTestId('pane-editor'), { target: { value: 'x' } }) // (noop re-render)
    streamHandles[0].onMessage({ kind: 'schema', columns: [{ name: 'n', type: 'NODE' }] })
    streamHandles[0].onMessage({ kind: 'rowBatch', rows: [[1]] })
    streamHandles[0].onMessage({ kind: 'summary', row_count: 1, elapsed_ms: 1 })
    streamHandles[0].onMessage({ kind: 'end' })
    expect(await screen.findByRole('tab', { name: /table/i })).toBeInTheDocument()
  })

  it('close button calls onClose and is disabled when canClose is false', () => {
    const onClose = jest.fn()
    const { rerender } = render(<ThemeProvider theme={theme}><WorkspacePane paneId="pane-1" canClose={false} onClose={onClose} /></ThemeProvider>)
    expect(screen.getByTestId('pane-close-btn')).toBeDisabled()
    rerender(<ThemeProvider theme={theme}><WorkspacePane paneId="pane-1" canClose onClose={onClose} /></ThemeProvider>)
    fireEvent.click(screen.getByTestId('pane-close-btn'))
    expect(onClose).toHaveBeenCalledWith('pane-1')
  })
})
```

- [ ] **Step 2: Run it → FAIL** — `npx jest src/pages/workspace/WorkspacePane.test.tsx` → module not found.

- [ ] **Step 3: Implement `src/pages/workspace/WorkspacePane.tsx`**:
```tsx
import React, { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Button } from '../../components/ui'
import { ResultPanel } from '../../components/results/ResultPanel'
import { usePane } from './usePane'

const GqlEditor = React.lazy(() => import('../../components/editor/GqlEditor').then((m) => ({ default: m.GqlEditor })))

const Pane = styled.section`
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.lg};
  background: ${({ theme }) => theme.bg.surface};
  overflow: hidden;
`
const PaneBar = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  align-items: center;
  flex-wrap: wrap;
  padding: ${({ theme }) => theme.spacing.sm};
  color: ${({ theme }) => theme.text.secondary};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`
const CloseBtn = styled.button`
  margin-left: auto;
  background: transparent;
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.md};
  color: ${({ theme }) => theme.text.secondary};
  cursor: pointer;
  min-height: 32px;
  padding: 0 10px;
  &:disabled { opacity: 0.4; cursor: not-allowed; }
  &:hover:not(:disabled) { background: ${({ theme }) => theme.bg.subtle}; color: ${({ theme }) => theme.text.primary}; }
  &:focus-visible { outline: none; box-shadow: ${({ theme }) => theme.shadows.focus}; }
`
const PaneBody = styled.div`
  padding: 0 ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.sm};
  overflow: auto;
`
const Err = styled.span`
  color: ${({ theme }) => theme.text.danger};
`

export type WorkspacePaneProps = {
  paneId: string
  canClose: boolean
  onClose: (paneId: string) => void
}

export const WorkspacePane: React.FC<WorkspacePaneProps> = ({ paneId, canClose, onClose }) => {
  const { t } = useTranslation()
  const pane = usePane()
  const editorFallback = <div role="status">{t('query.loadingEditor')}</div>
  return (
    <Pane data-testid="workspace-pane" aria-label={paneId}>
      <Suspense fallback={editorFallback}>
        <GqlEditor value={pane.statement} onChange={pane.setStatement} onRun={pane.run} />
      </Suspense>
      <PaneBar>
        <Button onClick={pane.run} loading={pane.busy} data-testid="pane-run-btn">
          {t('workspace.paneRun')}
        </Button>
        {pane.busy && (
          <Button variant="secondary" onClick={pane.cancel}>
            {t('workspace.paneCancel')}
          </Button>
        )}
        {pane.resp && (
          <span>{t('common.rowCount', { count: pane.resp.row_count ?? 0 })}</span>
        )}
        {pane.err && <Err>{pane.err}</Err>}
        <CloseBtn
          type="button"
          data-testid="pane-close-btn"
          disabled={!canClose}
          aria-label={t('workspace.closePane')}
          title={t('workspace.closePane')}
          onClick={() => onClose(paneId)}
        >
          ×
        </CloseBtn>
      </PaneBar>
      <PaneBody>
        {pane.resp ? (
          <ResultPanel resp={pane.resp} query={pane.statement} tab={pane.tab} onTabChange={pane.setTab} expand />
        ) : (
          <p role="note">{t('workspace.paneEmpty')}</p>
        )}
      </PaneBody>
    </Pane>
  )
}
```
Add to `en.ts` (in the same commit): a `workspace` block (or extend it) with `paneRun: 'Run'`, `paneCancel: 'Cancel'`, `closePane: 'Close pane'`, `paneEmpty: 'Run a query to see results.'`. (`workspace.paneRun` could reuse `query.runHotkey` — but the workspace pane's run button is small; a plain "Run" is cleaner. Use a new key.)

- [ ] **Step 4: Run the test → PASS** — `npx jest src/pages/workspace/WorkspacePane.test.tsx`.

- [ ] **Step 5: Gates** — `npm run test:ts && npm run lint && npm run prettier:check && npm run detect:hardcoded-strings -- --strict && npm run verify:translations`.

- [ ] **Step 6: Commit** —
```bash
git add src/pages/workspace/WorkspacePane.tsx src/pages/workspace/WorkspacePane.test.tsx src/services/i18n/locales/en.ts
git commit -m "feat(workspace): WorkspacePane — editor + toolbar + ResultPanel for one pane"
```

---

## Task A3: `useWorkspacePanes()` — the pane-id list

**Files:**
- Create: `src/pages/workspace/useWorkspacePanes.ts`
- Create: `src/pages/workspace/useWorkspacePanes.test.ts`

- [ ] **Step 1: Write the failing test** — `src/pages/workspace/useWorkspacePanes.test.ts`:
```ts
import { act, renderHook } from '@testing-library/react'
import { useWorkspacePanes, MAX_PANES } from './useWorkspacePanes'

describe('useWorkspacePanes', () => {
  it('starts with one pane', () => {
    const { result } = renderHook(() => useWorkspacePanes())
    expect(result.current.panes).toHaveLength(1)
  })
  it('addPane grows up to MAX_PANES then no-ops', () => {
    const { result } = renderHook(() => useWorkspacePanes())
    for (let i = result.current.panes.length; i < MAX_PANES; i++) act(() => result.current.addPane())
    expect(result.current.panes).toHaveLength(MAX_PANES)
    act(() => result.current.addPane())
    expect(result.current.panes).toHaveLength(MAX_PANES) // no-op past max
  })
  it('removePane shrinks but never below one; ids are unique and not reused', () => {
    const { result } = renderHook(() => useWorkspacePanes())
    act(() => result.current.addPane())
    act(() => result.current.addPane())
    const ids = [...result.current.panes]
    expect(new Set(ids).size).toBe(ids.length) // unique
    act(() => result.current.removePane(ids[1]))
    expect(result.current.panes).toEqual([ids[0], ids[2]])
    act(() => result.current.removePane(ids[0]))
    act(() => result.current.removePane(ids[2]))
    expect(result.current.panes).toHaveLength(1) // never below 1
    act(() => result.current.addPane())
    // the new id must not collide with any earlier id (no reuse)
    expect(ids).not.toContain(result.current.panes[1])
  })
})
```

- [ ] **Step 2: Run it → FAIL** — `npx jest src/pages/workspace/useWorkspacePanes.test.ts` → module not found.

- [ ] **Step 3: Implement `src/pages/workspace/useWorkspacePanes.ts`**:
```ts
import { useCallback, useRef, useState } from 'react'

export const MAX_PANES = 4

export type WorkspacePanes = {
  panes: string[]
  addPane: () => void
  removePane: (id: string) => void
}

export function useWorkspacePanes(): WorkspacePanes {
  const counterRef = useRef(1)
  const [panes, setPanes] = useState<string[]>(['pane-1'])

  const addPane = useCallback(() => {
    setPanes((cur) => {
      if (cur.length >= MAX_PANES) return cur
      counterRef.current += 1
      return [...cur, `pane-${counterRef.current}`]
    })
  }, [])

  const removePane = useCallback((id: string) => {
    setPanes((cur) => (cur.length <= 1 ? cur : cur.filter((p) => p !== id)))
  }, [])

  return { panes, addPane, removePane }
}
```
(`counterRef` starts at 1 — `'pane-1'` is the seed. The first `addPane` bumps to 2 → `'pane-2'`. Removing then re-adding bumps to 3 → `'pane-3'`. Ids are never reused, so React keys stay stable.)

- [ ] **Step 4: Run the test → PASS** — `npx jest src/pages/workspace/useWorkspacePanes.test.ts`.

- [ ] **Step 5: Gates** — `npm run test:ts && npm run lint && npm run prettier:check`.

- [ ] **Step 6: Commit** —
```bash
git add src/pages/workspace/useWorkspacePanes.ts src/pages/workspace/useWorkspacePanes.test.ts
git commit -m "feat(workspace): useWorkspacePanes — 1..4 pane-id list"
```

---

## Task A4: `WorkspacePage` + route + nav

**Files:**
- Create: `src/pages/WorkspacePage.tsx`
- Create: `src/pages/WorkspacePage.test.tsx`
- Modify: `src/App.tsx` (add the `/workspace` route)
- Modify: `src/components/layout/Shell.tsx` (add the `/workspace` nav link in both blocks)
- Modify: `src/services/i18n/locales/en.ts` (`nav.workspace`, `workspace.title`, `workspace.addPane`, `workspace.panesFull`)

- [ ] **Step 1: Write the failing test** — `src/pages/WorkspacePage.test.tsx`:
```tsx
/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'
import { testTheme as theme } from '../test-utils/theme'

jest.mock('../components/editor/GqlEditor', () => ({
  __esModule: true,
  GqlEditor: ({ value }: { value: string }) => <textarea data-testid="pane-editor" defaultValue={value} />,
}))
jest.mock('../components/results/GraphView', () => ({ __esModule: true, GraphView: () => <div /> }))
jest.mock('../lib/queryStream', () => ({ streamQuery: () => ({ cancel: jest.fn(), done: Promise.resolve() }) }))
import { WorkspacePage } from './WorkspacePage'

function renderPage() {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('WorkspacePage', () => {
  it('starts with one pane and can add a second', async () => {
    renderPage()
    expect(screen.getAllByTestId('workspace-pane')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('workspace-add-pane'))
    expect(screen.getAllByTestId('workspace-pane')).toHaveLength(2)
  })
  it('disables Add pane at 4 panes and removes a pane via its close button', () => {
    renderPage()
    const add = screen.getByTestId('workspace-add-pane')
    fireEvent.click(add); fireEvent.click(add); fireEvent.click(add) // → 4
    expect(screen.getAllByTestId('workspace-pane')).toHaveLength(4)
    expect(add).toBeDisabled()
    // close one
    fireEvent.click(within(screen.getAllByTestId('workspace-pane')[0]).getByTestId('pane-close-btn'))
    expect(screen.getAllByTestId('workspace-pane')).toHaveLength(3)
    expect(add).not.toBeDisabled()
  })
})
```

- [ ] **Step 2: Run it → FAIL** — `npx jest src/pages/WorkspacePage.test.tsx` → module not found.

- [ ] **Step 3: Implement `src/pages/WorkspacePage.tsx`**:
```tsx
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Button } from '../components/ui'
import { WorkspacePane } from './workspace/WorkspacePane'
import { useWorkspacePanes, MAX_PANES } from './workspace/useWorkspacePanes'

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`
const Grid = styled.div<{ $count: number }>`
  display: grid;
  gap: ${({ theme }) => theme.spacing.md};
  grid-template-columns: ${({ $count }) => ($count <= 1 ? '1fr' : '1fr 1fr')};
  @media (max-width: ${({ theme }) => theme.breakpoints.md}px) {
    grid-template-columns: 1fr;
  }
`

export const WorkspacePage: React.FC = () => {
  const { t } = useTranslation()
  const { panes, addPane, removePane } = useWorkspacePanes()
  return (
    <div>
      <Header>
        <h1>{t('workspace.title')}</h1>
        <Button
          data-testid="workspace-add-pane"
          onClick={addPane}
          disabled={panes.length >= MAX_PANES}
          title={panes.length >= MAX_PANES ? t('workspace.panesFull') : t('workspace.addPane')}
        >
          {t('workspace.addPane')}
        </Button>
      </Header>
      <Grid $count={panes.length}>
        {panes.map((id) => (
          <WorkspacePane key={id} paneId={id} canClose={panes.length > 1} onClose={removePane} />
        ))}
      </Grid>
    </div>
  )
}
```
Add to `en.ts`: `nav.workspace: 'Workspace'`, and a `workspace` block (extend the one from Task A2): `title: 'Workspace'`, `addPane: '+ Add pane'`, `panesFull: 'Maximum of 4 panes'`.

In `src/App.tsx`: add `import { WorkspacePage } from './pages/WorkspacePage'` and `<Route path="workspace" element={<WorkspacePage />} />` inside the `<ProtectedShell>` block (after `<Route path="profiles" ... />`).

In `src/components/layout/Shell.tsx`: add `<NavLink to="/workspace">{t('nav.workspace')}</NavLink>` to **both** the `<DesktopNav>` block (after `<NavLink to="/">{t('nav.query')}</NavLink>` — workspace is query-adjacent) and the mobile `<Drawer>` block.

- [ ] **Step 4: Run the test + gates → PASS** — `npx jest src/pages/WorkspacePage.test.tsx && npm run test:ts && npm run lint && npm run prettier:check && npm run detect:hardcoded-strings -- --strict && npm run verify:translations && npm test -- src/components/layout/`. (The Shell test, if it asserts the nav-link list, must be updated to include "Workspace".)

- [ ] **Step 5: Commit** —
```bash
git add src/pages/WorkspacePage.tsx src/pages/WorkspacePage.test.tsx src/App.tsx src/components/layout/Shell.tsx src/services/i18n/locales/en.ts
git commit -m "feat(workspace): /workspace route with tiled multi-pane query panes"
```

---

## Task A5: E2e — the workspace runs independent queries per pane

**Files:**
- Create: `e2e/specs/21-workspace.spec.ts`
- Modify: `e2e/helpers/selectors.ts` (add `sel.workspaceAddPane`, `sel.workspacePane`, `sel.paneRunBtn`, `sel.paneCloseBtn` — wrapping the `data-testid`s already added in A2/A4)

- [ ] **Step 1: Add the selectors** to `e2e/helpers/selectors.ts` (match the file's existing `sel.*` shape — likely `(p: Page) => p.getByTestId('...')`):
```ts
workspaceAddPane: (p: Page) => p.getByTestId('workspace-add-pane'),
workspacePane: (p: Page) => p.getByTestId('workspace-pane'),
paneRunBtn: (p: Page) => p.getByTestId('pane-run-btn'),
paneCloseBtn: (p: Page) => p.getByTestId('pane-close-btn'),
```

- [ ] **Step 2: Write `e2e/specs/21-workspace.spec.ts`** (mirror `e2e/specs/05-query-graph.spec.ts`'s Monaco-typing pattern; `seed.graph` from `e2e/helpers/gqlData.ts`):
```ts
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

test.describe('multi-pane workspace', () => {
  test('two panes run independent queries side by side', async ({ authedPage: page }) => {
    await page.goto('/workspace')
    await expect(sel.workspacePane(page)).toHaveCount(1)
    await sel.workspaceAddPane(page).click()
    await expect(sel.workspacePane(page)).toHaveCount(2)

    const pane0 = sel.workspacePane(page).nth(0)
    const pane1 = sel.workspacePane(page).nth(1)

    // pane 0: a query returning ~3 movies
    await pane0.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(`USE GRAPH ${seed.graph}; MATCH (m:Movie) RETURN m LIMIT 3`)
    await pane0.getByTestId('pane-run-btn').click()
    await expect(pane0.getByText(/3 rows/)).toBeVisible()

    // pane 1: a different query returning ~6 people
    await pane1.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(`USE GRAPH ${seed.graph}; MATCH (p:Person) RETURN p LIMIT 6`)
    await pane1.getByTestId('pane-run-btn').click()
    await expect(pane1.getByText(/6 rows/)).toBeVisible()

    // pane 0 still shows its own result
    await expect(pane0.getByText(/3 rows/)).toBeVisible()

    // closing pane 1 leaves pane 0 intact
    await pane1.getByTestId('pane-close-btn').click()
    await expect(sel.workspacePane(page)).toHaveCount(1)
    await expect(sel.workspacePane(page).first().getByText(/3 rows/)).toBeVisible()
  })
})
```
(Adjust the seed-data counts to whatever the movies seed actually has — check `e2e/helpers/gqlData.ts`; the existing graph spec expects `(10|9) rows` for a `Person-ACTED_IN->Movie` query, so the movies seed has ~6 people / ~3 movies / ~9 ACTED_IN per the session notes — use `LIMIT`s that produce a deterministic count.)

- [ ] **Step 3: Rebuild the e2e image + run** — `make e2e-up` (rebuilds `geode-ui:e2e` with the workspace code), then `npm run e2e -- e2e/specs/21-workspace.spec.ts` → PASS. Then `npm run e2e -- e2e/specs/05-query-graph.spec.ts e2e/specs/19-graph-viz.spec.ts e2e/specs/20-node-inspector.spec.ts` → all PASS (regression: the `ResultPanel` extraction touched the query page's result area).

- [ ] **Step 4: Commit** —
```bash
git add e2e/specs/21-workspace.spec.ts e2e/helpers/selectors.ts
git commit -m "test(e2e): multi-pane workspace runs independent queries per pane"
```

**End of Part A.** geode-ui has a `/workspace` route with 1–4 tiled, independent editor+result panes, sharing the extracted `<ResultPanel>` with the query page. Ship as a PR (the `ResultPanel` extraction commit can be its own PR if you prefer).

---
---

# PART B — Homepage / overview dashboard

## Task B1: `useQueryHistory` store + record into `QueryPage` (and `usePane` if Part A landed)

**Files:**
- Create: `src/lib/useQueryHistory.ts`
- Create: `src/lib/useQueryHistory.test.ts`
- Modify: `src/pages/QueryPage.tsx` (call `record(...)` on query completion in `runSync` and `runStream`)
- Modify: `src/pages/QueryPage.test.tsx` (a test that running a query records an entry)
- Modify (if Part A landed): `src/pages/workspace/usePane.ts` (the `// TODO(B1)` — call `record(...)` in `h.done.then(...)`)

> **Context:** zustand + the `persist` middleware, mirroring `src/components/results/useGraphPrefs.ts` (localStorage-backed, with a `partialize`). No `Set` serialization needed here — just an array of plain objects.

- [ ] **Step 1: Write the failing test** — `src/lib/useQueryHistory.test.ts`:
```ts
import { useQueryHistory, MAX_HISTORY } from './useQueryHistory'

describe('useQueryHistory', () => {
  beforeEach(() => {
    localStorage.clear()
    useQueryHistory.setState({ entries: [] })
  })

  it('starts empty', () => {
    expect(useQueryHistory.getState().entries).toEqual([])
  })

  it('record prepends newest-first', () => {
    useQueryHistory.getState().record({ statement: 'A', rowCount: 1, ok: true })
    useQueryHistory.getState().record({ statement: 'B', rowCount: 2, ok: true })
    expect(useQueryHistory.getState().entries.map((e) => e.statement)).toEqual(['B', 'A'])
  })

  it('coalesces consecutive identical statements (same statement+ok) instead of duplicating', () => {
    useQueryHistory.getState().record({ statement: 'A', rowCount: 1, ok: true })
    useQueryHistory.getState().record({ statement: 'A', rowCount: 5, ok: true })
    const { entries } = useQueryHistory.getState()
    expect(entries).toHaveLength(1)
    expect(entries[0].rowCount).toBe(5) // updated, not duplicated
  })

  it(`caps at ${MAX_HISTORY} entries (FIFO eviction)`, () => {
    for (let i = 0; i <= MAX_HISTORY; i++) {
      useQueryHistory.getState().record({ statement: `Q${i}`, rowCount: 0, ok: true })
    }
    const { entries } = useQueryHistory.getState()
    expect(entries).toHaveLength(MAX_HISTORY)
    expect(entries[0].statement).toBe(`Q${MAX_HISTORY}`) // newest
    expect(entries.find((e) => e.statement === 'Q0')).toBeUndefined() // oldest evicted
  })

  it('persists to localStorage and clear() empties', () => {
    useQueryHistory.getState().record({ statement: 'A', rowCount: 1, ok: true })
    expect(localStorage.getItem('geode-ui.query-history')).toMatch(/"statement":"A"/)
    useQueryHistory.getState().clear()
    expect(useQueryHistory.getState().entries).toEqual([])
  })
})
```

- [ ] **Step 2: Run it → FAIL** — `npx jest src/lib/useQueryHistory.test.ts` → module not found.

- [ ] **Step 3: Implement `src/lib/useQueryHistory.ts`**:
```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const MAX_HISTORY = 20

export type QueryHistoryEntry = {
  statement: string
  ranAt: number
  rowCount: number | null
  ok: boolean
}

type RecordInput = { statement: string; rowCount: number | null; ok: boolean; ranAt?: number }

type QueryHistoryState = {
  entries: QueryHistoryEntry[]
  record: (e: RecordInput) => void
  clear: () => void
}

export const useQueryHistory = create<QueryHistoryState>()(
  persist(
    (set, get) => ({
      entries: [],
      record: ({ statement, rowCount, ok, ranAt }) => {
        const trimmed = statement.trim()
        if (!trimmed) return
        const now = ranAt ?? Date.now()
        const cur = get().entries
        // Coalesce: if the most recent entry has the same statement+ok,
        // update it in place instead of adding a duplicate.
        if (cur.length > 0 && cur[0].statement === trimmed && cur[0].ok === ok) {
          const next = [{ statement: trimmed, ranAt: now, rowCount, ok }, ...cur.slice(1)]
          set({ entries: next.slice(0, MAX_HISTORY) })
          return
        }
        set({ entries: [{ statement: trimmed, ranAt: now, rowCount, ok }, ...cur].slice(0, MAX_HISTORY) })
      },
      clear: () => set({ entries: [] }),
    }),
    { name: 'geode-ui.query-history', partialize: (s) => ({ entries: s.entries }) },
  ),
)
```
(Match the zustand/`persist` import style used by `useGraphPrefs.ts` — `import { create } from 'zustand'; import { persist } from 'zustand/middleware'` — and whatever version of the `create<...>()(...)` curry that file uses. The `useGraphPrefs.ts` `StateCreator`/`persist` typing has a known quirk in this repo's strictness config — mirror it; `npm run test:ts` tolerates it there.)

- [ ] **Step 4: Run the test → PASS** — `npx jest src/lib/useQueryHistory.test.ts`.

- [ ] **Step 5: Wire `record(...)` into `QueryPage.tsx`** — `import { useQueryHistory } from '../lib/useQueryHistory'`. In `runSync`, after `setResp(r)`: `useQueryHistory.getState().record({ statement: stmt, rowCount: r.row_count ?? r.rows.length, ok: true })`; in the `catch`: `useQueryHistory.getState().record({ statement: stmt, rowCount: null, ok: false })`. In `runStream`'s `h.done.then(...)`: `useQueryHistory.getState().record({ statement: stmt, rowCount: stream.rowCount || stream.rows.length, ok: stream.error == null })` — **but** `stream` inside the `.then` closure is the value at `run`-time, stale; instead read the latest via a ref or capture it in the reducer-`closed` path. Simplest: in `runStream`, after the `h.done.then`, the `dispatch({type:'closed'})` runs, and then `setBusy(false)` — at that point `stream` is still the old closure value. Use a `streamRef = useRef(stream); streamRef.current = stream` (kept fresh every render) and read `streamRef.current` in the `.then`. (Or: record from a `useEffect([stream.status])` that fires when `status` transitions to `'done'`/`'error'` — cleaner. Pick whichever; the effect-on-status-transition is the safest: `useEffect(() => { if (stream.status === 'done' || stream.status === 'error') useQueryHistory.getState().record({ statement: stmt, rowCount: stream.rowCount || stream.rows.length, ok: stream.status === 'done' }) }, [stream.status])` — but careful: `stmt` may have changed since the run; capture the run-time statement in a ref at `runStream` time. Use `runStmtRef`.) Add a test in `QueryPage.test.tsx`: run a (mocked) sync query, assert `useQueryHistory.getState().entries[0].statement` matches.

- [ ] **Step 6: Wire into `usePane.ts` (if Part A landed)** — replace the `// TODO(B1)` in `h.done.then(...)` with `useQueryHistory.getState().record({ statement, rowCount: <latest stream rowCount>, ok: <stream not errored> })` — same staleness caveat; use the effect-on-status approach inside `usePane` (a `useEffect` keyed on `stream.status`). Add an assertion to `usePane.test.ts` that completing a run records an entry.

- [ ] **Step 7: Gates** — `npx jest src/lib/useQueryHistory.test.ts src/pages/QueryPage.test.tsx src/pages/workspace/usePane.test.ts && npm run test:ts && npm run lint && npm run prettier:check && npm run detect:hardcoded-strings -- --strict && npm run verify:translations && npm test` (full — no regression).

- [ ] **Step 8: Commit** —
```bash
git add src/lib/useQueryHistory.ts src/lib/useQueryHistory.test.ts src/pages/QueryPage.tsx src/pages/QueryPage.test.tsx src/pages/workspace/usePane.ts src/pages/workspace/usePane.test.ts
git commit -m "feat: useQueryHistory store; record completed queries from the query page and workspace panes"
```

---

## Task B2: `useOverviewData()` hook

**Files:**
- Create: `src/lib/useOverviewData.ts`
- Create: `src/lib/useOverviewData.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/useOverviewData.test.ts`:
```ts
import { act, renderHook, waitFor } from '@testing-library/react'

const graphsMock = jest.fn()
const capsMock = jest.fn()
const queryMock = jest.fn()
jest.mock('../api/client', () => ({
  client: {
    graphs: (...a: unknown[]) => graphsMock(...a),
    getCapabilities: (...a: unknown[]) => capsMock(...a),
    query: (...a: unknown[]) => queryMock(...a),
  },
}))
import { useOverviewData } from './useOverviewData'

describe('useOverviewData', () => {
  beforeEach(() => {
    graphsMock.mockReset(); capsMock.mockReset(); queryMock.mockReset()
  })

  it('loads graphs + capabilities on mount', async () => {
    graphsMock.mockResolvedValue({ graphs: ['default', 'movies'] })
    capsMock.mockResolvedValue({ geode_version: 'v0.5.11', admin_writable: { users: false, roles: false, policies: false, grants: false } })
    const { result } = renderHook(() => useOverviewData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.graphs).toEqual(['default', 'movies'])
    expect(result.current.geodeVersion).toBe('v0.5.11')
    expect(result.current.adminWritable).toEqual({ users: false, roles: false, policies: false, grants: false })
  })

  it('a failing graphs() does not blank the version', async () => {
    graphsMock.mockRejectedValue(new Error('boom'))
    capsMock.mockResolvedValue({ geode_version: 'v0.5.11', admin_writable: {} })
    const { result } = renderHook(() => useOverviewData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.graphsError).toMatch(/boom/)
    expect(result.current.geodeVersion).toBe('v0.5.11')
  })

  it('loadStats runs the two count queries and exposes node/edge counts', async () => {
    graphsMock.mockResolvedValue({ graphs: ['default'] })
    capsMock.mockResolvedValue({ geode_version: 'v', admin_writable: {} })
    queryMock
      .mockResolvedValueOnce({ columns: [{ name: 'c', type: 'INT' }], rows: [[42]], row_count: 1, elapsed_ms: 1 })
      .mockResolvedValueOnce({ columns: [{ name: 'c', type: 'INT' }], rows: [[99]], row_count: 1, elapsed_ms: 1 })
    const { result } = renderHook(() => useOverviewData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.loadStats('default'))
    await waitFor(() => expect(result.current.statsLoading).toBe(false))
    expect(result.current.defaultGraphStats).toEqual({ nodes: 42, edges: 99 })
    expect(queryMock).toHaveBeenCalledTimes(2)
  })

  it('loadStats error sets statsError and leaves defaultGraphStats null', async () => {
    graphsMock.mockResolvedValue({ graphs: ['default'] })
    capsMock.mockResolvedValue({ geode_version: 'v', admin_writable: {} })
    queryMock.mockRejectedValue(new Error('stats boom'))
    const { result } = renderHook(() => useOverviewData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.loadStats('default'))
    await waitFor(() => expect(result.current.statsLoading).toBe(false))
    expect(result.current.statsError).toMatch(/stats boom/)
    expect(result.current.defaultGraphStats).toBeNull()
  })
})
```

- [ ] **Step 2: Run it → FAIL** — `npx jest src/lib/useOverviewData.test.ts` → module not found.

- [ ] **Step 3: Implement `src/lib/useOverviewData.ts`**:
```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { client } from '../api/client'
import { fetchCapabilities, type AdminWritable } from '../api/capabilities'

export type OverviewData = {
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

export function useOverviewData(): OverviewData {
  const [graphs, setGraphs] = useState<string[] | null>(null)
  const [geodeVersion, setGeodeVersion] = useState<string | null>(null)
  const [adminWritable, setAdminWritable] = useState<AdminWritable | null>(null)
  const [loading, setLoading] = useState(true)
  const [graphsError, setGraphsError] = useState<string | null>(null)
  const [capsError, setCapsError] = useState<string | null>(null)
  const [defaultGraphStats, setDefaultGraphStats] = useState<{ nodes: number; edges: number } | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState<string | null>(null)
  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])

  const load = useCallback(() => {
    setLoading(true)
    setGraphsError(null)
    setCapsError(null)
    let pending = 2
    const done = (): void => { pending -= 1; if (pending === 0 && aliveRef.current) setLoading(false) }
    client.graphs({}).then(
      (g) => { if (aliveRef.current) setGraphs(g.graphs ?? []) },
      (e) => { if (aliveRef.current) setGraphsError(errMsg(e)) },
    ).finally(done)
    fetchCapabilities().then(
      (c) => { if (aliveRef.current) { setGeodeVersion(c.geodeVersion); setAdminWritable(c.adminWritable) } },
      (e) => { if (aliveRef.current) setCapsError(errMsg(e)) },
    ).finally(done)
  }, [])

  useEffect(() => { load() }, [load])

  const loadStats = useCallback((graph: string) => {
    setStatsLoading(true)
    setStatsError(null)
    setDefaultGraphStats(null)
    Promise.all([
      client.query({ statement: 'MATCH (n) RETURN count(n) AS c', page_size: 1000, timeout_ms: 30000, graph }),
      client.query({ statement: 'MATCH ()-[r]->() RETURN count(r) AS c', page_size: 1000, timeout_ms: 30000, graph }),
    ]).then(
      ([nodesResp, edgesResp]) => {
        if (aliveRef.current) setDefaultGraphStats({ nodes: scalarCount(nodesResp), edges: scalarCount(edgesResp) })
      },
      (e) => { if (aliveRef.current) setStatsError(errMsg(e)) },
    ).finally(() => { if (aliveRef.current) setStatsLoading(false) })
  }, [])

  return { graphs, geodeVersion, adminWritable, loading, graphsError, capsError, reload: load, defaultGraphStats, statsLoading, statsError, loadStats }
}
```
(Confirm the Geode GQL for the count queries — `MATCH (n) RETURN count(n) AS c` / `MATCH ()-[r]->() RETURN count(r) AS c` are standard openCypher and the geode docs show `count()` usage; if the connected build needs a slightly different form, adjust. The `graph` field on `QueryReq` selects the graph; if omitting it queries the current/default graph, that's fine — but pass it explicitly so the dashboard's "stats for graph X" is unambiguous.)

- [ ] **Step 4: Run the test → PASS** — `npx jest src/lib/useOverviewData.test.ts`.

- [ ] **Step 5: Gates** — `npm run test:ts && npm run lint && npm run prettier:check`.

- [ ] **Step 6: Commit** —
```bash
git add src/lib/useOverviewData.ts src/lib/useOverviewData.test.ts
git commit -m "feat: useOverviewData — graph list, capabilities, and on-demand graph stats"
```

---

## Task B3: `<Card>` shell + the four dashboard cards

**Files:**
- Create: `src/components/dashboard/Card.tsx` + `Card.test.tsx`
- Create: `src/components/dashboard/GraphsCard.tsx` + `GraphsCard.test.tsx`
- Create: `src/components/dashboard/RecentQueriesCard.tsx` + `RecentQueriesCard.test.tsx`
- Create: `src/components/dashboard/ConnectionCard.tsx` + `ConnectionCard.test.tsx`
- Create: `src/components/dashboard/GraphStatsCard.tsx` + `GraphStatsCard.test.tsx`
- Modify: `src/services/i18n/locales/en.ts` (the `dashboard.*` keys these use)

> This is one task with 5 sub-components; do them as 5 mini TDD cycles, **one commit at the end** (or per-component commits — your call; the plan groups them). Each: write the failing `.test.tsx` → run it fails → implement → run it passes. The `Card` shell first (the others depend on it).

- [ ] **Step 1: `Card.tsx`** — test: renders `getByRole('heading', {name: title})` + the children; renders the action node when given. Implement: a `styled.section` with `theme.bg.surface` / `theme.shadows.sm` / `theme.radii.lg` / `padding: theme.spacing.md`, an `<h3>` (match the dashboard's heading hierarchy — `<h1>` is the page title, so cards are `<h3>`... actually `<h2>` if the page has no `<h2>` between — use `<h2>`; check `DashboardPage`'s structure — Task B4 — and keep one level; the plan uses `<h2>` for cards) + the action in a header flex row, then `{children}`. Props: `{ title: string; action?: React.ReactNode; children: React.ReactNode; 'data-testid'?: string }`.
- [ ] **Step 2: `GraphsCard.tsx`** — props `{ graphs: string[] | null; loading: boolean; error: string | null }`. test: with `graphs=['default','movies']` → heading "Graphs (2)" + both names listed; with `loading` → a `role="status"` loading; with `error` → a `role="alert"`; with `graphs=[]` → an empty state. Implement: `<Card title={t('dashboard.graphsTitle', { count: graphs?.length ?? 0 })} data-testid="dashboard-graphs-card">` → `loading ? <p role="status">{t('dashboard.loading')}</p> : error ? <p role="alert">{error}</p> : graphs && graphs.length ? <ul>{graphs.map(g => <li key={g}>{g}</li>)}</ul> : <p role="note">{t('dashboard.graphsEmpty')}</p>`.
- [ ] **Step 3: `RecentQueriesCard.tsx`** — props `{ entries: QueryHistoryEntry[]; onClear: () => void }` (the page passes `useQueryHistory(s => s.entries)` and `useQueryHistory(s => s.clear)`). test: with two entries → both shown; the first row is a `<Link>` whose `href` is `/?statement=<encoded first statement>`; the "clear" button calls `onClear`; with `entries=[]` → empty state. Implement: `<Card title={t('dashboard.recentTitle')} action={<button onClick={onClear}>{t('dashboard.clearHistory')}</button>} data-testid="dashboard-recent-card">` → `entries.length ? <ul>{entries.map(e => <li key={e.ranAt + e.statement} data-testid="dashboard-recent-row"><Link to={\`/?statement=\${encodeURIComponent(e.statement)}\`}>{truncate(e.statement, 80)}</Link> <span>{relativeTime(e.ranAt, t)}</span> <span>{e.rowCount == null ? t('dashboard.recentFailed') : t('common.rowCount', { count: e.rowCount })}</span></li>)}</ul> : <p role="note">{t('dashboard.recentEmpty')}</p>`. (`truncate` = a tiny local helper; `relativeTime` = a tiny local helper using `Date.now()` deltas → `t('dashboard.relMinutes', {n})` etc., OR just `new Date(e.ranAt).toLocaleString()` for v1 — simplest is the locale string; pick that to avoid an i18n'd relative-time block. The `<Link>` is from `react-router-dom` — the test must render inside a `<MemoryRouter>`.)
- [ ] **Step 4: `ConnectionCard.tsx`** — props `{ geodeVersion: string | null; adminWritable: AdminWritable | null; loading: boolean; error: string | null }`. test: with `geodeVersion='v0.5.11'` and all-false `adminWritable` → version shown + four "no" badges; loading/error states. Implement: `<Card title={t('dashboard.connectionTitle')} data-testid="dashboard-connection-card">` → `loading ? <p role="status">...</p> : error ? <p role="alert">{error}</p> : <><p>{t('dashboard.version', { version: geodeVersion ?? '—' })}</p><ul>{(['users','roles','policies','grants'] as const).map(k => <li key={k}>{k}: <Badge $on={!!adminWritable?.[k]}>{adminWritable?.[k] ? t('dashboard.capYes') : t('dashboard.capNo')}</Badge></li>)}</ul></>`. (`Badge` = a tiny styled-span, green-ish when `$on`, muted otherwise — `theme.colors.success` / `theme.text.muted`.)
- [ ] **Step 5: `GraphStatsCard.tsx`** — props `{ defaultGraph: string | null; stats: {nodes:number;edges:number} | null; loading: boolean; error: string | null; onLoad: () => void }`. test: `stats=null, loading=false` → a "Load stats" button (`data-testid="dashboard-stats-load"`) that calls `onLoad`; `loading` → `role="status"`; `stats={nodes:42,edges:99}` → "42" and "99" shown; `error` → `role="alert"`. Implement: `<Card title={t('dashboard.statsTitle', { graph: defaultGraph ?? '—' })} data-testid="dashboard-stats-card">` → `loading ? <p role="status">{t('dashboard.loading')}</p> : error ? <p role="alert">{error}</p> : stats ? <dl><dt>{t('dashboard.statsNodes')}</dt><dd>{stats.nodes}</dd><dt>{t('dashboard.statsEdges')}</dt><dd>{stats.edges}</dd></dl> : <button data-testid="dashboard-stats-load" onClick={onLoad} disabled={!defaultGraph}>{t('dashboard.statsLoad')}</button>`.
- [ ] **Step 6: Add the `dashboard.*` i18n keys** to `en.ts` (in the same commit as the components): `dashboard: { graphsTitle: 'Graphs ({{count}})', graphsEmpty: 'No graphs.', recentTitle: 'Recent queries', recentEmpty: 'No queries yet — run one on the Query page.', recentFailed: 'failed', clearHistory: 'Clear', connectionTitle: 'Connection', version: 'Geode {{version}}', capYes: 'enabled', capNo: 'disabled', statsTitle: '{{graph}} stats', statsLoad: 'Load stats', statsNodes: 'Nodes', statsEdges: 'Edges', loading: 'Loading…' }` (and `dashboard.title` for the page — Task B4). Run `npm run verify:translations` and `npm run detect:hardcoded-strings -- --strict`.
- [ ] **Step 7: Gates + commit** — `npx jest src/components/dashboard/ && npm run test:ts && npm run lint && npm run prettier:check && npm run detect:hardcoded-strings -- --strict && npm run verify:translations`, then:
```bash
git add src/components/dashboard/ src/services/i18n/locales/en.ts
git commit -m "feat(dashboard): Card shell + Graphs/RecentQueries/Connection/GraphStats cards"
```

---

## Task B4: `DashboardPage` + route + nav + `?statement=` prefill on `QueryPage`

**Files:**
- Create: `src/pages/DashboardPage.tsx` + `DashboardPage.test.tsx`
- Modify: `src/App.tsx` (the `/dashboard` route)
- Modify: `src/components/layout/Shell.tsx` (the `/dashboard` nav link in both blocks)
- Modify: `src/pages/QueryPage.tsx` + `QueryPage.test.tsx` (read `?statement=` on mount)
- Modify: `src/services/i18n/locales/en.ts` (`nav.dashboard`, `dashboard.title`)

- [ ] **Step 1: `?statement=` prefill on `QueryPage`** — test first (`QueryPage.test.tsx`): render `<MemoryRouter initialEntries={['/?statement=MATCH%20(x)%20RETURN%20x']}>...<QueryPage/></MemoryRouter>` → the editor's `value` is `MATCH (x) RETURN x`. Then implement in `QueryPage.tsx`: `import { useSearchParams } from 'react-router-dom'`; `const [searchParams, setSearchParams] = useSearchParams()`; a `useEffect(() => { const s = searchParams.get('statement'); if (s) { setStmt(s); const next = new URLSearchParams(searchParams); next.delete('statement'); setSearchParams(next, { replace: true }) } }, [])` (run once on mount — eslint-disable the deps warning or include the deps; clearing the param means a refresh doesn't re-apply it and a manual edit isn't clobbered). Commit this as part of B4.
- [ ] **Step 2: `DashboardPage.tsx`** — test (`DashboardPage.test.tsx`): mock the `client` (graphs/getCapabilities resolve) and seed `useQueryHistory` with one entry → renders all four cards (`getByTestId('dashboard-graphs-card')` etc.) with the data; render inside `<ThemeProvider>` + `<MemoryRouter>`. Implement:
```tsx
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useOverviewData } from '../lib/useOverviewData'
import { useQueryHistory } from '../lib/useQueryHistory'
import { GraphsCard } from '../components/dashboard/GraphsCard'
import { RecentQueriesCard } from '../components/dashboard/RecentQueriesCard'
import { ConnectionCard } from '../components/dashboard/ConnectionCard'
import { GraphStatsCard } from '../components/dashboard/GraphStatsCard'

const Grid = styled.div`
  display: grid;
  gap: ${({ theme }) => theme.spacing.md};
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  margin-top: ${({ theme }) => theme.spacing.md};
`

export const DashboardPage: React.FC = () => {
  const { t } = useTranslation()
  const ov = useOverviewData()
  const entries = useQueryHistory((s) => s.entries)
  const clear = useQueryHistory((s) => s.clear)
  const defaultGraph = ov.graphs && ov.graphs.length ? (ov.graphs.includes('default') ? 'default' : ov.graphs[0]) : null
  return (
    <div>
      <h1>{t('dashboard.title')}</h1>
      <Grid>
        <GraphsCard graphs={ov.graphs} loading={ov.loading} error={ov.graphsError} />
        <RecentQueriesCard entries={entries} onClear={clear} />
        <ConnectionCard geodeVersion={ov.geodeVersion} adminWritable={ov.adminWritable} loading={ov.loading} error={ov.capsError} />
        <GraphStatsCard defaultGraph={defaultGraph} stats={ov.defaultGraphStats} loading={ov.statsLoading} error={ov.statsError} onLoad={() => defaultGraph && ov.loadStats(defaultGraph)} />
      </Grid>
    </div>
  )
}
```
- [ ] **Step 3: route + nav + i18n** — `src/App.tsx`: `import { DashboardPage } from './pages/DashboardPage'`; `<Route path="dashboard" element={<DashboardPage />} />` inside `<ProtectedShell>`. `src/components/layout/Shell.tsx`: `<NavLink to="/dashboard">{t('nav.dashboard')}</NavLink>` in **both** the `<DesktopNav>` and the mobile `<Drawer>` (place it first, before "Query" — the dashboard is the overview; OR after "Profiles" — your call; first reads more naturally as a "home" link, but `/` is still the query page, so putting it right after the brand link / first in the nav is fine). `en.ts`: `nav.dashboard: 'Dashboard'`, `dashboard.title: 'Overview'`.
- [ ] **Step 4: Run tests + gates → PASS** — `npx jest src/pages/DashboardPage.test.tsx src/pages/QueryPage.test.tsx src/components/layout/ && npm run test:ts && npm run lint && npm run prettier:check && npm run detect:hardcoded-strings -- --strict && npm run verify:translations && npm test` (full).
- [ ] **Step 5: Commit** —
```bash
git add src/pages/DashboardPage.tsx src/pages/DashboardPage.test.tsx src/App.tsx src/components/layout/Shell.tsx src/pages/QueryPage.tsx src/pages/QueryPage.test.tsx src/services/i18n/locales/en.ts
git commit -m "feat(dashboard): /dashboard route; query page prefills from ?statement="
```

---

## Task B5: E2e — the dashboard renders and surfaces recent queries

**Files:**
- Create: `e2e/specs/22-dashboard.spec.ts`
- Modify: `e2e/helpers/selectors.ts` (`sel.dashboardGraphsCard`, `sel.dashboardRecentCard`, `sel.dashboardRecentRow`, `sel.dashboardConnectionCard`, `sel.dashboardStatsLoad`)

- [ ] **Step 1: Add the selectors** (match the file's shape):
```ts
dashboardGraphsCard: (p: Page) => p.getByTestId('dashboard-graphs-card'),
dashboardRecentCard: (p: Page) => p.getByTestId('dashboard-recent-card'),
dashboardRecentRow: (p: Page) => p.getByTestId('dashboard-recent-row'),
dashboardConnectionCard: (p: Page) => p.getByTestId('dashboard-connection-card'),
dashboardStatsLoad: (p: Page) => p.getByTestId('dashboard-stats-load'),
```
- [ ] **Step 2: Write `e2e/specs/22-dashboard.spec.ts`**:
```ts
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

test.describe('overview dashboard', () => {
  test('renders the cards and surfaces a recently-run query', async ({ authedPage: page }) => {
    await page.goto('/dashboard')
    await expect(sel.dashboardGraphsCard(page)).toBeVisible()
    await expect(sel.dashboardGraphsCard(page).getByText(seed.graph)).toBeVisible()
    await expect(sel.dashboardConnectionCard(page).getByText(/geode/i)).toBeVisible()
    // recent queries empty initially
    await expect(sel.dashboardRecentRow(page)).toHaveCount(0)

    // run a query on the query page
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(`USE GRAPH ${seed.graph}; MATCH (m:Movie) RETURN m LIMIT 2`)
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/2 rows/)).toBeVisible()

    // back to the dashboard — it's in recent queries
    await page.goto('/dashboard')
    await expect(sel.dashboardRecentRow(page).first()).toContainText('MATCH (m:Movie)')

    // clicking it prefills the query editor
    await sel.dashboardRecentRow(page).first().getByRole('link').click()
    await expect(page).toHaveURL(/\/\?statement=/)
    // the Monaco editor should now contain the statement (the value mirrors into a hidden textarea)
    await expect(page.locator('.monaco-editor')).toContainText('MATCH (m:Movie)')

    // and the graph-stats card can load stats for the default graph
    await page.goto('/dashboard')
    if (await sel.dashboardStatsLoad(page).isVisible()) {
      await sel.dashboardStatsLoad(page).click()
      await expect(page.getByTestId('dashboard-stats-card').getByText(/^\d+$/).first()).toBeVisible({ timeout: 10000 })
    }
  })
})
```
(Adjust `sel.queryRunBtn` to whatever the existing selector is named — `e2e/specs/05-query-graph.spec.ts` uses `sel.queryRunBtn(page).click()`. The "Monaco contains the statement" assertion: Monaco renders the text into the DOM as spans; `toContainText('MATCH (m:Movie)')` on the `.monaco-editor` locator works for short text. If flaky, instead assert `page.url()` includes the encoded statement and trust the unit test for the prefill behavior.)
- [ ] **Step 3: Rebuild + run** — `make e2e-up`, then `npm run e2e -- e2e/specs/22-dashboard.spec.ts` → PASS. Then `npm run e2e -- e2e/specs/03-query-sync.spec.ts e2e/specs/04-query-stream.spec.ts e2e/specs/05-query-graph.spec.ts e2e/specs/21-workspace.spec.ts` → all PASS (regression: B1 wired history-recording into the query page).
- [ ] **Step 4: Commit** —
```bash
git add e2e/specs/22-dashboard.spec.ts e2e/helpers/selectors.ts
git commit -m "test(e2e): overview dashboard renders cards and surfaces recent queries"
```

**End of Part B.** geode-ui has a `/dashboard` route with a graphs card, a recent-queries card (rows prefill the editor), a connection/capabilities card, and an on-demand graph-stats card. Ship as a PR.

---
---

## Self-Review

- **Spec coverage:** Part A: `ResultPanel` extraction → A0; `usePane` → A1; `WorkspacePane` → A2; `useWorkspacePanes` → A3; `WorkspacePage` + `/workspace` route + nav → A4; e2e → A5. Part B: `useQueryHistory` + record-on-completion in QueryPage **and** usePane → B1; `useOverviewData` (eager graphs+caps, on-demand default-graph stats) → B2; `Card` + 4 cards → B3; `DashboardPage` + `/dashboard` route + nav + `?statement=` prefill → B4; e2e → B5. The settled decisions (dashboard at `/dashboard`, `/` stays query; new `/workspace` route, tiled panes 2–4; `ResultPanel` extracted first; graph stats on-demand/default-graph-only) are all reflected. The "out of scope" exclusions (reagraph, charts, cross-pane sync, pane-set persistence, "duplicate query into new pane") are stated. ✅
- **Placeholder scan:** Part A's tasks (A0–A5) have real code, real test code, real commands, real i18n keys. Part B's data hooks (B1 `useQueryHistory`, B2 `useOverviewData`) have full code; B3's five cards are spec'd as five mini-TDD cycles with each card's exact props, the render-logic shape, and the test assertions (the exact JSX of each card's styled-components is a design detail left to the engineer within the named theme tokens — acceptable per "skilled developer, knows the toolset" once the props/logic/tests are pinned; not a "TBD"); B4's `DashboardPage` and the `?statement=` plumbing have full code. No "add error handling" hand-waves — each hook spells out its error states; each card test asserts the loading/error/empty branches. The places that say "confirm against X" / "adjust to the seed counts" / "match the file's `sel.*` shape" are real verify-at-implementation notes (the seed-data row counts, the exact `tabBg`/`tabColor`/`tabBorder` definitions in `QueryPage.tsx`, the exact zustand-`persist` curry style `useGraphPrefs.ts` uses), not placeholders.
- **Type/name consistency:** `ResultTab` (`'table'|'json'|'graph'|'matrix'`) defined in A0's `ResultPanel.tsx`, imported by `usePane` (A1), `QueryPage` (A0). `ResultPanelProps` consistent A0→A2→B4. `usePane()` → `Pane` shape (`statement/setStatement/tab/setTab/resp/err/busy/run/cancel`) used in A1's test and A2's `WorkspacePane`. `useWorkspacePanes()` → `{panes, addPane, removePane}` + `MAX_PANES` const, used in A3's test and A4's `WorkspacePage`. `QueryHistoryEntry` (`statement/ranAt/rowCount/ok`) + `MAX_HISTORY` + `useQueryHistory` (`{entries, record, clear}`) consistent B1→B3 (`RecentQueriesCard`)→B4. `useOverviewData()` → `OverviewData` shape consistent B2→B3→B4. `AdminWritable` is the existing type from `src/api/capabilities.ts` (used by `ConnectionCard` and `useOverviewData`). The `data-testid`s (`workspace-pane`, `workspace-add-pane`, `pane-run-btn`, `pane-close-btn`, `dashboard-graphs-card`, `dashboard-recent-card`, `dashboard-recent-row`, `dashboard-connection-card`, `dashboard-stats-card`, `dashboard-stats-load`, `result-fullscreen-toggle`) are named once and reused consistently in the components, the unit tests, the `sel.*` helpers, and the e2e specs.
- **One thing surfaced:** B1's "record from `runStream`'s `.then` reads stale `stream`" is a real gotcha — the plan flags it and prescribes the safe fix (record from a `useEffect` keyed on `stream.status` transitioning to `'done'`/`'error'`, capturing the run-time statement in a ref). The same applies in `usePane` — same fix prescribed. Don't let an implementer wire `record(...)` directly inside the `.then` closure reading `stream.rowCount`.
- **Dependency note:** B1 modifies `usePane.ts` (Part A's file) — so if Part B is executed before Part A, B1's `usePane` wiring is a no-op (the file doesn't exist yet) and the `usePane` test assertion is skipped; the plan's recommended order (A then B) avoids this. B3's `RecentQueriesCard` needs `QueryHistoryEntry` from B1, and B4's `DashboardPage` needs all of B1/B2/B3 — so within Part B the order is B1 → B2 → B3 → B4 → B5.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-12-geode-ui-workspace-and-dashboard.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task (or per part), review between, fast iteration. Start with Part A (and its Task A0 `ResultPanel` extraction first).

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
