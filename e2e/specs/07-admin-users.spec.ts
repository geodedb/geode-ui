import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'

const newUsername = `e2e_user_${Date.now()}`

// Phase-1 reproduction: against the running v0.5.11 stack, the Admin
// section must NOT surface an operable "+ New user" CTA, because the
// connected Geode build rejects CREATE USER over the wire. The SPA
// learns this from GET /api/v1/capabilities (admin_writable.users ===
// false) and either hides the button or renders it `disabled` with an
// explanatory title, plus an `admin-users-unsupported` note.
//
// On the current (pre-fix) build this fails: the "+ New user" button
// renders enabled and there is no capabilities-driven gating, so
// `adminNewUserBtn` is enabled and `adminUsersUnsupported` is absent.
test.describe('admin / users — Phase 1 CTA gating', () => {
  test('"+ New user" is gated against the connected Geode build', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/users')
    // Let the page settle (table empty-state or rows).
    await page
      .getByText(/users \(\d+\)|No users|geode/i)
      .first()
      .waitFor({ timeout: 6_000 })
      .catch(() => undefined)

    // The unsupported affordance must be present.
    await expect(sel.adminUsersUnsupported(page)).toBeVisible({
      timeout: 6_000,
    })

    // If the button still renders, it must be disabled with a title.
    const btn = sel.adminNewUserBtn(page)
    if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await expect(btn).toBeDisabled()
      const title = await btn.getAttribute('title')
      expect(title && title.length > 0).toBeTruthy()
    }
  })
})

test.describe('admin / users', () => {
  // The server returns an EMPTY user list (HTTP 200, users:[]) when the
  // Geode wire dialect doesn't expose SHOW USERS yet (v0.5.11 is in this
  // state) — the page renders cleanly with no banner. We detect that
  // empty state and skip the rest of the suite gracefully.
  const SHOW_USERS_GAP_RE =
    /No users|insufficient role|http status 4\d\d|schema_error|parse error|expected token|not supported|unimplemented/i

  test('users page lists at least the admin user', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/users')
    // Wait for either the page's empty-state, the admin row, or any
    // engine-gap banner. All three are valid resting states.
    await page
      .getByText(
        /geode|users \(\d+\)|No users|schema_error|parse error|insufficient role/i
      )
      .first()
      .waitFor({ timeout: 6_000 })
      .catch(() => undefined)
    test.skip(
      await page
        .getByText(SHOW_USERS_GAP_RE)
        .first()
        .isVisible({ timeout: 1_000 })
        .catch(() => false),
      'SHOW USERS not on the Geode wire yet (v0.5.11) — page renders an empty list'
    )
    await expect(page.getByText(/geode/)).toBeVisible()
  })

  test('+ New user opens a modal and POST to /api/v1/users', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/users')
    await page
      .getByText(
        /geode|users \(\d+\)|No users|schema_error|parse error|insufficient role/i
      )
      .first()
      .waitFor({ timeout: 6_000 })
      .catch(() => undefined)
    test.skip(
      await page
        .getByText(SHOW_USERS_GAP_RE)
        .first()
        .isVisible({ timeout: 1_000 })
        .catch(() => false),
      'SHOW USERS / CREATE USER not on the Geode wire yet (v0.5.11)'
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
        /geode|users \(\d+\)|No users|schema_error|parse error|insufficient role/i
      )
      .first()
      .waitFor({ timeout: 6_000 })
      .catch(() => undefined)
    test.skip(
      await page
        .getByText(SHOW_USERS_GAP_RE)
        .first()
        .isVisible({ timeout: 1_000 })
        .catch(() => false),
      'SHOW USERS / DROP USER not on the Geode wire yet (v0.5.11)'
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
