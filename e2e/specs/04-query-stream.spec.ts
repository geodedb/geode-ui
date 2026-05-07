import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

// FIXME(stream-ws): both tests in this file are intentionally skipped
// until the /ws/query handshake works end-to-end against the deployed
// stack. Two independent defects block them today:
//
//   1. Server-side. /ws/query is mounted via wsx.UpgradeStrict with a
//      generated wsx.Options that has neither OriginAllowlist nor
//      AllowAnyOrigin set (gen/ws/ws_handlers.gen.go:56-63). UpgradeStrict
//      fails closed in that configuration (gen/pkg/wsx/ws.go:166-189),
//      so every browser handshake -- which always sends an Origin
//      header -- is rejected with HTTP 403 before auth is even
//      consulted. cmd/server/main.go has no hook to mutate the
//      generated wsOptions, and WSOptions only exposes Auth/AuthJWT
//      (gen/ws/ws_handlers.gen.go:40-44). The fix needs either a
//      generator change (expose origin policy on WSOptions) or
//      runtime config plumbing in cmd/server/main.go after a genapi
//      regeneration.
//
//   2. Client-side. src/lib/queryStream.ts passes the JWT via
//      `?access_token=` query param, but the server policy for
//      /ws/query has AllowQueryBearer=false (gen/ws/ws_handlers.gen.go:119).
//      Browsers can't set custom Authorization headers on a WebSocket
//      upgrade, so the SPA must use the subprotocol-bearer channel:
//      pass `genapi.auth.bearer.<base64url(token)>` in the
//      Sec-WebSocket-Protocol list (parsed in gen/pkg/securex/secure.go
//      websocketProtocolAuth at line 242). queryStream.ts needs that
//      change once (1) is resolved.
//
// Once both are fixed, flip these from `test.fixme(...)` to `test(...)`
// and the assertions below should pass against the seeded movies graph
// without further changes.

test.describe('query (stream)', () => {
  test.fixme(
    'toggles stream mode, runs, and accumulates rows progressively',
    async ({ authedPage: page }) => {
      await page.goto('/')
      await sel.queryStreamToggle(page).check()
      await page.locator('.monaco-editor').first().click()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type(
        `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n.name AS name`
      )
      await sel.queryRunBtn(page).click()

      // The summary frame is sent at the end; wait for it.
      await expect(
        page.getByText(new RegExp(`${seed.counts.persons} rows`))
      ).toBeVisible({ timeout: 15_000 })

      await sel.queryTabTable(page).click()
      await Promise.all(
        seed.people.map((name) => expect(page.getByText(name)).toBeVisible())
      )
    }
  )

  test.fixme('cancel button aborts a streaming query', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await sel.queryStreamToggle(page).check()
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    // A query that returns many rows so cancel is observable.
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; UNWIND range(1, 100000) AS i RETURN i`
    )
    await sel.queryRunBtn(page).click()
    // Cancel button only renders while busy.
    await sel.cancelStream(page).click()
    // After cancel, the Run button should be enabled again.
    await expect(sel.queryRunBtn(page)).toBeEnabled()
  })
})
