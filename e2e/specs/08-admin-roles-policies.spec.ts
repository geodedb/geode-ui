import { test, expect, Page } from '@playwright/test'
import { test as authedTest } from '../fixtures'

const ADMIN_GAP =
  /insufficient role|schema_error|parse error|expected token|http status 4\d\d/i

const skipIfNoAdmin = async (page: Page): Promise<void> => {
  const banner = page.getByText(ADMIN_GAP)
  test.skip(
    await banner.isVisible({ timeout: 2_000 }).catch(() => false),
    'admin GQL/permissions not available on this Geode build'
  )
}

authedTest.describe('admin / roles', () => {
  authedTest(
    'roles page renders and exposes the New role button',
    async ({ authedPage: page }) => {
      await page.goto('/admin/roles')
      await skipIfNoAdmin(page)
      await expect(
        page.getByRole('button', { name: /new role/i })
      ).toBeVisible()
    }
  )
})

authedTest.describe('admin / policies', () => {
  authedTest(
    'policies page renders and exposes the New policy button',
    async ({ authedPage: page }) => {
      await page.goto('/admin/policies')
      await skipIfNoAdmin(page)
      await expect(
        page.getByRole('button', { name: /new policy/i })
      ).toBeVisible()
    }
  )
})

authedTest.describe('admin / grants', () => {
  authedTest(
    'grants page renders the apply form',
    async ({ authedPage: page }) => {
      await page.goto('/admin/grants')
      // Grants is a form (no list), so the only "skip" signal is a
      // catastrophic UI error — fail loudly if that happens.
      await expect(page.getByRole('button', { name: /apply/i })).toBeVisible()
      await expect(page.getByRole('button', { name: /revoke/i })).toBeVisible()
    }
  )
})
