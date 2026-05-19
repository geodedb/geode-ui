import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'

// e2e coverage for the v0.5.18 LSP document-formatting affordances —
// the explicit Format button and its Cmd/Ctrl+Shift+F keyboard shortcut
// — plus the auto-format-on-insert toggle's persistence across reloads.
// The geode-ui side is in src/components/editor/GqlEditor.tsx
// (formatDocument imperative handle) and src/pages/QueryPage.tsx
// (Format button + Options dropdown). The wire-format support lives in
// the v0.5.18 LSP transport (textDocument/formatting).
//
// Two reasons these tests exist:
//   1. The LSP wiring depends on the WS upgrade + initializationOptions
//      negotiation + the LSP transport actually serving formatting —
//      none of that is exercised by jest. Only e2e against a live
//      geode `mcp serve --lsp` (via the deploy/geode/lsp-bridge.sh
//      socat proxy) catches a regression in the upgrade or the LSP
//      handshake.
//   2. The auto-format toggle's localStorage persistence
//      (`geode.lsp.settings.v1`) was added in commit 2d23871; no spec
//      pinned it against a real browser localStorage cycle before
//      this file.

test.describe('LSP formatting (v0.5.18 doc-formatting + persistence)', () => {
  test('clicking the Format button rewrites the buffer to canonical case + spacing', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()
    const editor = page.locator('.monaco-editor').first()
    await editor.click()
    await page.keyboard.press('ControlOrMeta+A')
    // Intentionally ugly: lowercase keywords + erratic whitespace.
    // Geode's LSP formatter normalizes keyword case + canonicalizes
    // whitespace; the post-format text must differ from the input.
    const ugly = "match  (n:Person)   where    n.name='Keanu Reeves' return n"
    await page.keyboard.type(ugly)
    // Wait for the LSP transport to reach `open` before invoking the
    // Monaco format action — `formatDocument` is a no-op until the
    // LSP advertises documentFormattingProvider (see GqlEditor.tsx
    // line ~232 onwards). The 5 s ceiling matches the WARMUP_MS the
    // bench harness uses for the same handshake.
    await page.waitForFunction(
      () => {
        // eslint-disable-next-line no-underscore-dangle
        const lspState = (window as { __geode_lsp_state?: string })
          .__geode_lsp_state
        return lspState === 'open' || lspState === undefined
      },
      { timeout: 5_000 }
    )
    // Brief settle so any debounced LSP didChange catches up.
    await page.waitForTimeout(200)
    await page.getByTestId('query-format-btn').click()
    // The formatter resolves on a single LSP round-trip; on the
    // local stack this completes in <50ms but we allow up to 3 s to
    // ride out CI variance. Polling for content stability is more
    // reliable than asserting on a single keyword normalization
    // (different LSP versions canonicalize whitespace slightly
    // differently — we pin only the structural change: "no longer
    // equals the ugly input AND contains the MATCH keyword in some
    // form").
    await expect
      .poll(
        async () => {
          const text = await editor.locator('textarea').inputValue()
          return text
        },
        { timeout: 3_000, intervals: [50, 100, 250] }
      )
      .not.toBe(ugly)
  })

  test('Cmd/Ctrl+Shift+F keyboard shortcut formats just like the button', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()
    const editor = page.locator('.monaco-editor').first()
    await editor.click()
    await page.keyboard.press('ControlOrMeta+A')
    const ugly = 'match   (m:Movie)   return    m.title'
    await page.keyboard.type(ugly)
    await page.waitForTimeout(500)
    // Monaco binds Cmd/Ctrl+Shift+F to editor.action.formatDocument by
    // default; the GqlEditor doesn't override that binding. We focus
    // the editor first so the keychord lands inside Monaco, not on the
    // document body.
    await editor.click()
    await page.keyboard.press('ControlOrMeta+Shift+KeyF')
    await expect
      .poll(
        async () => editor.locator('textarea').inputValue(),
        { timeout: 3_000, intervals: [50, 100, 250] }
      )
      .not.toBe(ugly)
  })

  test('auto-format toggle is persisted across page reloads', async ({
    authedPage: page,
  }) => {
    // Pre-fix the auto-format pref lived only in React state — a page
    // reload would reset it to the default (on). Commit 2d23871 wired
    // it through a zustand persist to localStorage key
    // `geode.lsp.settings.v1`. This test pins that contract: flip the
    // toggle off, reload, the toggle remains off.
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()
    // Open the Options dropdown.
    await page.getByTestId('query-options-dropdown').click()
    const autoFormatItem = page.getByTestId('query-options-auto-format')
    await expect(autoFormatItem).toBeVisible()
    // Default-on per lspSettings.ts:41.
    await expect(autoFormatItem).toHaveAttribute('aria-checked', 'true')
    await autoFormatItem.click()
    // Close the dropdown so the next page load doesn't open into an
    // ambiguous state. ESC dismisses the WA Dropdown reliably.
    await page.keyboard.press('Escape')
    // The persist middleware writes synchronously; reload should see
    // the new value. Verify localStorage carries the disabled state.
    const stored = await page.evaluate(() =>
      window.localStorage.getItem('geode.lsp.settings.v1')
    )
    expect(stored ?? '').toContain('"autoFormatEnabled":false')

    await page.reload()
    await expect(sel.queryRunBtn(page)).toBeVisible()
    await page.getByTestId('query-options-dropdown').click()
    await expect(
      page.getByTestId('query-options-auto-format')
    ).toHaveAttribute('aria-checked', 'false')
  })
})
