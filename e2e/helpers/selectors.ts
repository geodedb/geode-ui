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
  // Result-panel maximize/fullscreen toggle + the fixed inset:0 overlay
  // it opens. Lives in the result-panel toolbar (the Tabs row) so it
  // works for whichever tab (table/json/graph) is active.
  resultFullscreenToggle: (p: Page): Locator =>
    p.getByTestId('result-fullscreen-toggle'),
  resultFullscreenOverlay: (p: Page): Locator =>
    p.getByTestId('result-fullscreen-overlay'),

  // Admin
  newUserBtn: (p: Page): Locator =>
    p.getByRole('button', { name: /new user/i }),

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
}
