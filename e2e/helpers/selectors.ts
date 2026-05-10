import { Page, Locator } from '@playwright/test'

// Central locator map — keeps tests stable when the UI markup shifts.
// Prefer role-based locators (most semantic, accessible). Fall back to
// CSS for things without a role (Monaco, cytoscape, the connection
// dropdown). If a selector starts being flaky, add a data-testid in
// the component and switch to that here.
export const sel = {
  // Login
  loginUsername: (p: Page): Locator => p.getByLabel('Username'),
  loginPassword: (p: Page): Locator => p.getByLabel('Password'),
  // Post-Plan-C the profile field is a clickable list of <button>s
  // populated from /api/v1/profiles/public. The text input variant
  // is the fallback when the public-list fetch fails. Tests that
  // need to "select default" should use the button-by-name selector;
  // this label-based locator only resolves on the fallback path.
  loginProfile: (p: Page): Locator => p.getByLabel('Profile'),
  // Login submit button — text is "Sign in" since the i18n migration.
  // EXACT match avoids collisions with profile-list buttons whose
  // descriptions contain the word "login" (post-Plan-C the LoginPage
  // shows a list of clickable profile buttons, and the e2e seed's
  // profile description happens to mention "login").
  loginSubmit: (p: Page): Locator =>
    p.getByRole('button', { name: 'Sign in', exact: true }),

  // Shell nav
  navQuery: (p: Page): Locator => p.getByRole('link', { name: 'Query' }),
  navSchema: (p: Page): Locator => p.getByRole('link', { name: 'Schema' }),
  navAdmin: (p: Page): Locator => p.getByRole('link', { name: 'Admin' }),
  navOps: (p: Page): Locator => p.getByRole('link', { name: 'Ops' }),
  logout: (p: Page): Locator => p.getByRole('button', { name: /logout/i }),
  // Post-Plan-C the connection surface is a button-driven dropdown
  // (ConnectionSwitcher) — NOT a <select>. The trigger displays the
  // active profile's name; the menu opens on click and rows expose
  // role=menuitemradio. Tests that previously did .selectOption(...)
  // need to click the trigger then click the desired menuitemradio.
  navProfiles: (p: Page): Locator => p.getByRole('link', { name: 'Profiles' }),
  connectionTrigger: (p: Page): Locator =>
    p.getByRole('button', { name: /default/i, exact: false }).first(),

  // Query page
  queryRunBtn: (p: Page): Locator => p.getByRole('button', { name: /run/i }),
  queryStreamToggle: (p: Page): Locator =>
    p.getByRole('checkbox', { name: 'Stream' }),
  // Result-view tabs are role="tab" (Tabs is role="tablist") since the
  // a11y refactor — the i18n labels stayed lowercase ('table', 'json',
  // 'graph') so the exact match still works.
  queryTabTable: (p: Page): Locator =>
    p.getByRole('tab', { name: 'table', exact: true }),
  queryTabJson: (p: Page): Locator =>
    p.getByRole('tab', { name: 'json', exact: true }),
  queryTabGraph: (p: Page): Locator =>
    p.getByRole('tab', { name: 'graph', exact: true }),
  cancelStream: (p: Page): Locator =>
    p.getByRole('button', { name: /cancel/i }),
  resultsTable: (p: Page): Locator => p.locator('table'),
  graphCanvas: (p: Page): Locator => p.locator('canvas'),

  // Admin
  newUserBtn: (p: Page): Locator =>
    p.getByRole('button', { name: /new user/i }),

  // Ops
  newBackupBtn: (p: Page): Locator =>
    p.getByRole('button', { name: /new backup/i }),
}
