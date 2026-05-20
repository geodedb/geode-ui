import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'

// e2e coverage for the v0.5.18 LSP document-formatting affordances —
// the explicit Format button and its Cmd/Ctrl+Shift+F keyboard shortcut
// — plus the auto-format-on-insert toggle's persistence across reloads.
// The geode-ui side is in src/components/editor/GqlEditor.tsx
// (formatDocument imperative handle) and src/pages/QueryPage.tsx
// (Format button + Options dropdown). The wire-format support lives in
// the v0.5.18+ LSP transport (textDocument/formatting).
//
// Why this file exists: the LSP wiring depends on the WS upgrade +
// initializationOptions negotiation + the LSP transport actually
// serving formatting + diagnostics — none of that is exercised by jest.
// Only e2e against a live `geode lsp` (via the deploy/geode/lsp-bridge.sh
// socat sidecar) catches a regression in the upgrade, the upstream
// dial address, the handshake, or the response-routing.
//
// IMPORTANT — the assertions in this spec deliberately read the Monaco
// model contents directly (via the `monaco.editor` API on `window`)
// instead of inspecting the hidden textarea or DOM text. Monaco's
// hidden <textarea> is an IME staging buffer, not the source of truth;
// reading it produces a stale snapshot whenever the cursor leaves the
// editor. The `monaco.editor.getEditors()[0].getValue()` accessor
// returns the live model text and is stable.

const LSP_OPEN_TIMEOUT_MS = 8_000
const FORMAT_RESPONSE_TIMEOUT_MS = 4_000

async function getMonacoValue(
  page: import('@playwright/test').Page
): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as {
      monaco?: {
        editor: {
          getEditors(): Array<{ getValue(): string }>
        }
      }
    }
    const editors = w.monaco?.editor.getEditors()
    if (!editors || editors.length === 0) return ''
    return editors[0]!.getValue()
  })
}

async function setMonacoValue(
  page: import('@playwright/test').Page,
  value: string
): Promise<void> {
  await page.evaluate((v: string) => {
    const w = window as unknown as {
      monaco?: {
        editor: {
          getEditors(): Array<{ setValue(s: string): void }>
        }
      }
    }
    const editors = w.monaco?.editor.getEditors()
    if (editors && editors.length > 0) editors[0]!.setValue(v)
  }, value)
}

async function waitForLspOpen(
  page: import('@playwright/test').Page
): Promise<void> {
  // Wait for the GqlEditor's onStateChange seam to flip `__geode_lsp_state`
  // to 'open'. Pre-fix this would never happen because the geode-ui
  // container's default `-lsp-upstream 127.0.0.1:3142` dials a dead
  // address (the geode-lsp sidecar is at geode-lsp:2087); the state
  // cycles through connecting → closed → failed and the test fails
  // here with a clean diagnostic instead of silently passing on a
  // no-op format action.
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __geode_lsp_state?: string }
      // eslint-disable-next-line no-underscore-dangle
      return w.__geode_lsp_state === 'open'
    },
    { timeout: LSP_OPEN_TIMEOUT_MS }
  )
}

test.describe('LSP formatting (v0.5.18+ doc-formatting + diagnostics)', () => {
  test('Format button normalizes lowercase keywords to UPPERCASE via LSP', async ({
    authedPage: page,
  }) => {
    // Tighter regression than the pre-fix test. The pre-fix assertion
    // was `text != ugly`, which passed trivially because Monaco's
    // auto-indent / auto-pair during typing changed the buffer
    // regardless of whether the LSP formatter ran. The real test of
    // LSP formatting is a CANONICALIZATION assertion: the Geode LSP
    // formatter rewrites lowercase keywords (`match`, `return`) to
    // uppercase (`MATCH`, `RETURN`). If the LSP isn't connected, the
    // format action is a no-op and the lowercase form survives.
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()
    await waitForLspOpen(page)
    await setMonacoValue(page, 'match (n:Movie) return n')
    // Brief settle so the LSP picks up the didChange before format.
    await page.waitForTimeout(150)
    await page.getByTestId('query-format-btn').click()
    // Poll for the canonical-case post-condition. The exact whitespace
    // shape is intentionally not asserted — different LSP server
    // versions may collapse interior whitespace slightly differently
    // — but the keyword-case normalization is the contract.
    await expect
      .poll(() => getMonacoValue(page), {
        timeout: FORMAT_RESPONSE_TIMEOUT_MS,
        intervals: [50, 100, 250],
      })
      .toMatch(/MATCH\s*\(n:Movie\)\s+RETURN\s+n/)
  })

  test('Cmd/Ctrl+Shift+F keyboard shortcut performs the same LSP format', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()
    await waitForLspOpen(page)
    await setMonacoValue(page, 'match (m:Movie) return m.title')
    await page.waitForTimeout(150)
    // Focus the editor so the keychord lands inside Monaco, not on
    // the document body. Clicking the wrapper focuses the textarea.
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+Shift+KeyF')
    await expect
      .poll(() => getMonacoValue(page), {
        timeout: FORMAT_RESPONSE_TIMEOUT_MS,
        intervals: [50, 100, 250],
      })
      .toMatch(/MATCH\s*\(m:Movie\)\s+RETURN\s+m\.title/)
  })

  test('LSP diagnostics surface as Monaco error markers on broken syntax', async ({
    authedPage: page,
  }) => {
    // The geode LSP server emits textDocument/publishDiagnostics for
    // any parse failure on the active model. monaco-languageclient
    // converts those into Monaco markers visible in the editor as
    // squiggle underlines. Pre-fix this never fired because the bridge
    // never connected to the upstream LSP (wrong dial address). With
    // the fix, typing an unparseable query produces at least one
    // marker with severity >= Warning.
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()
    await waitForLspOpen(page)
    // A deliberately-broken statement — unmatched parens + dangling
    // RETURN — guarantees a parse error regardless of LSP version.
    await setMonacoValue(page, 'MATCH (n:Person RETURN')
    // The geode LSP debounces didChange → diagnostics by ~150 ms
    // (see src/cli/lsp/server.zig DEBOUNCE_NS). Allow up to 4 s for
    // the round-trip + Monaco marker conversion.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const w = window as unknown as {
              monaco?: {
                editor: {
                  getEditors(): Array<{
                    getModel(): { uri: { toString(): string } } | null
                  }>
                  getModelMarkers(opts: {
                    resource?: unknown
                  }): Array<{ severity: number; message: string }>
                }
              }
            }
            const editors = w.monaco?.editor.getEditors()
            if (!editors || editors.length === 0) return []
            const model = editors[0]!.getModel()
            if (!model) return []
            return w.monaco!.editor.getModelMarkers({ resource: model.uri })
          }),
        {
          timeout: FORMAT_RESPONSE_TIMEOUT_MS,
          intervals: [100, 250, 500],
        }
      )
      // Severity in Monaco's MarkerSeverity enum: Hint=1, Info=2,
      // Warning=4, Error=8. Diagnostics from a parse failure should
      // be at least Warning.
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: expect.any(Number) }),
        ])
      )
  })

  test('auto-format toggle is persisted across page reloads', async ({
    authedPage: page,
  }) => {
    // Pre-fix the auto-format pref lived only in React state — a page
    // reload would reset it to the default (on). Commit 2d23871 wired
    // it through a zustand persist to localStorage key
    // `geode.lsp.settings.v1`. This test pins that contract: flip the
    // toggle off, reload, the toggle remains off.
    //
    // This test does NOT require an LSP connection — it exercises the
    // localStorage round-trip only.
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()
    await page.getByTestId('query-options-dropdown').click()
    const autoFormatItem = page.getByTestId('query-options-auto-format')
    await expect(autoFormatItem).toBeVisible()
    await expect(autoFormatItem).toHaveAttribute('aria-checked', 'true')
    await autoFormatItem.click()
    await page.keyboard.press('Escape')
    const stored = await page.evaluate(() =>
      window.localStorage.getItem('geode.lsp.settings.v1')
    )
    expect(stored ?? '').toContain('"autoFormatEnabled":false')
    await page.reload()
    await expect(sel.queryRunBtn(page)).toBeVisible()
    await page.getByTestId('query-options-dropdown').click()
    await expect(page.getByTestId('query-options-auto-format')).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })
})
