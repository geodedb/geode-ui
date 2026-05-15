import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

// /ws/query is configured with allow_any_origin (geode.json) and the
// SPA passes the JWT via the `genapi.auth.bearer.<base64url(token)>`
// subprotocol (src/lib/queryStream.ts), so the upgrade now works
// end-to-end against the seeded movies graph.

test.describe('query (stream)', () => {
  test('toggles stream mode, runs, and accumulates rows progressively', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await sel.queryOptionsTrigger(page).click()
    await sel.queryStreamToggle(page).click()
    // Filter to the matrix-cluster names so all rows fit in the
    // virtualized table's first viewport (TableView uses react-window
    // post-#26 — off-viewport rows aren't in the DOM). Streaming the
    // full 133 still works end-to-end; that's covered separately.
    const namesGql = seed.people.map((n) => `'${n}'`).join(', ')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) WHERE n.name IN [${namesGql}] RETURN n.name AS name ORDER BY name`
    )
    await sel.queryRunBtn(page).click()

    // The summary frame is sent at the end; wait for it.
    await expect(
      page.getByText(new RegExp(`${seed.people.length} rows?`))
    ).toBeVisible({ timeout: 15_000 })

    await sel.queryTabTable(page).click()
    // Scope to table cells via role — same names appear in the Monaco
    // editor's IN-list literals, which would trip strict-mode getByText.
    await Promise.all(
      seed.people.map((name) =>
        expect(page.getByRole('cell', { name })).toBeVisible()
      )
    )
  })

  test('cancel button aborts a streaming query', async ({
    authedPage: page,
  }) => {
    // The seeded movies graph is tiny (9 nodes) and even a 6x6 cartesian
    // returns in <10ms, so any real query finishes before Playwright can
    // observe the "busy" state. Instead, intercept the /ws/query
    // upgrade in the browser and stall the server-bound `start` frame
    // so the UI stays busy long enough to click cancel. The mocked WS
    // does not relay messages to the real server, so this is a pure UI
    // test of the cancel control.
    await page.routeWebSocket(/\/ws\/query/, (ws) => {
      // Intentionally never call ws.connectToServer() — we keep the
      // upgrade open from the browser's perspective forever, which
      // freezes the SPA in the "busy" state until cancel is clicked.
      ws.onMessage(() => {
        /* swallow */
      })
    })
    await page.goto('/')
    await sel.queryOptionsTrigger(page).click()
    await sel.queryStreamToggle(page).click()
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n.name AS name`
    )
    await sel.queryRunBtn(page).click()
    // Cancel button only renders while busy.
    await sel.cancelStream(page).click()
    // After cancel, the Run button should be enabled again.
    await expect(sel.queryRunBtn(page)).toBeEnabled()
  })
})
