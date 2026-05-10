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
    const json = (await list.json()) as { profiles: { id: string; name: string }[] }
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
})
