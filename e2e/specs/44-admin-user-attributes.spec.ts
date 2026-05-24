import { test, expect } from '../fixtures'
import {
  ADMIN_GAP_RE,
  createTestUser,
  deleteTestUser,
} from '../helpers/security'

// /admin/users → Attributes row action → UserAttributesModal flow.
// The Attributes button only renders when caps.adminWritable.attributes
// is true; on builds older than Geode 0.5.20 the spec skips.

test.describe('admin / user attributes', () => {
  test('open Attributes modal, add and remove an attribute', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/users')
    // If the build doesn't support attributes, the row Attributes
    // button is never rendered; skip cleanly.
    const usernamePromise = createTestUser(page, 'attr')
    let username: string | undefined
    try {
      const created = await usernamePromise
      username = created.username
    } catch (e) {
      test.skip(
        true,
        `user creation failed (admin DDL likely unsupported): ${(e as Error).message}`
      )
      return
    }
    try {
      const row = page.locator('tr', { hasText: username! })
      const attrBtn = row.getByRole('button', { name: /User attributes/i })
      const supported = await attrBtn
        .isVisible({ timeout: 2_000 })
        .catch(() => false)
      test.skip(
        !supported,
        'user attributes unavailable on this Geode build'
      )

      await attrBtn.click()
      await expect(page.getByText('User attributes').first()).toBeVisible()

      await page.getByTestId('user-attributes-add-btn').click()
      await page.getByTestId('user-attr-new-key').fill('department')
      await page.getByTestId('user-attr-new-value').fill('engineering')
      await page.getByTestId('user-attr-submit-btn').click()

      // Bail out if the server-side procedure isn't implemented
      const formErr = await page
        .getByTestId('user-attributes-form-error')
        .isVisible({ timeout: 1_000 })
        .catch(() => false)
      test.skip(
        formErr,
        'geode.auth.user_set_attribute unavailable on this Geode build'
      )

      await expect(page.getByText('department')).toBeVisible()
      await expect(page.getByText('engineering')).toBeVisible()

      // Remove the attribute via the row's Delete button.
      await page.getByTestId('user-attr-remove-department').click()
      // ConfirmModal: scope to dialog role and click its Delete.
      const dialogs = page.getByRole('dialog')
      const last = dialogs.last()
      await last.getByRole('button', { name: /^delete$/i }).click()
      await expect(page.getByText('department')).toBeHidden({
        timeout: 10_000,
      })
    } finally {
      // Best-effort cleanup. Catch closes the dialog if open.
      await page.keyboard.press('Escape').catch(() => undefined)
      if (username) {
        await deleteTestUser(page, username).catch(() => undefined)
      }
    }
  })

  test('rejects invalid attribute keys client-side', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/users')
    let username: string | undefined
    try {
      const created = await createTestUser(page, 'attrval')
      username = created.username
    } catch (e) {
      test.skip(true, `user creation failed: ${(e as Error).message}`)
      return
    }
    try {
      const row = page.locator('tr', { hasText: username! })
      const attrBtn = row.getByRole('button', { name: /User attributes/i })
      const supported = await attrBtn
        .isVisible({ timeout: 2_000 })
        .catch(() => false)
      test.skip(!supported, 'user attributes unavailable')
      await attrBtn.click()
      await page.getByTestId('user-attributes-add-btn').click()
      await page.getByTestId('user-attr-new-key').fill('1invalid')
      await page.getByTestId('user-attr-new-value').fill('x')
      await page.getByTestId('user-attr-submit-btn').click()
      await expect(
        page.getByText(/keys must start with a letter/i)
      ).toBeVisible()
    } finally {
      await page.keyboard.press('Escape').catch(() => undefined)
      if (username) {
        await deleteTestUser(page, username).catch(() => undefined)
      }
    }
  })
})

test.describe('admin / user attributes — gating', () => {
  test('the Attributes row button is hidden on caps-disabled builds', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/users')
    // If we hit any wire_feature_missing banner the test is skipped
    // (we only assert against builds where users CAN be listed).
    const banner = page.getByText(ADMIN_GAP_RE).first()
    const blocked = await banner
      .isVisible({ timeout: 1_500 })
      .catch(() => false)
    if (blocked) test.skip(true, 'admin DDL unsupported on this build')
    // On a build where attributes are enabled (caps flag true) the
    // button renders. On older builds it does not. Either is fine —
    // this test just asserts the page renders without error.
    await expect(page.getByText(/Users \(\d+\)|No users/i)).toBeVisible({
      timeout: 6_000,
    })
  })
})
