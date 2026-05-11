import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

test.describe('query (sync)', () => {
  test('runs MATCH and shows the expected number of rows', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()

    // Filter to the matrix-cluster names from seed.people so all rows
    // fit in the virtualized table's first viewport (TableView uses
    // react-window post-#26 — off-viewport rows aren't in the DOM).
    // The 133-row total is asserted by the count-summary test below.
    const namesGql = seed.people.map((n) => `'${n}'`).join(', ')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) WHERE n.name IN [${namesGql}] RETURN n.name AS name ORDER BY name`
    )

    await sel.queryRunBtn(page).click()

    // Row-count summary lives outside the virtualized list, always
    // rendered. Filtered query returns exactly seed.people.length rows.
    await expect(
      page.getByText(new RegExp(`${seed.people.length} rows?`))
    ).toBeVisible()

    // Switch to table tab, verify the seeded names appear. Scope to
    // the table cells via role — the same names also appear inside the
    // Monaco editor as quoted IN-list literals, which would trip
    // Playwright's strict-mode getByText.
    await sel.queryTabTable(page).click()
    await Promise.all(
      seed.people.map((name) =>
        expect(page.getByRole('cell', { name })).toBeVisible()
      )
    )
  })

  test('row-count summary reflects total Person count', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n.name AS name`
    )
    await sel.queryRunBtn(page).click()
    // Summary line is outside the virtualized table; the 133 unfiltered
    // rows are accepted by the server even if only ~16 are in the DOM.
    await expect(
      page.getByText(new RegExp(`${seed.counts.persons} rows?`))
    ).toBeVisible({ timeout: 10_000 })
  })

  test('a syntactically broken query surfaces an error banner', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('NOT A REAL QUERY ;;;')
    await sel.queryRunBtn(page).click()
    await expect(
      page
        .locator('span', { hasText: /query_error|syntax|unexpected|parse/i })
        .first()
    ).toBeVisible()
  })

  test('switches to JSON tab and shows valid JSON', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n.name LIMIT 1`
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/1 rows?/)).toBeVisible()
    await sel.queryTabJson(page).click()
    const txt = await page.locator('pre').textContent()
    expect(txt && txt.length).toBeGreaterThan(0)
    expect(() => JSON.parse(txt!)).not.toThrow()
  })

  // Reproduction for the "no maximize affordance / result panel can't
  // fill the viewport" gap. After a query runs, the result-panel
  // toolbar must expose a maximize toggle that expands the result panel
  // into a viewport-filling `position: fixed; inset: 0` overlay,
  // dismissable via Escape. On the pre-fix build the testid does not
  // exist, so the toggle locator never resolves.
  test('result panel has a maximize toggle that opens a viewport-filling overlay', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n.name LIMIT 1`
    )
    await sel.queryRunBtn(page).click()
    // Wait for the result tabs (the toolbar that hosts the toggle).
    await expect(sel.queryTabTable(page)).toBeVisible()

    const toggle = sel.resultFullscreenToggle(page)
    await expect(toggle).toBeVisible()
    await toggle.click()

    const overlay = sel.resultFullscreenOverlay(page)
    await expect(overlay).toBeVisible()
    const vp = page.viewportSize()
    const box = await overlay.boundingBox()
    expect(box).not.toBeNull()
    // Roughly viewport-sized (allow a few px of tolerance for borders /
    // scrollbars).
    expect(Math.abs(box!.width - vp!.width)).toBeLessThanOrEqual(4)
    expect(Math.abs(box!.height - vp!.height)).toBeLessThanOrEqual(4)
    expect(box!.x).toBeLessThanOrEqual(4)
    expect(box!.y).toBeLessThanOrEqual(4)

    // Escape dismisses it.
    await page.keyboard.press('Escape')
    await expect(overlay).toBeHidden()
  })
})
