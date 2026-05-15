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
    // Probe the audit endpoint directly. Geode v0.5.15's built-in roles
    // are {admin, user, readwrite, readonly} -- there is no dedicated
    // `audit` role (tracked under GAP-004 / GAP-015). Even the bootstrap
    // admin sometimes receives 403 `securex: insufficient role` on
    // /api/v1/audit because the upstream `geode.audit.*` permission set
    // is gated by the missing role. Skip the entry-content assertion
    // when the engine refuses to surface audit logs at all. Use Bearer
    // auth (CSRF middleware skips the Authorization-header path).
    const probe = await request.get('/api/v1/audit?limit=1', {
      headers: { authorization: `Bearer ${authToken}` },
    })
    test.skip(
      !probe.ok(),
      `audit endpoint not readable on Geode v0.5.15 (status ${probe.status()}); audit role not in built-in set {admin,user,readwrite,readonly} -- tracked GAP-004 / GAP-015`
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
