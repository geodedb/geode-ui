import { test, expect } from '../fixtures'

// /admin/rls-deny — listing, add, remove, behavioral gate-check.
// Skips on Geode builds whose capabilities probe reports
// rlsDenyPolicies=false.

test.describe('admin / RLS deny policies', () => {
  test('add a deny policy then remove it', async ({ authedPage: page }) => {
    await page.goto('/admin/rls-deny')
    const newBtn = page.getByTestId('admin-new-rls-deny-btn')
    await expect(newBtn).toBeVisible({ timeout: 6_000 })
    const disabled = await newBtn.isDisabled()
    test.skip(disabled, 'RLS deny-policy management unavailable')

    await newBtn.click()
    await page.getByTestId('rls-deny-form-graph').fill('default')
    await page.getByTestId('rls-deny-form-label').fill('TestPersonE2E')
    await page.getByTestId('rls-deny-form-username').fill('')
    await page.getByTestId('rls-deny-submit').click()

    await expect(page.getByText('TestPersonE2E')).toBeVisible({
      timeout: 6_000,
    })

    // Remove via row Delete button + ConfirmModal Delete.
    await page.getByTestId('rls-deny-remove-TestPersonE2E').click()
    const dialogs = page.getByRole('dialog')
    await dialogs.last().getByRole('button', { name: /^delete$/i }).click()
    await expect(page.getByText('TestPersonE2E')).toBeHidden({
      timeout: 6_000,
    })
  })

  test('deny policy hides matching rows from non-admin reads', async ({
    authedPage: page,
    request,
    authToken,
  }) => {
    await page.goto('/admin/rls-deny')
    const newBtn = page.getByTestId('admin-new-rls-deny-btn')
    await expect(newBtn).toBeVisible({ timeout: 6_000 })
    const disabled = await newBtn.isDisabled()
    test.skip(disabled, 'RLS deny-policy management unavailable')

    const headers = {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    }
    // Seed two nodes
    const seedRes = await request.post('/api/v1/query', {
      headers,
      data: { statement: "CREATE (:GateE2E {name: 'gate-check'})" },
    })
    test.skip(
      !seedRes.ok(),
      `seed CREATE not accepted: ${seedRes.status()}`
    )

    try {
      // Add a deny policy targeting the label for all users.
      await newBtn.click()
      await page.getByTestId('rls-deny-form-graph').fill('default')
      await page.getByTestId('rls-deny-form-label').fill('GateE2E')
      await page.getByTestId('rls-deny-submit').click()
      await expect(page.getByText('GateE2E')).toBeVisible()

      // Query — expect 0 rows once the policy is active.
      const after = await request.post('/api/v1/query', {
        headers,
        data: { statement: 'MATCH (n:GateE2E) RETURN n.name' },
      })
      expect(after.ok()).toBeTruthy()
      const body = (await after.json()) as { row_count: number }
      expect(body.row_count).toBe(0)
    } finally {
      // Remove the policy + clean up the seed node.
      const rowBtn = page.getByTestId('rls-deny-remove-GateE2E')
      if (await rowBtn.isVisible().catch(() => false)) {
        await rowBtn.click()
        const dialogs = page.getByRole('dialog')
        await dialogs
          .last()
          .getByRole('button', { name: /^delete$/i })
          .click()
          .catch(() => undefined)
      }
      await request
        .post('/api/v1/query', {
          headers,
          data: { statement: 'MATCH (n:GateE2E) DETACH DELETE n' },
        })
        .catch(() => undefined)
    }
  })
})
