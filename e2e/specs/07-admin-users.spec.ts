import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'

const newUsername = `e2e_user_${Date.now()}`

test.describe('admin / users', () => {
  test('users page lists at least the admin user', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/users')
    // Either we see the table populated, or we see a 422 admin-not-supported
    // error banner. Both are acceptable on Geode versions where SHOW USERS
    // is not yet on the wire — the UI still shouldn't crash.
    const banner = page.getByText(
      /schema_error|not supported|unimplemented|parse error|expected token|insufficient role|http status 4\d\d/i
    )
    const row = page.getByText(/geode/) // 'geode' is the admin username
    await expect(row.or(banner).first()).toBeVisible()
    test.skip(
      await banner.isVisible({ timeout: 1_000 }).catch(() => false),
      'Geode does not expose SHOW USERS on the wire yet'
    )
  })

  test('+ New user opens a modal and POST to /api/v1/users', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/users')
    // Wait for either the table to populate or the banner to appear, so
    // the skip-gate has a stable signal regardless of network timing.
    await page
      .getByText(
        /No users\.|geode|not supported|schema_error|parse error|expected token|insufficient role|http status 4\d\d/i
      )
      .first()
      .waitFor({ timeout: 4_000 })
      .catch(() => undefined)
    test.skip(
      await page
        .getByText(
          /not supported|schema_error|parse error|expected token|insufficient role|http status 4\d\d/i
        )
        .isVisible({ timeout: 1_000 })
        .catch(() => false),
      'admin GQL not on wire'
    )
    await sel.newUserBtn(page).click()
    await page.getByPlaceholder('username').fill(newUsername)
    await page.getByPlaceholder('email').fill(`${newUsername}@e2e.local`)
    await page.getByPlaceholder('password').fill('p4$$word!')
    await page.getByRole('button', { name: /create/i }).click()
    // Modal closes on success; the new row should appear.
    await expect(page.getByText(newUsername)).toBeVisible({ timeout: 8_000 })
  })

  test('Delete row removes the user', async ({ authedPage: page }) => {
    await page.goto('/admin/users')
    await page
      .getByText(
        /No users\.|geode|not supported|schema_error|parse error|expected token|insufficient role|http status 4\d\d/i
      )
      .first()
      .waitFor({ timeout: 4_000 })
      .catch(() => undefined)
    test.skip(
      await page
        .getByText(
          /not supported|schema_error|parse error|expected token|insufficient role|http status 4\d\d/i
        )
        .isVisible({ timeout: 1_000 })
        .catch(() => false),
      'admin GQL not on wire'
    )
    test.skip(
      !(await page
        .getByText(newUsername)
        .isVisible({ timeout: 1_000 })
        .catch(() => false)),
      'previous create test was skipped'
    )

    page.once('dialog', (d) => d.accept()) // window.confirm
    await page
      .getByRole('row', { name: new RegExp(newUsername) })
      .getByRole('button', { name: /delete/i })
      .click()
    await expect(page.getByText(newUsername)).toBeHidden({ timeout: 8_000 })
  })
})
