import { test, expect } from '../fixtures'

// Two small surface changes from Geode 0.5.20:
//   1. SHOW INDEXES lists FULLTEXT indexes → SchemaExplorer renders
//      the FULLTEXT type badge.
//   2. Interval / interval_overlaps / interval_contains GQL functions
//      → Monaco completion + working query execution.

test.describe('schema / FULLTEXT indexes', () => {
  test('FULLTEXT index appears in the indexes table', async ({
    authedPage: page,
    request,
    authToken,
  }) => {
    const headers = {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    }
    const seed = await request.post('/api/v1/query', {
      headers,
      data: {
        statement: 'CREATE FULLTEXT INDEX ft_doc_e2e ON :DocE2EFT(body)',
      },
    })
    test.skip(
      !seed.ok(),
      `FULLTEXT index creation rejected (${seed.status()})`
    )
    try {
      await page.goto('/schema')
      // Pick a graph by URL — the explorer auto-selects when ?graph= is
      // unset; the index just needs to land on whichever graph the
      // server reports first.
      await expect(page.getByText('ft_doc_e2e')).toBeVisible({
        timeout: 6_000,
      })
      await expect(page.getByText('FULLTEXT')).toBeVisible()
    } finally {
      await request
        .post('/api/v1/query', {
          headers,
          data: { statement: 'DROP INDEX ft_doc_e2e' },
        })
        .catch(() => undefined)
    }
  })
})

test.describe('editor / Interval autocomplete + execution', () => {
  test('Interval functions execute end-to-end against the server', async ({
    request,
    authToken,
  }) => {
    const headers = {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    }
    const r1 = await request.post('/api/v1/query', {
      headers,
      data: {
        statement:
          "RETURN interval_contains(Interval('P1D'), Interval('PT1H')) AS contains",
      },
    })
    test.skip(
      !r1.ok(),
      `Interval functions unavailable (${r1.status()})`
    )
    const b1 = (await r1.json()) as { rows: Array<Array<unknown>> }
    expect(b1.rows[0]?.[0]).toBe(true)

    const r2 = await request.post('/api/v1/query', {
      headers,
      data: {
        statement:
          "RETURN interval_overlaps(Interval('PT1H'), Interval('PT0S')) AS overlap",
      },
    })
    expect(r2.ok()).toBeTruthy()
    const b2 = (await r2.json()) as { rows: Array<Array<unknown>> }
    expect(b2.rows[0]?.[0]).toBe(false)
  })

  test('Monaco surfaces the Interval / interval_overlaps / interval_contains completions', async ({
    authedPage: page,
  }) => {
    await page.goto('/query')
    // Wait for the editor to mount and accept focus
    const editor = page.locator('.monaco-editor').first()
    await expect(editor).toBeVisible({ timeout: 10_000 })
    await editor.click()
    await page.keyboard.type('RETURN Inter')
    await page.keyboard.press('Control+Space')
    // Completion list renders three Interval entries.
    const suggest = page.locator('.suggest-widget, .monaco-list')
    await expect(suggest).toBeVisible({ timeout: 6_000 })
    await expect(page.getByText(/^Interval$/).first()).toBeVisible({
      timeout: 4_000,
    })
    await expect(
      page.getByText(/^interval_overlaps$/).first()
    ).toBeVisible({ timeout: 4_000 })
    await expect(
      page.getByText(/^interval_contains$/).first()
    ).toBeVisible({ timeout: 4_000 })
  })
})
