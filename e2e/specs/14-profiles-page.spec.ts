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
    const json = (await list.json()) as {
      profiles: { id: string; name: string }[]
    }
    const created = json.profiles.find((p) => p.name === name)
    if (created) await deleteProfileViaApi(request, authToken, created.id)
  })

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
      // confirmation; the locator is dialog-scoped.
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

  test('set-as-default promotes a non-default personal profile', async ({
    authedPage: page,
    authToken,
    request,
  }) => {
    // The SPA's setAsDefault dance issues 1-2 PATCHes through the
    // generated React client, which (unlike helpers/profiles.ts) does
    // NOT retry on 429. Under the suite's parallel load the per-actor
    // rate-limit bucket (30 req/min, burst 10, shared across every
    // worker) can be drained for several seconds at a stretch, so a
    // single click can hit a 429 and surface the setDefaultErr banner
    // instead of promoting the row. We retry the click, and when we
    // see the banner we wait a full bucket-refill window (~6s = 3
    // tokens at 0.5/s) before re-clicking. Give the whole test a
    // generous timeout since the retry budget can exceed the 30s
    // default.
    test.setTimeout(90_000)

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

      const rowB = page.getByRole('row', { name: new RegExp(b.name) })
      const badge = rowB.getByText('Default', { exact: true })
      const errBanner = sel.profilesSetDefaultError(page)

      /* eslint-disable no-await-in-loop, no-plusplus, no-promise-executor-return */
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
      let promoted = false
      for (let attempt = 0; attempt < 6 && !promoted; attempt++) {
        await sel.profilesSetDefaultBtn(page, b.name).click()
        // Race: the badge appears (success) OR the error banner appears
        // (a 429 in the dance). Whichever wins, react accordingly.
        try {
          await Promise.race([
            badge.waitFor({ state: 'visible', timeout: 6000 }),
            errBanner.waitFor({ state: 'visible', timeout: 6000 }),
          ])
        } catch {
          // Neither appeared within 6s — unusual; fall through and let
          // the explicit badge check below decide, then retry.
        }
        if (await badge.isVisible()) {
          promoted = true
          break
        }
        // Not promoted. If the banner is up, it's a rate-limit stall —
        // wait out a refill window. Otherwise a shorter pause.
        await sleep((await errBanner.isVisible()) ? 6000 : 2000)
      }
      /* eslint-enable no-await-in-loop, no-plusplus, no-promise-executor-return */
      expect(promoted, 'set-as-default never promoted row B').toBeTruthy()
    } finally {
      await deleteProfileViaApi(request, authToken, a.id)
      await deleteProfileViaApi(request, authToken, b.id)
    }
  })

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
})
