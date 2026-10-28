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

// Geode v0.5.15 enables CREATE / DROP ROLE and GRANT / REVOKE over the
// GQL wire. CREATE POLICY remains upstream-deferred per
// `geode/docs/GQL_AUTH_DDL.md` Limitations #3 (RLS policy DDL is parsed
// but `handlePolicyCreate` still returns wire_feature_missing). The
// policies describe block is therefore fixme'd against the upstream
// gap, while roles + grants run live.
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
  authedTest.fixme(
    true,
    'policies (CREATE POLICY) still upstream-deferred per docs/GQL_AUTH_DDL.md Limitations #3'
  )
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

// Geode v0.5.15: capabilities reports admin_writable.{roles,grants}=true.
// The SPA must NOT render the unsupported affordance and the New role /
// Apply / Revoke CTAs must be operable. Policies remain gated because
// admin_writable.policies=false (CREATE POLICY upstream-deferred).
authedTest.describe('admin / RBAC CTA gating (v0.5.15)', () => {
  authedTest(
    '"+ New role" is enabled and unsupported banner is absent',
    async ({ authedPage: page }) => {
      await page.goto('/admin/roles')
      await page
        .getByText(/roles \(\d+\)|No roles|geode/i)
        .first()
        .waitFor({ timeout: 6_000 })
        .catch(() => undefined)
      await expect(sel.adminRolesUnsupported(page)).toHaveCount(0)
      const btn = sel.adminNewRoleBtn(page)
      await expect(btn).toBeVisible({ timeout: 6_000 })
      await expect(btn).toBeEnabled()
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
      // The gate follows capabilities.admin_writable.policies, which the
      // server derives from the engine's policy_ddl feature: false on
      // v0.5.15, true from the 0.8 line on. Assert whichever the
      // connected build reports.
      const capsRes = await page.request.get('/api/v1/capabilities')
      expect(capsRes.ok()).toBeTruthy()
      const caps = await capsRes.json()
      const btn = sel.adminNewPolicyBtn(page)
      if (caps?.admin_writable?.policies === true) {
        await expect(sel.adminPoliciesUnsupported(page)).toHaveCount(0)
        await expect(btn).toBeVisible({ timeout: 6_000 })
        await expect(btn).toBeEnabled()
        return
      }
      await expect(sel.adminPoliciesUnsupported(page)).toBeVisible({
        timeout: 6_000,
      })
      if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await expect(btn).toBeDisabled()
        const title = await btn.getAttribute('title')
        expect(title && title.length > 0).toBeTruthy()
      }
    }
  )

  authedTest(
    'Grants Apply/Revoke are enabled under v0.5.15',
    async ({ authedPage: page }) => {
      await page.goto('/admin/grants')
      await expect(sel.adminGrantsUnsupported(page)).toHaveCount(0)
      const apply = sel.adminGrantsApplyBtn(page)
      const revoke = sel.adminGrantsRevokeBtn(page)
      await expect(apply).toBeVisible({ timeout: 6_000 })
      await expect(revoke).toBeVisible()
      await expect(apply).toBeEnabled()
      await expect(revoke).toBeEnabled()
    }
  )
})
