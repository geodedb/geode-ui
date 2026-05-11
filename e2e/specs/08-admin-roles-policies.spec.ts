import { test, expect, Page } from '@playwright/test'
import { test as authedTest } from '../fixtures'
import { sel } from '../helpers/selectors'

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

// Phase-1 reproduction: against the running v0.5.11 stack, the connected
// Geode build does not accept CREATE ROLE / CREATE POLICY / GRANT over
// the wire. The SPA learns this from GET /api/v1/capabilities and gates
// the "+ New role", "+ New policy", and Grants Apply/Revoke CTAs (hide,
// or render disabled with an explanatory title) plus an inline
// "unsupported" note on each panel.
//
// On the current (pre-fix) build these fail: the CTAs render enabled and
// there is no capabilities-driven gating.
authedTest.describe('admin / RBAC CTA gating (Phase 1)', () => {
  authedTest(
    '"+ New role" is gated against the connected Geode build',
    async ({ authedPage: page }) => {
      await page.goto('/admin/roles')
      await page
        .getByText(/roles \(\d+\)|No roles|geode/i)
        .first()
        .waitFor({ timeout: 6_000 })
        .catch(() => undefined)
      await expect(sel.adminRolesUnsupported(page)).toBeVisible({
        timeout: 6_000,
      })
      const btn = sel.adminNewRoleBtn(page)
      if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await expect(btn).toBeDisabled()
        const title = await btn.getAttribute('title')
        expect(title && title.length > 0).toBeTruthy()
      }
    }
  )

  authedTest(
    '"+ New policy" is gated against the connected Geode build',
    async ({ authedPage: page }) => {
      await page.goto('/admin/policies')
      await page
        .getByText(/policies \(\d+\)|No policies|geode/i)
        .first()
        .waitFor({ timeout: 6_000 })
        .catch(() => undefined)
      await expect(sel.adminPoliciesUnsupported(page)).toBeVisible({
        timeout: 6_000,
      })
      const btn = sel.adminNewPolicyBtn(page)
      if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await expect(btn).toBeDisabled()
        const title = await btn.getAttribute('title')
        expect(title && title.length > 0).toBeTruthy()
      }
    }
  )

  authedTest(
    'Grants Apply/Revoke are gated against the connected Geode build',
    async ({ authedPage: page }) => {
      await page.goto('/admin/grants')
      await expect(sel.adminGrantsUnsupported(page)).toBeVisible({
        timeout: 6_000,
      })
      const apply = sel.adminGrantsApplyBtn(page)
      const revoke = sel.adminGrantsRevokeBtn(page)
      if (await apply.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await expect(apply).toBeDisabled()
      }
      if (await revoke.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await expect(revoke).toBeDisabled()
      }
    }
  )
})
