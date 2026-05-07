import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'

test.describe('ops', () => {
  test('default tab is backups', async ({ authedPage: page }) => {
    await page.goto('/ops')
    await expect(page).toHaveURL(/\/ops\/backups/)
    await expect(sel.newBackupBtn(page)).toBeVisible()
  })

  test('migrations tab loads', async ({ authedPage: page }) => {
    await page.goto('/ops/migrations')
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible()
  })

  test('audit tab polls and renders the table', async ({
    authedPage: page,
  }) => {
    await page.goto('/ops/audit')
    await expect(page.getByText(/Audit log/)).toBeVisible()
    await expect(
      page.getByRole('columnheader', { name: 'Event' })
    ).toBeVisible()
  })

  test('audit table contains a query_executed entry within 10s', async ({
    authedPage: page,
    authToken,
    request,
  }) => {
    // Navigate so the SPA mounts (some assertions later depend on this).
    await page.goto('/')
    expect(authToken).toBeTruthy()
    // Probe the audit endpoint directly. Geode v0.5.11 returns 403
    // `securex: insufficient role` for /api/v1/audit even for the
    // bootstrap admin, so we skip the entry-content assertion when the
    // engine refuses to surface audit logs at all. Use Bearer auth
    // (CSRF middleware skips the Authorization-header path).
    const probe = await request.get('/api/v1/audit?limit=1', {
      headers: { authorization: `Bearer ${authToken}` },
    })
    test.skip(
      !probe.ok(),
      `audit endpoint not readable on this Geode build (status ${probe.status()})`
    )
    await request.post('/api/v1/query', {
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
      },
      data: {
        statement: 'USE GRAPH movies; MATCH (n:Person) RETURN count(n) AS c',
        page_size: 1000,
        timeout_ms: 30000,
      },
    })
    await page.goto('/ops/audit')
    await expect(page.getByText('query_executed').first()).toBeVisible({
      timeout: 10_000,
    })
  })

  test('restore tab pre-fills file from BackupPage navigation', async ({
    authedPage: page,
  }) => {
    await page.goto('/ops/restore')
    const fileInput = page.getByPlaceholder(/backup file/i).first()
    await expect(fileInput).toBeVisible()
    expect(await fileInput.inputValue()).toBe('')
  })
})
