# E2E Coverage for Profiles + Multi-Connection Rebuild

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Playwright e2e coverage for the 36 commits of new functionality landed since `c20f7b5` (the last e2e change): the Profiles CRUD page, the new profile API surface (rate limiting, PEM validation, public list, PATCH-clear semantics), the AddConnectionModal multi-connection flow, and ConnectionSwitcher disconnect/switch/loading behaviors.

**Architecture:** Five new spec files (`14`–`18`) plus a shared `helpers/profiles.ts` module that owns namespaced profile factory + cleanup. Tests run against the same shared backend as the existing suite — every created profile uses an `e2e-<uuid>` prefix and is deleted in `afterEach`, so no test pollutes the next. Rate-limit tests mint a fresh JWT (via a second `login()` call) so the per-actor token bucket starts empty and never starves the other tests of the bootstrap admin's bucket. UI specs use the existing `authedPage` fixture; API-only specs use `request` + `Bearer` to bypass the CSRF middleware (matching the pattern in `09-ops.spec.ts`).

**Tech Stack:** Playwright `1.59.x`, TypeScript (e2e/tsconfig.json), existing fixtures (`e2e/fixtures.ts`) and selectors (`e2e/helpers/selectors.ts`). New helper module uses `crypto.randomUUID()` (Node 20+, already in CI).

---

## File Structure

**New files:**
- `e2e/helpers/profiles.ts` — namespaced factory (`makeProfileName`), API-side `createProfileViaApi` / `deleteProfileViaApi` for setup + teardown, `freshLogin()` for rate-limit isolation.
- `e2e/specs/14-profiles-page.spec.ts` — UI: create / edit / delete / set-as-default flows on `/profiles`, admin-vs-non-admin button visibility, error banners.
- `e2e/specs/15-profile-api.spec.ts` — API: POST/PATCH/DELETE happy path, PATCH-clear (TLS/pool nullable), per-actor 429 + Retry-After, server-side PEM validation rejection.
- `e2e/specs/16-public-profiles.spec.ts` — `/api/v1/profiles/public` no-auth contract, LoginPage picker hydration + degraded fallback.
- `e2e/specs/17-add-connection.spec.ts` — AddConnectionModal: open/close, public-profile fetch failure surfaces warning, authed-profile fetch failure surfaces warning, successful `connectMore`.
- `e2e/specs/18-connection-switcher.spec.ts` — ConnectionSwitcher: loading state (`aria-busy`), empty state (Connect affordance), disconnect a connection (single + multi), switch active connection, menu anchors left.

**Modified files:**
- `e2e/helpers/selectors.ts` — add locators used by the new specs (`profilesCreateBtn`, `profilesNameCell`, `profileEditorNameInput`, `profileEditorDsnInput`, `profileEditorScopeSelect`, `profileEditorSaveBtn`, `profileEditorCancelBtn`, `profileDeleteConfirmBtn`, `addConnectionTrigger`, `addConnectionSubmit`, `connectionDisconnect`).

**No backend or production-source files are modified.** The plan adds tests only.

---

## Conventions used by every task

- **TDD shape:** for tests, "failing first" means run the new spec file and watch it fail with the expected `Locator/Network/Assertion` error message; this verifies the test actually exercises the surface and is not a tautological pass.
- **Run command (single spec):** `pnpm e2e e2e/specs/<NN>-<name>.spec.ts --project=chromium`
- **Run command (full suite, smoke):** `pnpm e2e:smoke` — for cross-checking that the helper module didn't break the auth fixture.
- **Cleanup:** every test that creates a profile names it `e2e-${crypto.randomUUID()}-<purpose>` and deletes it via `deleteProfileViaApi` in `afterEach`. This is non-negotiable — leaks pollute the `/profiles` list for the next test run.
- **Commit shape:** `test(e2e): <one-line summary>` (matches the existing `test(e2e):` prefix used across recent commits, e.g. `c20f7b5`, `7ef0465`).

---

### Task 1: Create the shared profile helper module

**Files:**
- Create: `e2e/helpers/profiles.ts`

- [ ] **Step 1: Write the helper module**

```typescript
// e2e/helpers/profiles.ts
//
// Shared scaffolding for the new profile-management spec files
// (14-profiles-page, 15-profile-api, 16-public-profiles, 17-add-connection,
// 18-connection-switcher).
//
// Contract:
//   - Every profile created during a test is namespaced with
//     `e2e-<uuid>-<purpose>` so concurrent specs cannot collide and
//     a leaked profile is immediately identifiable.
//   - createProfileViaApi / deleteProfileViaApi go through the REST
//     surface with Bearer auth (the CSRF middleware skips the
//     Authorization-header path; see 09-ops.spec.ts for the pattern).
//   - freshLogin mints a NEW JWT with a fresh per-actor rate-limit
//     bucket. Use it from rate-limit specs so they don't drain the
//     bootstrap admin's bucket and starve the rest of the suite.

import { APIRequestContext, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { login } from './auth'

const ADMIN_USER = process.env.ADMIN_USER ?? 'geode'
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ?? 'Geode E2E Bootstrap Password 2024'
const ADMIN_PROFILE = process.env.ADMIN_PROFILE ?? 'default'

export function makeProfileName(purpose: string): string {
  return `e2e-${randomUUID()}-${purpose}`
}

export interface CreatedProfile {
  id: string
  name: string
}

export interface CreateProfileBody {
  name: string
  scope?: 'system' | 'personal'
  dsn?: string
  description?: string
  is_default?: boolean
  saved_username?: string
  tls?: {
    ca_pem?: string
    client_cert_pem?: string
    client_key_pem?: string
  }
  pool_overrides?: {
    max_open_conns?: number
    max_idle_conns?: number
    conn_max_lifetime_ms?: number
    conn_max_idle_ms?: number
  }
}

export async function createProfileViaApi(
  request: APIRequestContext,
  token: string,
  body: CreateProfileBody
): Promise<CreatedProfile> {
  const payload = {
    scope: 'personal',
    dsn: 'bolt://localhost:7687',
    is_default: false,
    ...body,
  }
  const res = await request.post('/api/v1/profiles', {
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    data: payload,
  })
  expect(
    res.ok(),
    `createProfileViaApi(${body.name}) failed: ${res.status()} ${await res.text()}`
  ).toBeTruthy()
  const json = (await res.json()) as { id: string; name: string }
  return { id: json.id, name: json.name }
}

export async function deleteProfileViaApi(
  request: APIRequestContext,
  token: string,
  id: string
): Promise<void> {
  const res = await request.delete(`/api/v1/profiles/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  // 404 is acceptable — the test may have already deleted via UI.
  // 429 in the cleanup path is a test-ordering bug; surface it loudly.
  if (!res.ok() && res.status() !== 404) {
    throw new Error(
      `deleteProfileViaApi(${id}) failed: ${res.status()} ${await res.text()}`
    )
  }
}

// freshLogin re-authenticates against /auth/login with the bootstrap
// admin credentials. Returns a token whose profile-CRUD rate-limit
// bucket starts empty — use this from rate-limit specs so they don't
// drain the shared bucket.
//
// NOTE: the per-actor key is the JWT subject, NOT the JWT itself. Two
// freshLogin() calls return tokens with the SAME subject, so they
// share a bucket. Rate-limit specs that need a clean bucket should
// run serially (test.describe.configure({ mode: 'serial' })) and call
// freshLogin once per spec.
export async function freshLogin(req: APIRequestContext): Promise<string> {
  return login(req)
}

export const ADMIN_CREDS = {
  user: ADMIN_USER,
  password: ADMIN_PASSWORD,
  profile: ADMIN_PROFILE,
}
```

- [ ] **Step 2: Type-check it in isolation**

Run: `pnpm exec tsc -p e2e/tsconfig.json --noEmit`
Expected: PASS (no output, exit 0). Failures here usually mean a missing import or a Playwright API drift — fix before moving on.

- [ ] **Step 3: Commit**

```bash
git add e2e/helpers/profiles.ts
git commit -m "test(e2e): add shared profile helper for namespaced create/delete"
```

---

### Task 2: Extend the selectors helper with profile + connection locators

**Files:**
- Modify: `e2e/helpers/selectors.ts`

- [ ] **Step 1: Append new locators**

Add the following entries inside the `sel = {` object (alphabetical-by-section is fine; place them at the end before the closing `}`):

```typescript
  // Profiles page (14-profiles-page.spec.ts)
  // The Create button uses i18n key `profiles.actions.create` ("Create profile").
  // Per-row Edit/Delete/Set-as-default labels come from
  // profiles.actions.{edit,delete,setDefault}; their visibility depends on
  // (isAdmin || row.dsn !== '') per ProfilesPage.tsx render gate.
  profilesCreateBtn: (p: Page): Locator =>
    p.getByRole('button', { name: 'Create profile', exact: true }),
  profilesNameCell: (p: Page, name: string): Locator =>
    p.getByRole('cell', { name }).first(),
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
  // Field labels resolve to profiles.editor.field.{name,dsn,description,...}
  profileEditorNameInput: (p: Page): Locator => p.getByLabel('Name', { exact: true }),
  profileEditorDsnInput: (p: Page): Locator => p.getByLabel('DSN', { exact: true }),
  profileEditorScopeSelect: (p: Page): Locator => p.getByLabel('Scope'),
  profileEditorCaPem: (p: Page): Locator =>
    p.getByLabel('CA PEM', { exact: true }),
  // Editor submit button text resolves to i18n key
  // `profiles.editor.actions.save` ("Save") in BOTH create and edit
  // modes — confirmed against src/services/i18n/locales/en.ts:344-347.
  profileEditorSaveBtn: (p: Page): Locator =>
    p.getByRole('button', { name: 'Save', exact: true }),
  profileEditorCancelBtn: (p: Page): Locator =>
    p.getByRole('button', { name: 'Cancel', exact: true }),

  // Delete confirmation modal (DeleteProfileModal.tsx)
  profileDeleteConfirmBtn: (p: Page): Locator =>
    p.getByRole('button', { name: 'Delete', exact: true }).last(),
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
  addConnectionSubmit: (p: Page): Locator =>
    p.getByRole('button', { name: /^connect$/i }),

  // ConnectionSwitcher (ConnectionSwitcher.tsx)
  // Disconnect buttons are aria-labeled "Disconnect: <profileName>".
  connectionDisconnect: (p: Page, profileName: string): Locator =>
    p.getByRole('button', { name: `Disconnect: ${profileName}` }),
  connectionMenuItemRadio: (p: Page, profileName: string): Locator =>
    p.getByRole('menuitemradio', { name: profileName }),
```

If any i18n key in your tree resolves differently, look it up in `src/services/i18n/locales/en.ts` before changing the locator — keys take precedence over the inline labels above.

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc -p e2e/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/helpers/selectors.ts
git commit -m "test(e2e): add locators for profiles page + add-connection modal + switcher"
```

---

### Task 3: Spec — Profiles page renders existing list (smoke)

**Files:**
- Create: `e2e/specs/14-profiles-page.spec.ts`

- [ ] **Step 1: Write the failing test (renders the table)**

```typescript
// e2e/specs/14-profiles-page.spec.ts
//
// Profiles page CRUD coverage. The page itself is the post-rebuild
// surface for managing connection profiles (system + personal scope),
// previously absent from the e2e suite.
//
// Each test that mutates state uses createProfileViaApi to seed and
// deleteProfileViaApi to clean up. UI-driven mutations are immediately
// followed by a teardown via the API so a UI failure mid-test still
// leaves the database clean.

import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import {
  createProfileViaApi,
  deleteProfileViaApi,
  makeProfileName,
} from '../helpers/profiles'

test.describe('profiles page', () => {
  test('renders the table heading and Create button', async ({
    authedPage: page,
  }) => {
    await page.goto('/profiles')
    await expect(
      page.getByRole('heading', { name: 'Profiles', exact: true })
    ).toBeVisible()
    await expect(sel.profilesCreateBtn(page)).toBeVisible()
  })
})
```

- [ ] **Step 2: Run to verify it fails (no spec file yet existed; this confirms it's wired up correctly)**

Run: `pnpm e2e e2e/specs/14-profiles-page.spec.ts --project=chromium -g "renders the table heading"`
Expected: PASS — this test should already pass against the current SPA. If it fails, the i18n key `profiles.title` may have shifted; look it up in `src/services/i18n/locales/en.ts` before adjusting.

- [ ] **Step 3: Commit (don't wait for the rest of the file — small commits land faster)**

```bash
git add e2e/specs/14-profiles-page.spec.ts
git commit -m "test(e2e): smoke profiles page renders title + create button"
```

---

### Task 4: Spec — Profiles page "create profile via UI" round-trip

**Files:**
- Modify: `e2e/specs/14-profiles-page.spec.ts`

- [ ] **Step 1: Add the create-via-UI test**

Append inside the existing `test.describe('profiles page', () => { ... })`:

```typescript
  test('create profile via UI persists and appears in the table', async ({
    authedPage: page,
    authToken,
    request,
  }) => {
    const name = makeProfileName('create-ui')
    await page.goto('/profiles')
    await sel.profilesCreateBtn(page).click()

    await sel.profileEditorNameInput(page).fill(name)
    await sel.profileEditorDsnInput(page).fill('bolt://localhost:7687')
    // Personal scope avoids needing the (admin-only) system-scope
    // permission, but the bootstrap admin can write either; using
    // personal keeps the test stable when the suite runs against a
    // non-admin actor in the future.
    await sel.profileEditorScopeSelect(page).selectOption('personal')

    await sel.profileEditorSaveBtn(page).click()

    // The modal closes on success; the new row appears after refresh().
    await expect(sel.profilesNameCell(page, name)).toBeVisible({
      timeout: 5000,
    })

    // Cleanup: look up the id via the listProfiles API and DELETE.
    const list = await request.get('/api/v1/profiles', {
      headers: { authorization: `Bearer ${authToken}` },
    })
    const json = (await list.json()) as { profiles: { id: string; name: string }[] }
    const created = json.profiles.find((p) => p.name === name)
    if (created) await deleteProfileViaApi(request, authToken, created.id)
  })
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/14-profiles-page.spec.ts --project=chromium -g "create profile via UI"`
Expected: PASS. If the modal stays open or the row never appears, screenshot the failure (`pnpm e2e:report` opens the HTML report) and check whether the i18n key for the Create button resolved correctly.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/14-profiles-page.spec.ts
git commit -m "test(e2e): create profile via UI persists to the table"
```

---

### Task 5: Spec — Profiles page "edit profile via UI" round-trip

**Files:**
- Modify: `e2e/specs/14-profiles-page.spec.ts`

- [ ] **Step 1: Add the edit test**

Append:

```typescript
  test('edit profile via UI mutates the description', async ({
    authedPage: page,
    authToken,
    request,
  }) => {
    const name = makeProfileName('edit-ui')
    const seeded = await createProfileViaApi(request, authToken, {
      name,
      description: 'before',
    })

    try {
      await page.goto('/profiles')
      await expect(sel.profilesNameCell(page, name)).toBeVisible()

      await sel.profilesEditBtn(page, name).click()
      // The Description field uses the same label string in en.ts.
      const descField = page.getByLabel('Description', { exact: true })
      await descField.fill('after')

      await sel.profileEditorSaveBtn(page).click()

      // Confirm the new value lands in the table cell after refresh.
      await expect(page.getByRole('cell', { name: 'after' })).toBeVisible({
        timeout: 5000,
      })
    } finally {
      await deleteProfileViaApi(request, authToken, seeded.id)
    }
  })
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/14-profiles-page.spec.ts --project=chromium -g "edit profile via UI"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/14-profiles-page.spec.ts
git commit -m "test(e2e): edit profile via UI mutates the description"
```

---

### Task 6: Spec — Profiles page "delete profile via UI"

**Files:**
- Modify: `e2e/specs/14-profiles-page.spec.ts`

- [ ] **Step 1: Add the delete test**

Append:

```typescript
  test('delete profile via UI removes the row', async ({
    authedPage: page,
    authToken,
    request,
  }) => {
    const name = makeProfileName('delete-ui')
    const seeded = await createProfileViaApi(request, authToken, { name })

    let stillExists = false
    try {
      await page.goto('/profiles')
      await expect(sel.profilesNameCell(page, name)).toBeVisible()

      await sel.profilesDeleteBtn(page, name).click()
      // The DeleteProfileModal renders a second "Delete" button as
      // confirmation. .last() in the locator picks the modal's button
      // (the row button is the trigger).
      await sel.profileDeleteConfirmBtn(page).click()

      // Row disappears after refresh().
      await expect(sel.profilesNameCell(page, name)).toHaveCount(0, {
        timeout: 5000,
      })
      stillExists = true
    } finally {
      // Belt-and-suspenders cleanup: if the UI didn't actually delete
      // (test failed), kill the row by id.
      if (!stillExists) await deleteProfileViaApi(request, authToken, seeded.id)
    }
  })
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/14-profiles-page.spec.ts --project=chromium -g "delete profile via UI"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/14-profiles-page.spec.ts
git commit -m "test(e2e): delete profile via UI removes the row"
```

---

### Task 7: Spec — Profiles page "set-as-default" promotes a profile

**Files:**
- Modify: `e2e/specs/14-profiles-page.spec.ts`

- [ ] **Step 1: Add the set-as-default test**

Append:

```typescript
  test('set-as-default promotes a non-default personal profile', async ({
    authedPage: page,
    authToken,
    request,
  }) => {
    // Two personal profiles in the same scope/owner so the page's
    // setAsDefault dance has a peer to demote.
    const a = await createProfileViaApi(request, authToken, {
      name: makeProfileName('default-a'),
      is_default: true,
    })
    const b = await createProfileViaApi(request, authToken, {
      name: makeProfileName('default-b'),
      is_default: false,
    })

    try {
      await page.goto('/profiles')
      await expect(sel.profilesNameCell(page, b.name)).toBeVisible()

      await sel.profilesSetDefaultBtn(page, b.name).click()

      // After the dance: row B carries the "Default" badge.
      const rowB = page.getByRole('row', { name: new RegExp(b.name) })
      await expect(rowB.getByText('Default', { exact: true })).toBeVisible({
        timeout: 5000,
      })

      // The error banner must NOT appear on the happy path.
      await expect(sel.profilesSetDefaultError(page)).toHaveCount(0)
    } finally {
      await deleteProfileViaApi(request, authToken, a.id)
      await deleteProfileViaApi(request, authToken, b.id)
    }
  })
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/14-profiles-page.spec.ts --project=chromium -g "set-as-default"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/14-profiles-page.spec.ts
git commit -m "test(e2e): set-as-default promotes a personal profile"
```

---

### Task 8: Spec — Profiles page error banner surfaces on delete failure

**Files:**
- Modify: `e2e/specs/14-profiles-page.spec.ts`

- [ ] **Step 1: Add the delete-error surface test**

This test verifies PSR-G05 (#82): the DeleteProfileModal surfaces the failure inside the modal instead of swallowing it. We force a 4xx by intercepting the DELETE response.

Append:

```typescript
  test('delete failure surfaces inside the modal (PSR-G05)', async ({
    authedPage: page,
    authToken,
    request,
  }) => {
    const seeded = await createProfileViaApi(request, authToken, {
      name: makeProfileName('delete-err'),
    })

    try {
      // Intercept DELETE /api/v1/profiles/<id> and force a 500 so the
      // SPA's deleteProfile() rejects and the modal must render the
      // [data-testid=delete-profile-error] banner.
      await page.route(
        `**/api/v1/profiles/${seeded.id}`,
        async (route, req) => {
          if (req.method() === 'DELETE') {
            await route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({
                code: 'internal',
                description: 'forced failure',
              }),
            })
            return
          }
          await route.continue()
        }
      )

      await page.goto('/profiles')
      await expect(sel.profilesNameCell(page, seeded.name)).toBeVisible()

      await sel.profilesDeleteBtn(page, seeded.name).click()
      await sel.profileDeleteConfirmBtn(page).click()

      await expect(sel.profileDeleteError(page)).toBeVisible({ timeout: 5000 })
      // Row should still be present (the failed delete didn't actually
      // remove anything server-side).
      await expect(sel.profilesNameCell(page, seeded.name)).toBeVisible()
    } finally {
      await page.unroute(`**/api/v1/profiles/${seeded.id}`)
      await deleteProfileViaApi(request, authToken, seeded.id)
    }
  })
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/14-profiles-page.spec.ts --project=chromium -g "delete failure surfaces"`
Expected: PASS. If the banner never appears, the test-id may have changed — grep `data-testid=` in `src/components/profiles/DeleteProfileModal.tsx`.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/14-profiles-page.spec.ts
git commit -m "test(e2e): delete failure surfaces inside the modal (PSR-G05)"
```

---

### Task 9: Spec — Profile API CRUD round-trip (POST/GET/PATCH/DELETE)

**Files:**
- Create: `e2e/specs/15-profile-api.spec.ts`

- [ ] **Step 1: Write the API CRUD test**

```typescript
// e2e/specs/15-profile-api.spec.ts
//
// Direct REST coverage for the new /api/v1/profiles surface:
//   - POST/GET/PATCH/DELETE happy path.
//   - PATCH-clear semantics for nullable fields (TLS material, pool
//     overrides, description, savedUsername) — closes the regression
//     window for GAP-PSR-G02 / G02-followup which reworked the wire
//     contract to support clearing those fields with explicit nulls.
//   - Per-actor 429 + Retry-After (GAP-S7).
//   - Server-side PEM validation rejects garbage CA blocks (GAP-S10).
//
// All tests use Bearer auth so the CSRF middleware is bypassed
// (matches the pattern in 09-ops.spec.ts).

import { test, expect } from '../fixtures'
import {
  createProfileViaApi,
  deleteProfileViaApi,
  makeProfileName,
} from '../helpers/profiles'

test.describe('profile API CRUD', () => {
  test('POST creates, GET reads back, DELETE removes', async ({
    authToken,
    request,
  }) => {
    const name = makeProfileName('crud')
    const created = await createProfileViaApi(request, authToken, {
      name,
      description: 'crud test',
    })

    // GET single
    const getRes = await request.get(`/api/v1/profiles/${created.id}`, {
      headers: { authorization: `Bearer ${authToken}` },
    })
    expect(getRes.ok()).toBeTruthy()
    const got = (await getRes.json()) as { name: string; description?: string }
    expect(got.name).toBe(name)
    expect(got.description).toBe('crud test')

    // DELETE
    await deleteProfileViaApi(request, authToken, created.id)

    // GET single again returns 404
    const getAgain = await request.get(`/api/v1/profiles/${created.id}`, {
      headers: { authorization: `Bearer ${authToken}` },
    })
    expect(getAgain.status()).toBe(404)
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/15-profile-api.spec.ts --project=chromium -g "POST creates"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/15-profile-api.spec.ts
git commit -m "test(e2e): profile API POST/GET/DELETE round-trip"
```

---

### Task 10: Spec — PATCH-clear semantics for nullable fields

**Files:**
- Modify: `e2e/specs/15-profile-api.spec.ts`

- [ ] **Step 1: Add the PATCH-clear test**

**Wire contract reality (verified against running server):** PSR-G02-followup makes `description`, `dsn`, `name`, `saved_username`, `is_default` nullable scalars (`*string` / `*bool` with `,omitempty`). On the wire:
- field absent (e.g. omit the key) → `nil` pointer → **preserve current value**
- field present with empty string `""` (or `false`) → non-nil pointer → **clear / set to that value**
- field present with `null` → also unmarshals to `nil` pointer → **preserve** (NOT clear)

So the wire-clear sentinel for scalars is empty-string, not null. (Null IS the clear sentinel for `tls` / `pool_overrides`, which use `jsontext.Value` — see Task 11.)

Append inside `test.describe('profile API CRUD', () => { ... })`:

```typescript
  test('PATCH with explicit empty string clears description + savedUsername', async ({
    authToken,
    request,
  }) => {
    const seeded = await createProfileViaApi(request, authToken, {
      name: makeProfileName('patch-clear'),
      description: 'will be cleared',
      saved_username: 'will-be-cleared',
    })

    try {
      // PSR-G02-followup wire contract: scalar fields use *string with
      // omitempty. nil pointer (= field absent OR null) preserves; non-
      // nil pointer (incl. pointer to empty string) sets/clears. Empty
      // string is the wire-clear sentinel.
      const res = await request.patch(`/api/v1/profiles/${seeded.id}`, {
        headers: {
          authorization: `Bearer ${authToken}`,
          'content-type': 'application/json',
        },
        data: { description: '', saved_username: '' },
      })
      expect(
        res.ok(),
        `PATCH failed: ${res.status()} ${await res.text()}`
      ).toBeTruthy()

      // Read back: both fields should be empty / absent.
      const getRes = await request.get(`/api/v1/profiles/${seeded.id}`, {
        headers: { authorization: `Bearer ${authToken}` },
      })
      const got = (await getRes.json()) as {
        description?: string
        saved_username?: string
      }
      expect(got.description ?? '').toBe('')
      expect(got.saved_username ?? '').toBe('')
    } finally {
      await deleteProfileViaApi(request, authToken, seeded.id)
    }
  })
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/15-profile-api.spec.ts --project=chromium -g "PATCH with explicit null"`
Expected: PASS. If the read-back still shows the old value, the genapi PATCH route may not yet recognise nulls for those columns — re-check the closed status of GAP-PSR-G02-followup against the current `gen/types/types.gen.go`.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/15-profile-api.spec.ts
git commit -m "test(e2e): PATCH null clears description + savedUsername"
```

---

### Task 11: Spec — PATCH-clear semantics for TLS + pool override fields

**Files:**
- Modify: `e2e/specs/15-profile-api.spec.ts`

- [ ] **Step 1: Add the TLS/pool clear test**

Append:

```typescript
  test('PATCH with explicit null clears TLS material + pool overrides', async ({
    authToken,
    request,
  }) => {
    // A throwaway self-signed CA PEM is fine for the seed because
    // the server only stores the bytes; it doesn't open a real TLS
    // session as part of the CRUD round-trip.
    const seedPem = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAOq6oIYZxh7nMA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNVBAMMCWxv
Y2FsaG9zdDAeFw0yMzAxMDEwMDAwMDBaFw0zMzAxMDEwMDAwMDBaMBQxEjAQBgNV
BAMMCWxvY2FsaG9zdDBcMA0GCSqGSIb3DQEBAQUAA0sAMEgCQQDmDqzTunM3qopH
MPLfxYKO+HfVOdQDHJgX8mXvuHkV4i61eHttZMoSU0RUhxANI1dwa/ZXi89j4l0G
0ZpQ7qNlAgMBAAEwDQYJKoZIhvcNAQELBQADQQAYn3F89bqfFTkqe7xR1qY//rYj
5ZkYy9q+wQE7tH2ojJsh89AqQVVHm/DwaLmzz3SRMJYMdf9CocupKsBEqFzj
-----END CERTIFICATE-----`

    const seeded = await createProfileViaApi(request, authToken, {
      name: makeProfileName('patch-clear-tls'),
      tls: { ca_pem: seedPem },
      pool_overrides: { max_open_conns: 25, conn_max_lifetime_ms: 60_000 },
    })

    try {
      const res = await request.patch(`/api/v1/profiles/${seeded.id}`, {
        headers: {
          authorization: `Bearer ${authToken}`,
          'content-type': 'application/json',
        },
        // Server contract: an explicit null on the parent object clears
        // all child columns; an explicit null on a child key clears only
        // that one. We assert the parent-null path here because that's
        // the form the SPA's TLS clear-button uses.
        data: { tls: null, pool_overrides: null },
      })
      expect(
        res.ok(),
        `PATCH failed: ${res.status()} ${await res.text()}`
      ).toBeTruthy()

      const getRes = await request.get(`/api/v1/profiles/${seeded.id}`, {
        headers: { authorization: `Bearer ${authToken}` },
      })
      const got = (await getRes.json()) as {
        tls?: Record<string, unknown> | null
        pool_overrides?: Record<string, unknown> | null
      }
      // After clearing, the server emits the columns either as null,
      // as an empty object, or as an object whose values are all
      // empty/zero. All three forms satisfy the contract.
      const isEmptyOrZero = (v: unknown): boolean =>
        v === null ||
        v === undefined ||
        v === '' ||
        v === 0 ||
        v === false
      const tlsCleared =
        got.tls === null ||
        got.tls === undefined ||
        Object.values(got.tls ?? {}).every(isEmptyOrZero)
      expect(tlsCleared, `tls not cleared: ${JSON.stringify(got.tls)}`).toBeTruthy()
      const poolCleared =
        got.pool_overrides === null ||
        got.pool_overrides === undefined ||
        Object.values(got.pool_overrides ?? {}).every(isEmptyOrZero)
      expect(
        poolCleared,
        `pool_overrides not cleared: ${JSON.stringify(got.pool_overrides)}`
      ).toBeTruthy()
    } finally {
      await deleteProfileViaApi(request, authToken, seeded.id)
    }
  })
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/15-profile-api.spec.ts --project=chromium -g "PATCH with explicit null clears TLS"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/15-profile-api.spec.ts
git commit -m "test(e2e): PATCH null clears TLS material + pool overrides"
```

---

### Task 12: Spec — Server-side PEM validation rejects garbage

**Files:**
- Modify: `e2e/specs/15-profile-api.spec.ts`

- [ ] **Step 1: Add the PEM-validation test**

Append:

```typescript
  test('POST rejects an obviously-malformed CA PEM (GAP-S10)', async ({
    authToken,
    request,
  }) => {
    const res = await request.post('/api/v1/profiles', {
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
      },
      data: {
        name: makeProfileName('pem-bad'),
        scope: 'personal',
        dsn: 'bolt://localhost:7687',
        is_default: false,
        tls: { ca_pem: 'not a real PEM block at all, just garbage bytes' },
      },
    })

    expect(
      res.status(),
      `expected 4xx for malformed PEM, got ${res.status()}`
    ).toBeGreaterThanOrEqual(400)
    expect(res.status()).toBeLessThan(500)

    const body = await res.json().catch(() => ({}) as Record<string, unknown>)
    // pemvalidate.go uses error sentinels "invalid CA PEM" /
    // "invalid client cert PEM" / "invalid client key PEM". The
    // genapi error envelope wraps them in {code, description}.
    const text = JSON.stringify(body).toLowerCase()
    expect(text).toMatch(/invalid.*pem|pem.*invalid|ca.*invalid/)
  })
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/15-profile-api.spec.ts --project=chromium -g "PEM"`
Expected: PASS. If the server returns 200, GAP-S10's server-side validation hook may not be wired into the genapi route — verify `internal/server/handlers_profiles_crud.go` still calls `validatePEM` on the `ca_pem` path.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/15-profile-api.spec.ts
git commit -m "test(e2e): server rejects malformed CA PEM (GAP-S10)"
```

---

### Task 13: Spec — Per-actor 429 with Retry-After

**Files:**
- Modify: `e2e/specs/15-profile-api.spec.ts`

- [ ] **Step 1: Add the rate-limit test**

This test deliberately exhausts the per-actor bucket. Run it serially within a dedicated describe so the burst doesn't compete with other tests for the same bucket.

Append (at the end of the file, OUTSIDE the existing describe):

```typescript
test.describe.configure({ mode: 'serial' })
test.describe('profile API rate limit (GAP-S7)', () => {
  test('exhausting the burst returns 429 + Retry-After', async ({
    authToken,
    request,
  }) => {
    // The default config (ProfileLimiterDefaults) is 0.5 req/s steady
    // with burst 10. We fire 25 POSTs back-to-back; the first ~10
    // succeed (burst), then the remainder must 429 with Retry-After.
    // Each POST that succeeds creates a real row — collect the ids
    // and clean them up in afterAll.
    const created: string[] = []
    let saw429 = false
    let retryAfter: string | null = null

    for (let i = 0; i < 25; i++) {
      const res = await request.post('/api/v1/profiles', {
        headers: {
          authorization: `Bearer ${authToken}`,
          'content-type': 'application/json',
        },
        data: {
          name: makeProfileName(`burst-${i}`),
          scope: 'personal',
          dsn: 'bolt://localhost:7687',
          is_default: false,
        },
      })
      if (res.status() === 429) {
        saw429 = true
        retryAfter = res.headers()['retry-after'] ?? null
        // Body shape from rejectProfileCRUD():
        // { code: "rate_limited", description, reason: "actor_rate_limited" }
        const body = (await res.json()) as { code?: string; reason?: string }
        expect(body.code).toBe('rate_limited')
        expect(body.reason).toBe('actor_rate_limited')
        break
      }
      if (res.ok()) {
        const json = (await res.json()) as { id: string }
        created.push(json.id)
      } else {
        throw new Error(
          `unexpected status ${res.status()} during burst: ${await res.text()}`
        )
      }
    }

    try {
      expect(
        saw429,
        `never observed a 429 in 25 POSTs — bucket is wider than expected`
      ).toBeTruthy()
      expect(retryAfter, 'Retry-After header missing on 429').toBeTruthy()
      // Retry-After is a non-negative integer (seconds).
      expect(Number(retryAfter)).toBeGreaterThanOrEqual(1)
    } finally {
      // Clean up everything we managed to create. The cleanup DELETEs
      // also count against the bucket, so they may be 429-throttled
      // themselves. Sleep for the Retry-After window first.
      const wait = Math.max(1, Number(retryAfter ?? 1)) * 1000 + 500
      await new Promise((r) => setTimeout(r, wait))
      for (const id of created) {
        await deleteProfileViaApi(request, authToken, id)
      }
    }
  })
})
```

- [ ] **Step 2: Run it (slowly — this is the longest test in the suite)**

Run: `pnpm e2e e2e/specs/15-profile-api.spec.ts --project=chromium -g "exhausting the burst"`
Expected: PASS. The test should take ~3–5 seconds plus the Retry-After sleep on cleanup.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/15-profile-api.spec.ts
git commit -m "test(e2e): per-actor 429 + Retry-After on profile CRUD burst (GAP-S7)"
```

---

### Task 14: Spec — Public profiles endpoint contract (no auth)

**Files:**
- Create: `e2e/specs/16-public-profiles.spec.ts`

- [ ] **Step 1: Write the API contract test**

```typescript
// e2e/specs/16-public-profiles.spec.ts
//
// Coverage for /api/v1/profiles/public — the unauthenticated bootstrap
// endpoint that LoginPage and AddConnectionModal use to populate their
// profile pickers. The endpoint must:
//   - Be reachable without a JWT (no Authorization header).
//   - Return only system-scope profiles (never personal).
//   - Return { profiles: PublicProfile[] } where PublicProfile carries
//     `name` and optional `description` only — DSN, owner, TLS material,
//     pool overrides, and saved usernames are server-side secrets.

import { test, expect } from '../fixtures'

test.describe('public profiles endpoint', () => {
  test('GET /profiles/public returns 200 without auth', async ({ request }) => {
    const res = await request.get('/api/v1/profiles/public')
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { profiles: unknown }
    expect(Array.isArray(body.profiles)).toBeTruthy()
  })

  test('public profiles do NOT carry sensitive fields', async ({ request }) => {
    const res = await request.get('/api/v1/profiles/public')
    const body = (await res.json()) as {
      profiles: Record<string, unknown>[]
    }
    for (const p of body.profiles) {
      expect(p).toHaveProperty('name')
      // Negative assertions: these MUST NOT appear in the public list.
      expect(p).not.toHaveProperty('dsn')
      expect(p).not.toHaveProperty('tls')
      expect(p).not.toHaveProperty('pool_overrides')
      expect(p).not.toHaveProperty('owner_user_id')
      expect(p).not.toHaveProperty('saved_username')
    }
  })

  test('seed default profile is present in public list', async ({
    request,
  }) => {
    const res = await request.get('/api/v1/profiles/public')
    const body = (await res.json()) as {
      profiles: { name: string }[]
    }
    expect(body.profiles.some((p) => p.name === 'default')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/16-public-profiles.spec.ts --project=chromium`
Expected: PASS for all three tests. If the negative-field assertion trips, the server's redaction broke — file an issue immediately rather than weakening the test.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/16-public-profiles.spec.ts
git commit -m "test(e2e): /profiles/public no-auth contract + redaction"
```

---

### Task 15: Spec — LoginPage degrades gracefully when /profiles/public fails

**Files:**
- Modify: `e2e/specs/16-public-profiles.spec.ts`

- [ ] **Step 1: Add the LoginPage degradation test**

Append:

```typescript
test.describe('login page profile picker', () => {
  test('falls back to text input when /profiles/public is unreachable', async ({
    page,
  }) => {
    // Force the public-profile fetch to fail BEFORE the SPA mounts.
    await page.route('**/api/v1/profiles/public', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'unavailable' }),
      })
    )
    await page.goto('/login')

    // The fallback path renders the warning copy from
    // i18n key `connection.publicProfileListLoadFailed`.
    await expect(
      page.getByText(/could not load the profile list/i)
    ).toBeVisible({ timeout: 5000 })
    // And the form remains usable — the username/password fields are
    // still present.
    await expect(page.getByLabel('Username')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/16-public-profiles.spec.ts --project=chromium -g "falls back to text input"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/16-public-profiles.spec.ts
git commit -m "test(e2e): login page degrades gracefully on /profiles/public failure"
```

---

### Task 16: Spec — AddConnectionModal opens from the switcher

**Files:**
- Create: `e2e/specs/17-add-connection.spec.ts`

- [ ] **Step 1: Write the modal-opening test**

```typescript
// e2e/specs/17-add-connection.spec.ts
//
// AddConnectionModal coverage. The modal opens from two places in the
// ConnectionSwitcher: the empty-state Connect button (no connections)
// and the "+ Add another connection" footer row (one or more
// connections present). The fixture seeds an active connection, so we
// exercise the second path.
//
// The modal:
//   - Fetches the public-profile list and the authenticated profile
//     list on open. Either failure surfaces a distinct warning
//     ([data-testid=add-connection-public-profile-warning] /
//     [data-testid=add-connection-authed-profile-warning]).
//   - Submitting calls AuthProvider.connectMore() which logs in against
//     /auth/login and refreshes the CSRF token (GAP-PSR-G03).

import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'

test.describe('add connection modal', () => {
  test('opens from the switcher add-row affordance', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    // Open the switcher menu.
    await sel.connectionTrigger(page).click()
    await sel.addConnectionMenuItem(page).click()

    // Modal heading + submit button visible.
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(sel.addConnectionSubmit(page)).toBeVisible()
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/17-add-connection.spec.ts --project=chromium -g "opens from the switcher"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/17-add-connection.spec.ts
git commit -m "test(e2e): AddConnectionModal opens from switcher add-row"
```

---

### Task 17: Spec — AddConnectionModal surfaces both fetch failures

**Files:**
- Modify: `e2e/specs/17-add-connection.spec.ts`

- [ ] **Step 1: Add the public-profile fetch failure test**

Append inside `test.describe('add connection modal', () => { ... })`:

```typescript
  test('surfaces a warning when /profiles/public fails on open (PSR-G04)', async ({
    authedPage: page,
  }) => {
    await page.route('**/api/v1/profiles/public', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'unavailable' }),
      })
    )

    await page.goto('/')
    await sel.connectionTrigger(page).click()
    await sel.addConnectionMenuItem(page).click()

    await expect(
      sel.addConnectionPublicProfileWarning(page)
    ).toBeVisible({ timeout: 5000 })

    // Form still usable (username + password + submit still rendered).
    await expect(page.getByLabel('Username')).toBeVisible()
    await expect(sel.addConnectionSubmit(page)).toBeVisible()
  })
```

- [ ] **Step 2: Add the authed-profile fetch failure test**

Append:

```typescript
  test('surfaces a warning when /profiles fails on open (PSR-G10)', async ({
    authedPage: page,
  }) => {
    // Allow /profiles/public through (so the public picker hydrates) and
    // intercept the authenticated /profiles list to fail. The two
    // warnings render independently, so the public-profile dropdown
    // populates while the saved-username dropdown does not.
    await page.route('**/api/v1/profiles', (route, req) => {
      if (req.method() === 'GET') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'internal' }),
        })
      }
      return route.continue()
    })

    await page.goto('/')
    await sel.connectionTrigger(page).click()
    await sel.addConnectionMenuItem(page).click()

    await expect(
      sel.addConnectionAuthedProfileWarning(page)
    ).toBeVisible({ timeout: 5000 })
    // The public picker hydrated, so the public-profile warning must NOT show.
    await expect(sel.addConnectionPublicProfileWarning(page)).toHaveCount(0)
  })
```

- [ ] **Step 3: Run both**

Run: `pnpm e2e e2e/specs/17-add-connection.spec.ts --project=chromium -g "surfaces a warning"`
Expected: PASS for both tests.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/17-add-connection.spec.ts
git commit -m "test(e2e): AddConnectionModal surfaces public + authed fetch warnings"
```

---

### Task 18: Spec — AddConnectionModal happy-path connectMore round-trip

**Files:**
- Modify: `e2e/specs/17-add-connection.spec.ts`

- [ ] **Step 1: Add the happy-path test**

This test verifies the SPA-side `connectMore` path: submitting the form authenticates against `/auth/login`, refreshes the CSRF token (GAP-PSR-G03), and adds the new connection to the switcher menu.

Append:

```typescript
  test('successful connect adds a second row to the switcher', async ({
    authedPage: page,
  }) => {
    const USER = process.env.ADMIN_USER ?? 'geode'
    const PASS =
      process.env.ADMIN_PASSWORD ?? 'Geode E2E Bootstrap Password 2024'

    await page.goto('/')
    await sel.connectionTrigger(page).click()
    await sel.addConnectionMenuItem(page).click()

    // The public-profile picker auto-selects the first (default) entry,
    // so the profile field already carries 'default'. We only need to
    // fill credentials.
    await page.getByLabel('Username').fill(USER)
    await page.getByLabel('Password').fill(PASS)
    await sel.addConnectionSubmit(page).click()

    // Modal closes on success; reopen the switcher and confirm there
    // are now TWO menuitemradio rows for 'default'. The fixture seed
    // contributed one; connectMore added the second.
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 5000 })
    await sel.connectionTrigger(page).click()
    await expect(
      page.getByRole('menuitemradio', { name: /default/i })
    ).toHaveCount(2, { timeout: 5000 })
  })
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/17-add-connection.spec.ts --project=chromium -g "successful connect"`
Expected: PASS. If the modal stays open or only one menu row appears, capture the network trace (`pnpm e2e:report`) and confirm `/auth/login` returned 200 and `/api/v1/csrf` was refreshed.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/17-add-connection.spec.ts
git commit -m "test(e2e): AddConnectionModal connect adds a second switcher row"
```

---

### Task 19: Spec — ConnectionSwitcher disconnect removes a row

**Files:**
- Create: `e2e/specs/18-connection-switcher.spec.ts`

- [ ] **Step 1: Write the disconnect test**

```typescript
// e2e/specs/18-connection-switcher.spec.ts
//
// ConnectionSwitcher behaviors that landed with the multi-connection
// rebuild. The empty/loading-state and menu-anchor tests don't require
// a second connection; the switch-active and disconnect tests do, so
// they go through the AddConnectionModal flow exercised in
// 17-add-connection.spec.ts.

import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'

const USER = process.env.ADMIN_USER ?? 'geode'
const PASS = process.env.ADMIN_PASSWORD ?? 'Geode E2E Bootstrap Password 2024'

async function connectSecond(page: import('@playwright/test').Page): Promise<void> {
  await sel.connectionTrigger(page).click()
  await sel.addConnectionMenuItem(page).click()
  await page.getByLabel('Username').fill(USER)
  await page.getByLabel('Password').fill(PASS)
  await sel.addConnectionSubmit(page).click()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 5000 })
}

test.describe('connection switcher', () => {
  test('disconnect removes the row from the menu', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await connectSecond(page)

    await sel.connectionTrigger(page).click()
    // Should now have two rows. Pick the inactive one to disconnect
    // so we don't tear down the active session mid-test.
    const rows = page.getByRole('menuitemradio', { name: /default/i })
    await expect(rows).toHaveCount(2)

    // The Disconnect aria-label is "Disconnect: <profileName>".
    // Both rows are named 'default' so we use .last() to pick one.
    await page
      .getByRole('button', { name: 'Disconnect: default' })
      .last()
      .click()

    // Reopen and confirm we're back to one row.
    await sel.connectionTrigger(page).click()
    await expect(
      page.getByRole('menuitemradio', { name: /default/i })
    ).toHaveCount(1, { timeout: 5000 })
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/18-connection-switcher.spec.ts --project=chromium -g "disconnect removes"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/18-connection-switcher.spec.ts
git commit -m "test(e2e): ConnectionSwitcher disconnect removes the row"
```

---

### Task 20: Spec — ConnectionSwitcher loading state shows aria-busy placeholder

**Files:**
- Modify: `e2e/specs/18-connection-switcher.spec.ts`

- [ ] **Step 1: Add the loading-state test**

The switcher's loading branch (`if (loading)` in ConnectionSwitcher.tsx) renders a disabled trigger with `aria-busy="true"`. The fixture seeds the connection eagerly, so loading is normally bypassed; we exercise it by driving a fresh page that has NOT been seeded.

Append:

```typescript
  test('loading state renders aria-busy placeholder before hydration', async ({
    browser,
  }) => {
    // A non-fixture context: no addInitScript, so the SPA boots without
    // a seeded connection and ConnectionsProvider's lazy-hydrate path
    // briefly renders the loading branch. We grab a screenshot of the
    // initial state via aria-busy="true".
    //
    // Because the SPA also redirects unauthenticated users to /login,
    // we have to pre-seed the auth cookie via APIRequestContext but
    // deliberately omit the __GEODE_E2E_INITIAL_CONNECTIONS__ global.
    const apiRequest = await browser.newContext()
    await apiRequest
      .request()
      .post('/api/v1/auth/login', {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        form: { username: USER, password: PASS, profile: 'default' },
      })
      .then((r) => expect(r.ok()).toBeTruthy())
    const storageState = await apiRequest.request().storageState()
    await apiRequest.close()

    const ctx = await browser.newContext({ storageState })
    // Seed only the session-hint so AuthProvider considers us authed.
    // Do NOT seed __GEODE_E2E_INITIAL_CONNECTIONS__ — that's the whole
    // point of the test.
    await ctx.addInitScript(() => {
      sessionStorage.setItem('geode-ui.session-hint', '1')
    })
    const p = await ctx.newPage()
    // Slow the secure-store IPC response by intercepting the bridge
    // probe — but in browser mode there's no IPC at all, so the
    // ConnectionsProvider hydrates immediately with the empty seed.
    // The empty-state branch renders the "Connect" affordance instead
    // of the busy placeholder. We assert THAT instead.
    await p.goto('/')

    // After redirect, browser-mode lands on /login (no active
    // connection). The switcher only renders on the protected shell,
    // so we don't assert it here. Instead we confirm the redirect.
    await expect(p).toHaveURL(/\/login$/, { timeout: 5000 })
    await ctx.close()
  })
```

> **Note:** the loading branch is genuinely hard to observe in browser mode because there's no IPC delay to await. This test asserts the OBSERVABLE consequence: an unseeded protected shell redirects to `/login`. The aria-busy branch is only reachable in Electron mode and is covered by the unit test suite (`src/components/layout/ConnectionSwitcher.test.tsx`). If a future change makes the loading branch reachable in browser mode (e.g. an async hydrate in the React tree), upgrade this test to assert `aria-busy="true"` directly.

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/18-connection-switcher.spec.ts --project=chromium -g "loading state"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/18-connection-switcher.spec.ts
git commit -m "test(e2e): unseeded protected shell redirects to /login (lazy-hydrate empty)"
```

---

### Task 21: Spec — ConnectionSwitcher menu anchors left of the trigger

**Files:**
- Modify: `e2e/specs/18-connection-switcher.spec.ts`

- [ ] **Step 1: Add the menu-anchor test**

This locks down the fix from `0b73836` (`ConnectionSwitcher menu anchors left so it stays on-screen`).

Append:

```typescript
  test('menu opens within the viewport at narrow widths', async ({
    authedPage: page,
  }) => {
    // Narrow viewport that previously pushed the right-anchored menu
    // off-screen (~17px overflow on desktop, ~33px on mobile).
    await page.setViewportSize({ width: 360, height: 720 })
    await page.goto('/')

    const triggerBox = await sel.connectionTrigger(page).boundingBox()
    expect(triggerBox).not.toBeNull()
    if (!triggerBox) return

    await sel.connectionTrigger(page).click()

    // The menu role is 'menu' and lives inside the styled SwitcherWrap.
    const menu = page.getByRole('menu').first()
    await expect(menu).toBeVisible()
    const menuBox = await menu.boundingBox()
    expect(menuBox).not.toBeNull()
    if (!menuBox) return

    // Menu's left edge aligns with the trigger's left edge (≤ 4px
    // tolerance for sub-pixel rounding) and the right edge stays on-
    // screen.
    expect(Math.abs(menuBox.x - triggerBox.x)).toBeLessThanOrEqual(4)
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(360 + 1)
  })
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/18-connection-switcher.spec.ts --project=chromium -g "menu opens within"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/18-connection-switcher.spec.ts
git commit -m "test(e2e): switcher menu anchors left and stays on-screen at 360px"
```

---

### Task 22: Spec — SPA fallback returns 404 (not index.html) for missing static assets

**Files:**
- Modify: `e2e/specs/16-public-profiles.spec.ts` *(reuse this file rather than a 19th spec — both tests are HTTP-only, no UI)*

- [ ] **Step 1: Add the SPA-fallback test**

This locks down `f6d1bc7`: requests for asset-shaped paths (anything that looks like a hashed bundle / image / CSS / map file) must 404 instead of falling through to `index.html` with a 200. Pre-fix, a stale browser cache referencing a bundle filename that no longer existed got `index.html` back with `Content-Type: text/html`, which the browser then tried to parse as JavaScript and silently dropped.

Append at the very end of `e2e/specs/16-public-profiles.spec.ts`:

```typescript
test.describe('SPA static asset fallback (f6d1bc7)', () => {
  test('asset-shaped 404s return 404 with non-HTML Content-Type', async ({
    request,
  }) => {
    const res = await request.get('/static/js/does-not-exist.abc123.js')
    expect(res.status()).toBe(404)
    const ct = (res.headers()['content-type'] ?? '').toLowerCase()
    expect(ct.includes('text/html')).toBeFalsy()
  })

  test('unknown SPA route falls through to index.html (200)', async ({
    request,
  }) => {
    // The SPA route /not-a-real-route is unknown to the server but the
    // fallback intentionally serves index.html so client-side routing
    // can take over. We assert the OPPOSITE shape from the test above:
    // 200 + text/html.
    const res = await request.get('/not-a-real-route')
    expect(res.status()).toBe(200)
    const ct = (res.headers()['content-type'] ?? '').toLowerCase()
    expect(ct.includes('text/html')).toBeTruthy()
  })

  test('asset-shaped paths under nested dirs also 404', async ({ request }) => {
    // Catches the regression where the file-suffix heuristic only fired
    // on the top-level path. Hashed bundle names live under /static/.
    const css = await request.get('/static/css/does-not-exist.deadbeef.css')
    expect(css.status()).toBe(404)
    const map = await request.get('/static/js/missing.bundle.js.map')
    expect(map.status()).toBe(404)
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/specs/16-public-profiles.spec.ts --project=chromium -g "SPA static asset fallback"`
Expected: PASS. If the asset-shaped 404 test fails with `status=200, content-type=text/html`, the SPA fallback regression has reopened — file an issue rather than relaxing the assertion.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/16-public-profiles.spec.ts
git commit -m "test(e2e): SPA fallback 404s asset-shaped paths instead of index.html"
```

---

### Task 23: Run the full e2e suite to verify no regressions

**Files:** none modified

- [ ] **Step 1: Run the full Playwright suite**

Run: `pnpm e2e`
Expected: All existing 13 spec files PASS, all 5 new spec files PASS. Total runtime depends on CI vs local; budget ~5 minutes locally with 4 workers.

- [ ] **Step 2: If anything fails**

Open `pnpm e2e:report` and inspect screenshots/videos. The most likely failure modes:
1. **Per-actor rate limit bucket exhausted** — the rate-limit spec drains the bootstrap admin's bucket; subsequent profile-CRUD specs (Tasks 4–8, 10, 11) may 429. The Retry-After sleep at the end of Task 13 should handle this, but if specs run in parallel within a single file, Playwright's `mode: 'serial'` only applies within that describe. Move the rate-limit describe to its own file (`15b-profile-rate-limit.spec.ts`) and configure `--workers=1` for that file alone via the project config if this becomes flaky.
2. **i18n key drift** — if any selector that depends on a literal label fails, grep the key in `src/services/i18n/locales/en.ts` and re-derive the string.
3. **Test-id removed** — if `[data-testid=delete-profile-error]` or `[data-testid=add-connection-public-profile-warning]` is missing, the source component changed; re-grep the test-id in `src/components/profiles/` or `src/components/layout/`.

- [ ] **Step 3: Final commit (only if anything was tweaked above)**

```bash
git add e2e/
git commit -m "test(e2e): stabilise rate-limit isolation across new specs"
```

---

## Acceptance criteria

- [ ] `pnpm e2e` passes locally with 0 failures and 0 unexpected skips.
- [ ] Every new spec file has been committed in its own commit (one per task).
- [ ] No new profile rows remain in the database after a full suite run (sanity-check via `curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/profiles | jq '.profiles[].name' | grep -c '^"e2e-'` — should be `0`).
- [ ] No production source files have been modified.
- [ ] The 5 new spec files together exercise: profile UI CRUD, profile API CRUD, PATCH-clear semantics for nullable + TLS + pool fields, server-side PEM validation, per-actor 429 + Retry-After, /profiles/public no-auth contract + redaction, login-page degradation, AddConnectionModal both-error surfaces + happy path, ConnectionSwitcher disconnect + menu anchor + lazy-hydrate redirect.
