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
// NOTE: Tasks 4–8 will append tests that import createProfileViaApi,
// deleteProfileViaApi, and makeProfileName from '../helpers/profiles'.
// Imports are omitted here to keep eslint happy until those tests land.

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
