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
  loginProfile: (p: Page): Locator => p.getByLabel('Profile'),
  // Login submit button — text is "Sign in" since the i18n migration.
  // Regex tolerates "log in" as well in case the copy flips back.
  loginSubmit: (p: Page): Locator =>
    p.getByRole('button', { name: /sign in|log\s*in/i }),

  // Shell nav
  navQuery: (p: Page): Locator => p.getByRole('link', { name: 'Query' }),
  navSchema: (p: Page): Locator => p.getByRole('link', { name: 'Schema' }),
  navAdmin: (p: Page): Locator => p.getByRole('link', { name: 'Admin' }),
  navOps: (p: Page): Locator => p.getByRole('link', { name: 'Ops' }),
  logout: (p: Page): Locator => p.getByRole('button', { name: /logout/i }),
  connection: (p: Page): Locator => p.locator('select').first(),

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
