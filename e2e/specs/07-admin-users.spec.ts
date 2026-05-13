import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'

const newUsername = `e2e_user_${Date.now()}`

// Geode v0.5.15 enables admin DDL (CREATE/ALTER/DROP USER, SHOW USERS) over
// the GQL wire. The SPA learns this from GET /api/v1/capabilities
// (admin_writable.users === true) and surfaces an operable "+ New user"
// CTA. The unsupported affordance must NOT render.
//
// Phase-1 history: against v0.5.11 these flows ran offline only and the SPA
// rendered an `admin-users-unsupported` banner with a disabled CTA. Closing
// the GAP-002/GAP-013 trail flips the expectation: with v0.5.15 wired,
// the CTA is enabled and the banner is absent. See
// docs/superpowers/plans/2026-05-13-geode-0-5-15-auth-ddl-integration.md.
test.describe('admin / users — v0.5.15 CTA gating', () => {
  test('"+ New user" is enabled and unsupported banner is absent', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/users')
    await page
      .getByText(/users \(\d+\)|No users|geode/i)
      .first()
      .waitFor({ timeout: 6_000 })
      .catch(() => undefined)

    // The unsupported affordance must NOT render under v0.5.15.
    await expect(sel.adminUsersUnsupported(page)).toHaveCount(0)

    // The "+ New user" CTA must be visible and enabled.
    const btn = sel.adminNewUserBtn(page)
    await expect(btn).toBeVisible({ timeout: 6_000 })
    await expect(btn).toBeEnabled()
  })
})

test.describe('admin / users', () => {
  test('users page lists at least the admin user', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/users')
    await page
      .getByText(/geode|users \(\d+\)/i)
      .first()
      .waitFor({ timeout: 6_000 })
    // v0.5.15: SHOW USERS returns a non-empty row set including the admin.
    await expect(page.getByText(/geode/)).toBeVisible()
  })

  test('+ New user opens a modal and POST to /api/v1/users', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/users')
    await page
      .getByText(/geode|users \(\d+\)/i)
      .first()
      .waitFor({ timeout: 6_000 })
    await sel.newUserBtn(page).click()
    // CreateUserModal renders <Field label="Username|Email|Password">
    // wrapping <Input id="cu-…"/>. There is no `placeholder` attribute,
    // so the test drives by label association.
    await page.getByLabel(/^username/i).fill(newUsername)
    await page.getByLabel(/^email/i).fill(`${newUsername}@e2e.local`)
    // Password must satisfy server policy: ≥12 chars, mixed character
    // shape, no all-same / all-digit, no username substring (GAP-N4).
    await page.getByLabel(/^password/i).fill('S3cure!E2E Pass 2026')
    await page.getByRole('button', { name: /^create$/i }).click()
    // Modal closes on success; the new row should appear in the table.
    await expect(
      page.getByRole('cell', { name: newUsername, exact: true })
    ).toBeVisible({ timeout: 8_000 })
  })

  test('Delete row removes the user', async ({ authedPage: page }) => {
    await page.goto('/admin/users')
    await page
      .getByText(/geode|users \(\d+\)/i)
      .first()
      .waitFor({ timeout: 6_000 })
    // The previous test created the row; if it was not run in isolation
    // we skip cleanly rather than fail on a missing fixture row.
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
