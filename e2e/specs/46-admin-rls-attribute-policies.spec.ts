import { test, expect } from '../fixtures'
import { createTestUser, deleteTestUser } from '../helpers/security'

// /admin/rls-attribute — full add+remove and (when the build allows
// it) an end-to-end behavior gate where a row is filtered by the
// querying user's attribute.

test.describe('admin / RLS attribute policies', () => {
  test('add an attribute policy then remove it', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/rls-attribute')
    const newBtn = page.getByTestId('admin-new-rls-attribute-btn')
    await expect(newBtn).toBeVisible({ timeout: 6_000 })
    const disabled = await newBtn.isDisabled()
    test.skip(disabled, 'RLS attribute-policy management unavailable')

    await newBtn.click()
    await page.getByTestId('rls-attr-form-graph').fill('default')
    await page.getByTestId('rls-attr-form-label').fill('DocE2E')
    await page.getByTestId('rls-attr-form-row-property').fill('department')
    await page.getByTestId('rls-attr-form-attribute-key').fill('department')
    // Live preview confirms wiring before submit
    await expect(page.getByTestId('rls-attr-form-preview')).toHaveText(
      'row.department = principal.attribute.department'
    )
    await page.getByTestId('rls-attr-submit').click()

    await expect(page.getByText('DocE2E').first()).toBeVisible({
      timeout: 6_000,
    })

    // Remove via row + ConfirmModal Delete.
    await page.getByTestId('rls-attr-remove-DocE2E').click()
    const dialogs = page.getByRole('dialog')
    await dialogs.last().getByRole('button', { name: /^delete$/i }).click()
  })

  test('end-to-end: attribute policy filters rows by user attribute', async ({
    authedPage: page,
    request,
    authToken,
  }) => {
    await page.goto('/admin/rls-attribute')
    const newBtn = page.getByTestId('admin-new-rls-attribute-btn')
    await expect(newBtn).toBeVisible({ timeout: 6_000 })
    test.skip(await newBtn.isDisabled(), 'attribute policies unavailable')

    const adminHeaders = {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    }
    const seedRes = await request.post('/api/v1/query', {
      headers: adminHeaders,
      data: {
        statement:
          "CREATE (:DocE2EAttr {title: 'eng-only', department: 'engineering'}), (:DocE2EAttr {title: 'finance-only', department: 'finance'})",
      },
    })
    test.skip(!seedRes.ok(), 'seed nodes CREATE rejected')

    let username: string | undefined
    let password: string | undefined
    try {
      const created = await createTestUser(page, 'rls_attr')
      username = created.username
      password = created.password
    } catch (e) {
      test.skip(true, `user creation failed: ${(e as Error).message}`)
      return
    }

    try {
      // Open user attributes modal and add department=engineering
      await page.goto('/admin/users')
      const row = page.locator('tr', { hasText: username! })
      await row.getByRole('button', { name: /User attributes/i }).click()
      await page.getByTestId('user-attributes-add-btn').click()
      await page.getByTestId('user-attr-new-key').fill('department')
      await page.getByTestId('user-attr-new-value').fill('engineering')
      await page.getByTestId('user-attr-submit-btn').click()
      const setFailed = await page
        .getByTestId('user-attributes-form-error')
        .isVisible({ timeout: 1_000 })
        .catch(() => false)
      test.skip(setFailed, 'user_set_attribute unavailable')
      await expect(page.getByText('engineering')).toBeVisible()
      await page.keyboard.press('Escape')

      // Create the attribute policy
      await page.goto('/admin/rls-attribute')
      await newBtn.click()
      await page.getByTestId('rls-attr-form-graph').fill('default')
      await page.getByTestId('rls-attr-form-label').fill('DocE2EAttr')
      await page.getByTestId('rls-attr-form-row-property').fill('department')
      await page
        .getByTestId('rls-attr-form-attribute-key')
        .fill('department')
      await page.getByTestId('rls-attr-submit').click()
      await expect(page.getByText('DocE2EAttr').first()).toBeVisible()

      // Sign in as test user via REST and query
      const login = await request.post('/api/v1/auth/login', {
        form: { username: username!, password: password! },
      })
      test.skip(!login.ok(), `login as test user failed (${login.status()})`)
      const userToken = ((await login.json()) as { token: string }).token
      const result = await request.post('/api/v1/query', {
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        data: { statement: 'MATCH (d:DocE2EAttr) RETURN d.title' },
      })
      expect(result.ok()).toBeTruthy()
      const body = (await result.json()) as {
        rows: Array<Array<unknown>>
        row_count: number
      }
      expect(body.row_count).toBe(1)
      expect(body.rows[0]?.[0]).toBe('eng-only')
    } finally {
      // Best-effort cleanup
      await page.goto('/admin/rls-attribute').catch(() => undefined)
      const rowBtn = page.getByTestId('rls-attr-remove-DocE2EAttr')
      if (await rowBtn.isVisible().catch(() => false)) {
        await rowBtn.click()
        const dialogs = page.getByRole('dialog')
        await dialogs
          .last()
          .getByRole('button', { name: /^delete$/i })
          .click()
          .catch(() => undefined)
      }
      if (username) {
        await deleteTestUser(page, username).catch(() => undefined)
      }
      await request
        .post('/api/v1/query', {
          headers: adminHeaders,
          data: { statement: 'MATCH (d:DocE2EAttr) DETACH DELETE d' },
        })
        .catch(() => undefined)
    }
  })
})
