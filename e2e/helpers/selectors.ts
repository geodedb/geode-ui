import { Page, Locator } from '@playwright/test'

// Central locator map — keeps tests stable when the UI markup shifts.
// Prefer role-based locators (most semantic, accessible). Fall back to
// CSS for things without a role (Monaco, cytoscape, the connection
// dropdown). If a selector starts being flaky, add a data-testid in
// the component and switch to that here.
export const sel = {
  // Login
  // LoginPage username/password are now <wa-input> shadow-DOM elements.
  // The visible <label> targets the wa-input HOST (htmlFor=wa-input id),
  // but the inner real <input> lives in the component's shadow tree —
  // playwright's getByLabel can't bridge that gap. Use the stable
  // test-ids on the host and chain `.locator('input')` so .fill()/.press()
  // operate on the actual input element (Playwright pierces shadow roots).
  loginUsername: (p: Page): Locator =>
    p.getByTestId('login-username').locator('input'),
  loginPassword: (p: Page): Locator =>
    p.getByTestId('login-password').locator('input'),
  // Login submit button — migrated to <wa-button data-testid="login-submit-btn">.
  // Both the host element and its shadow-DOM <button part="base"> carry
  // role="button" with the same accessible name, so role+name strict-mode
  // resolves two elements. Scope to the test-id (the wa-button host) to
  // pin the outer element.
  loginSubmit: (p: Page): Locator => p.getByTestId('login-submit-btn'),

  // Shell nav
  navQuery: (p: Page): Locator => p.getByRole('link', { name: 'Query' }),
  navSchema: (p: Page): Locator => p.getByRole('link', { name: 'Schema' }),
  navAdmin: (p: Page): Locator => p.getByRole('link', { name: 'Admin' }),
  logout: (p: Page): Locator => p.getByRole('button', { name: /logout/i }),
  // Post-Plan-C the connection surface is a button-driven dropdown
  // (ConnectionSwitcher) — NOT a <select>. The trigger displays the
  // active profile's name; the menu opens on click and rows expose
  // role=menuitemradio. Tests that previously did .selectOption(...)
  // need to click the trigger then click the desired menuitemradio.
  navProfiles: (p: Page): Locator => p.getByRole('link', { name: 'Profiles' }),
  navCluster: (p: Page): Locator => p.getByRole('link', { name: 'Cluster' }),
  connectionTrigger: (p: Page): Locator =>
    p.getByRole('button', { name: /default/i, exact: false }).first(),

  // Query page
  // Run button migrated to <wa-button data-testid="query-run-btn">; the
  // wrapper itself AND its shadow-DOM <button part="base"> both expose
  // role="button" with the same accessible name, so a bare role+name
  // lookup is now strict-mode-ambiguous. Scope to the test-id (the
  // wa-button host) to pin the outer element.
  queryRunBtn: (p: Page): Locator => p.getByTestId('query-run-btn'),
  queryStreamToggle: (p: Page): Locator =>
    p.getByTestId('query-options-stream'),
  queryOptionsTrigger: (p: Page): Locator =>
    p.getByTestId('query-options-dropdown'),
  queryOptionsExpand: (p: Page): Locator =>
    p.getByTestId('query-options-expand'),
  // Result-view tabs are role="tab" (Tabs is role="tablist") since the
  // a11y refactor — the i18n labels stayed lowercase ('table', 'json',
  // 'graph') so the exact match still works.
  queryTabTable: (p: Page): Locator =>
    p.getByRole('tab', { name: 'table', exact: true }),
  queryTabJson: (p: Page): Locator =>
    p.getByRole('tab', { name: 'json', exact: true }),
  queryTabGraph: (p: Page): Locator =>
    p.getByRole('tab', { name: 'graph', exact: true }),
  queryTabMatrix: (p: Page): Locator => p.getByRole('tab', { name: /matrix/i }),
  // Cancel button on QueryPage migrated to <wa-button data-testid="query-cancel-btn">.
  // Same shadow-DOM ambiguity as queryRunBtn — use the test-id.
  cancelStream: (p: Page): Locator => p.getByTestId('query-cancel-btn'),
  resultsTable: (p: Page): Locator => p.locator('table'),
  graphCanvas: (p: Page): Locator => p.locator('canvas'),
  // Result-panel maximize/fullscreen toggle + the fixed inset:0 overlay
  // it opens. Lives in the result-panel toolbar (the Tabs row) so it
  // works for whichever tab (table/json/graph) is active.
  resultFullscreenToggle: (p: Page): Locator =>
    p.getByTestId('result-fullscreen-toggle'),
  resultFullscreenOverlay: (p: Page): Locator =>
    p.getByTestId('result-fullscreen-overlay'),
  // Phase-1 graph-viz feature controls (GraphView toolbar).
  //
  // The layout picker was a native <select> through v0.1.x. As of the
  // Bug-C fix it's a Bootstrap dropdown: the trigger button keeps the
  // 'graph-layout-picker' test-id; the options live in a sibling
  // role=listbox menu and surface as role=option entries keyed by the
  // i18n-translated label ("Force (cose)", "Force (fast)", "Layered
  // (DAG)", "Breadth-first", "Circle", "Concentric", "Grid", "Spread
  // (anti-overlap)"). Use selectGraphLayout(page, layoutName) below
  // to open the trigger and click the matching option; .selectOption
  // / .toHaveValue() will no longer work against this picker.
  graphLayoutPicker: (p: Page): Locator => p.getByTestId('graph-layout-picker'),
  graphSelectionMode: (p: Page): Locator =>
    p.getByTestId('graph-selection-mode'),
  graphClusterToggle: (p: Page): Locator =>
    p.getByTestId('graph-cluster-toggle'),
  graphPathMode: (p: Page): Locator => p.getByTestId('graph-path-mode'),
  graphPathClear: (p: Page): Locator => p.getByTestId('graph-path-clear'),
  // Phase-2 node-inspector workflow (GraphView): the inspector action
  // buttons and the sidebar Hidden/Collapsed restore lists. The
  // graph-node-id-picker sidebar control was removed in Task 3.3 —
  // use page.getByTestId('graph-find-input') for node selection in E2E.
  graphActionHide: (p: Page): Locator => p.getByTestId('graph-action-hide'),
  graphActionCollapse: (p: Page): Locator =>
    p.getByTestId('graph-action-collapse'),
  graphActionExplore: (p: Page): Locator =>
    p.getByTestId('graph-action-explore'),
  graphHiddenList: (p: Page): Locator => p.getByTestId('graph-hidden-list'),
  graphCollapsedList: (p: Page): Locator =>
    p.getByTestId('graph-collapsed-list'),
  // The GraphView sidebar (the 280px column holding the display
  // controls + the property inspector), its collapse/expand toggle in
  // the canvas toolbar, and the display-controls block inside it.
  graphSidebar: (p: Page): Locator => p.getByTestId('graph-sidebar'),
  // Sidebar toggle migrated from an inline toolbar button to a checkbox
  // item inside GraphToolbarMore. The new testid is graph-more-sidebar.
  graphSidebarToggle: (p: Page): Locator => p.getByTestId('graph-more-sidebar'),
  graphDisplayControls: (p: Page): Locator =>
    p.getByTestId('graph-display-controls'),
  // GraphToolbarMore overflow dropdown selectors.
  // graph-toolbar-more is the wa-dropdown host (no visible bounding
  // box on its own); the clickable trigger is the slot=trigger
  // wa-button child carrying graph-toolbar-more-trigger.
  graphToolbarMore: (p: Page): Locator =>
    p.getByTestId('graph-toolbar-more-trigger'),
  graphMoreMiniMap: (p: Page): Locator => p.getByTestId('graph-more-minimap'),
  graphMoreLasso: (p: Page): Locator => p.getByTestId('graph-more-lasso'),
  graphMoreDomNodes: (p: Page): Locator => p.getByTestId('graph-more-domnodes'),
  graphMoreSidebar: (p: Page): Locator => p.getByTestId('graph-more-sidebar'),
  // graph-find-input is a <wa-input> (Web Awesome custom element). The
  // shadow DOM <input> inside it is what Playwright can .fill()/.press()
  // on. Use this selector to get the actual input element directly.
  graphFindInput: (p: Page): Locator =>
    p.getByTestId('graph-find-input').locator('input'),
  // On-canvas zoom/fit/reset controls (GraphCanvasControls pill).
  // These replaced the toolbar buttons (graph-zoom-in / graph-zoom-out /
  // graph-fit / graph-reset-view) that were removed in Task 6.
  graphCanvasZoomIn: (p: Page): Locator =>
    p.getByTestId('graph-canvas-zoom-in'),
  graphCanvasZoomOut: (p: Page): Locator =>
    p.getByTestId('graph-canvas-zoom-out'),
  graphCanvasZoomSlider: (p: Page): Locator =>
    p.getByTestId('graph-canvas-zoom-slider'),
  graphCanvasFit: (p: Page): Locator => p.getByTestId('graph-canvas-fit'),
  graphCanvasReset: (p: Page): Locator => p.getByTestId('graph-canvas-reset'),

  // Overview dashboard (22-dashboard.spec.ts) — mounted at /dashboard. An
  // <h1> "Overview" plus a grid of 4 cards: GraphsCard
  // (dashboard-graphs-card, a <ul> of graph names), RecentQueriesCard
  // (dashboard-recent-card, <li data-testid="dashboard-recent-row"> rows
  // each deep-linking to /?statement=…), ConnectionCard
  // (dashboard-connection-card, "Geode v…" + 4 capability badges), and
  // GraphStatsCard (dashboard-stats-card; until loaded it shows only the
  // dashboard-stats-load button which runs the count() scans).
  dashboardGraphsCard: (p: Page): Locator =>
    p.getByTestId('dashboard-graphs-card'),
  dashboardRecentCard: (p: Page): Locator =>
    p.getByTestId('dashboard-recent-card'),
  dashboardRecentRow: (p: Page): Locator =>
    p.getByTestId('dashboard-recent-row'),
  dashboardConnectionCard: (p: Page): Locator =>
    p.getByTestId('dashboard-connection-card'),
  dashboardClusterCard: (p: Page): Locator =>
    p.getByTestId('dashboard-cluster-card'),
  dashboardStatsLoad: (p: Page): Locator =>
    p.getByTestId('dashboard-stats-load'),

  // Admin
  newUserBtn: (p: Page): Locator =>
    p.getByRole('button', { name: /new user/i }),
  // Phase-1 Admin RBAC CTA gating (driven by GET /api/v1/capabilities).
  // Each create CTA carries a stable data-testid so the e2e suite can
  // assert it is gated (hidden, or rendered `disabled` with an
  // explanatory title) when the connected Geode build lacks the admin
  // DDL. The "unsupported" affordance is the inline note/tooltip text.
  adminNewUserBtn: (p: Page): Locator => p.getByTestId('admin-new-user-btn'),
  adminNewRoleBtn: (p: Page): Locator => p.getByTestId('admin-new-role-btn'),
  adminNewPolicyBtn: (p: Page): Locator =>
    p.getByTestId('admin-new-policy-btn'),
  adminGrantsApplyBtn: (p: Page): Locator =>
    p.getByTestId('admin-grants-apply-btn'),
  adminGrantsRevokeBtn: (p: Page): Locator =>
    p.getByTestId('admin-grants-revoke-btn'),
  adminUsersUnsupported: (p: Page): Locator =>
    p.getByTestId('admin-users-unsupported'),
  adminRolesUnsupported: (p: Page): Locator =>
    p.getByTestId('admin-roles-unsupported'),
  adminPoliciesUnsupported: (p: Page): Locator =>
    p.getByTestId('admin-policies-unsupported'),
  adminGrantsUnsupported: (p: Page): Locator =>
    p.getByTestId('admin-grants-unsupported'),

  // Ops
  newBackupBtn: (p: Page): Locator =>
    p.getByRole('button', { name: /new backup/i }),

  // Profiles page (14-profiles-page.spec.ts)
  // The Create button uses i18n key `profiles.actions.create` ("Create profile").
  // Per-row Edit/Delete/Set-as-default labels come from
  // profiles.actions.{edit,delete,setDefault}; their visibility depends on
  // (isAdmin || row.dsn !== '') per ProfilesPage.tsx render gate.
  profilesCreateBtn: (p: Page): Locator =>
    p.getByRole('button', { name: 'Create profile', exact: true }),
  profilesNameCell: (p: Page, name: string): Locator =>
    p
      .getByRole('row', { name: new RegExp(name) })
      .getByRole('cell', { name, exact: true })
      .first(),
  profilesEditBtn: (p: Page, rowName: string): Locator =>
    p
      .getByRole('row', { name: new RegExp(rowName) })
      .getByRole('button', { name: 'Edit', exact: true }),
  profilesDeleteBtn: (p: Page, rowName: string): Locator =>
    p
      .getByRole('row', { name: new RegExp(rowName) })
      .getByRole('button', { name: 'Delete', exact: true }),
  profilesSetDefaultBtn: (p: Page, rowName: string): Locator =>
    p
      .getByRole('row', { name: new RegExp(rowName) })
      .getByRole('button', { name: 'Set as default', exact: true }),
  profilesSetDefaultError: (p: Page): Locator =>
    p.getByTestId('profiles-set-default-error'),

  // Profile editor modal (ProfileEditorModal.tsx)
  // Field labels resolve to profiles.editor.field.{name,dsn,description,...}.
  // Required-field labels render the i18n string + an aria-hidden "*"
  // with NO whitespace, so the visible label text is "Name*" / "DSN*"
  // rather than "Name" / "DSN". getByLabel('Name', { exact: true })
  // returns 0 matches against that markup, so the required inputs are
  // located by their stable component-assigned ids instead. The
  // optional Description field (no asterisk) stays on getByLabel.
  profileEditorNameInput: (p: Page): Locator => p.locator('#profile-name'),
  profileEditorDsnInput: (p: Page): Locator => p.locator('#profile-dsn'),
  // exact: true is required because the modal also renders "Default
  // for this scope" as a checkbox label, which substring-matches "Scope".
  profileEditorScopeSelect: (p: Page): Locator =>
    p.getByLabel('Scope', { exact: true }),
  profileEditorCaPem: (p: Page): Locator =>
    p.getByLabel('CA PEM', { exact: true }),
  // Editor submit button text resolves to i18n key
  // `profiles.editor.actions.save` ("Save") in BOTH create and edit
  // modes — confirmed against src/services/i18n/locales/en.ts:344-347.
  profileEditorSaveBtn: (p: Page): Locator =>
    p.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }),
  profileEditorCancelBtn: (p: Page): Locator =>
    p.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }),

  // Delete confirmation modal (DeleteProfileModal.tsx)
  profileDeleteConfirmBtn: (p: Page): Locator =>
    p.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }),
  profileDeleteError: (p: Page): Locator =>
    p.getByTestId('delete-profile-error'),

  // AddConnectionModal (AddConnectionModal.tsx)
  // The trigger lives inside the ConnectionSwitcher menu — not a top-level
  // button. We exercise it by opening the switcher and clicking the
  // "Add another connection" affordance, OR by opening the empty-state
  // Connect button. The submit button is the modal's primary action.
  addConnectionMenuItem: (p: Page): Locator =>
    p.getByRole('menuitem', { name: /add another connection/i }),
  addConnectionPublicProfileWarning: (p: Page): Locator =>
    p.getByTestId('add-connection-public-profile-warning'),
  addConnectionAuthedProfileWarning: (p: Page): Locator =>
    p.getByTestId('add-connection-authed-profile-warning'),
  // The modal's submit button reuses the i18n key `auth.signInButton`
  // ("Sign in"), shared with LoginPage. Dialog-scoped so it doesn't
  // collide with the LoginPage button if both are reachable from the
  // same render tree.
  addConnectionSubmit: (p: Page): Locator =>
    p.getByRole('dialog').getByRole('button', { name: /^sign in$/i }),

  // ConnectionSwitcher (ConnectionSwitcher.tsx)
  // Disconnect buttons are aria-labeled "Disconnect: <profileName>".
  connectionDisconnect: (p: Page, profileName: string): Locator =>
    p.getByRole('button', { name: `Disconnect: ${profileName}` }),
  connectionMenuItemRadio: (p: Page, profileName: string): Locator =>
    p.getByRole('menuitemradio', { name: profileName }),

  // Cluster page (30-cluster.spec.ts) — full Raft membership view at
  // /cluster. The page branches on hook state and always exposes a
  // refresh button. Either the members table OR the standalone panel
  // is present at any given time depending on whether the connected
  // Geode is clustered.
  clusterMembersTable: (p: Page): Locator =>
    p.getByTestId('cluster-members-table'),
  clusterMemberRow: (p: Page): Locator =>
    p.getByTestId('cluster-member-row'),
  clusterRefreshBtn: (p: Page): Locator =>
    p.getByTestId('cluster-refresh-btn'),
  clusterStandalonePanel: (p: Page): Locator =>
    p.getByTestId('cluster-standalone-panel'),
  clusterRoleChip: (p: Page): Locator => p.getByTestId('cluster-role-chip'),
}

// Translated layout-picker labels (en.ts: graph.layout.*). Tests use
// these to address Bootstrap-dropdown option rows by their accessible
// name. Update in lockstep with src/services/i18n/locales/en.ts.
const LAYOUT_LABELS: Record<string, RegExp> = {
  cose: /Force \(cose\)/i,
  fcose: /Force \(fast\)/i,
  dagre: /Layered \(DAG\)/i,
  breadthfirst: /Breadth-first/i,
  circle: /^Circle$/i,
  concentric: /Concentric/i,
  grid: /^Grid$/i,
  spread: /Spread \(anti-overlap\)/i,
}

/**
 * Open the graph layout dropdown and select the entry that maps to the
 * given layout name. Replaces the legacy `.selectOption(layoutName)`
 * pattern that worked against the native <select>.
 */
export async function selectGraphLayout(
  page: Page,
  layoutName: keyof typeof LAYOUT_LABELS
): Promise<void> {
  const trigger = sel.graphLayoutPicker(page)
  await trigger.click()
  const labelRe = LAYOUT_LABELS[layoutName]
  if (!labelRe) {
    throw new Error(`Unknown layout name: ${layoutName}`)
  }
  await page.getByRole('option', { name: labelRe }).click()
}

/**
 * Assert that the layout picker's currently displayed selection matches
 * the given layout name (by its translated label). Replaces
 * `expect(picker).toHaveValue('grid')` against the legacy <select>.
 */
export function expectGraphLayoutLabel(
  page: Page,
  layoutName: keyof typeof LAYOUT_LABELS
): Locator {
  // Callers do `await expect(<returned-locator>).toBeVisible()` (or chain
  // a text assertion). Returning the trigger Locator filtered by the
  // translated label keeps the spec-side assertion ergonomic.
  const labelRe = LAYOUT_LABELS[layoutName]
  return sel.graphLayoutPicker(page).filter({ hasText: labelRe })
}
