import { Page, expect } from '@playwright/test'

// Shared helpers for the security/policy e2e specs (44-47). Each
// spec covers a single subsystem (user attributes, RLS deny, RLS
// attribute, FULLTEXT + Interval). Helpers stay scope-limited:
//   - createTestUser / deleteTestUser drive the admin UsersPage
//   - rlsAdminGap is the wire_feature_missing skip regex
//
// These deliberately reuse the SPA itself instead of bypassing into
// the REST API for user lifecycle — that way the spec keeps
// covering the UI path our users actually take.

export const ADMIN_GAP_RE =
  /insufficient role|wire_feature_missing|http status 4\d\d|not supported on the connected geode build/i

export async function skipIfNoAdmin(
  page: Page,
  testSkip: (cond: boolean, reason: string) => void,
  reason: string
): Promise<void> {
  const visible = await page
    .getByText(ADMIN_GAP_RE)
    .first()
    .isVisible({ timeout: 2_000 })
    .catch(() => false)
  testSkip(visible, reason)
}

// createTestUser drives the existing UsersPage to register a user we
// can attach attributes / policies to. Returns the username + the
// generated password (read from the form before submit). On error
// throws so the spec fails loudly rather than masking the problem
// inside a try/finally.
export async function createTestUser(
  page: Page,
  prefix: string
): Promise<{ username: string; password: string }> {
  const username = `${prefix}_${Date.now().toString(36)}`
  await page.goto('/admin/users')
  await page.getByRole('button', { name: /new user/i }).click()
  await page.getByLabel(/username/i).fill(username)
  await page.getByLabel(/email/i).fill(`${username}@example.test`)
  await page.getByRole('button', { name: /generate/i }).click()
  const passwordInput = page.getByLabel(/password/i)
  const password = await passwordInput.inputValue()
  await page.getByRole('button', { name: /^create$/i }).click()
  await expect(page.getByText(username)).toBeVisible({ timeout: 10_000 })
  return { username, password }
}

export async function deleteTestUser(
  page: Page,
  username: string
): Promise<void> {
  await page.goto('/admin/users')
  const row = page.locator('tr', { hasText: username })
  await row.getByRole('button', { name: /^delete$/i }).click()
  await page.getByRole('button', { name: /^delete|^confirm/i }).click()
  await expect(row).toHaveCount(0, { timeout: 10_000 })
}
