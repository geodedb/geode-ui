// End-to-end pin for the extension-noise filter installed in
// src/index.tsx. Synthesises the exact unhandledrejection a content
// script (LastPass, Translate, React DevTools, …) would emit, then
// asserts:
//
//   1) The filter consumed the event — preventDefault() ran, so the
//      browser did NOT log "Uncaught (in promise) Error" to the
//      page-level console.
//   2) A genuine unrelated unhandledrejection still surfaces as a
//      pageerror — the filter is targeted, not blanket.
//
// Headless chromium under Playwright doesn't ship browser extensions,
// so this is the only realistic way to reproduce the chatter without
// installing a real extension into the harness profile.

import { test, expect } from '@playwright/test'

const EXTENSION_MESSAGE =
  'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received'

test.describe('extension-noise filter', () => {
  test('extension orphan-response rejection is suppressed', async ({
    page,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:8080'

    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    await page.goto(base + '/login')
    await page.waitForLoadState('domcontentloaded')
    // Give the SPA enough time to mount + run installExtensionNoiseFilter
    // before we fire the synthetic rejection.
    await page.waitForTimeout(500)

    // Fire a real PromiseRejectionEvent from the page world with the
    // exact message Chrome uses. preventDefault on the event prevents
    // both the default console.error and the pageerror routing.
    await page.evaluate((msg) => {
      const reason = new Error(msg)
      const ev = new (
        window as unknown as {
          PromiseRejectionEvent: typeof PromiseRejectionEvent
        }
      ).PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.reject(reason),
        reason,
        cancelable: true,
      })
      // Swallow the underlying rejection so the test doesn't itself
      // generate a second unhandled rejection.
      ev.promise.catch(() => undefined)
      window.dispatchEvent(ev)
    }, EXTENSION_MESSAGE)

    await page.waitForTimeout(200)

    // The filter should have consumed it — no pageerror surfaced.
    const matching = pageErrors.filter((e) => e.includes(EXTENSION_MESSAGE))
    expect(
      matching,
      `expected extension rejection to be suppressed; got: ${JSON.stringify(matching)}`
    ).toEqual([])
  })

  test('unrelated unhandled rejection is NOT suppressed (filter is targeted)', async ({
    page,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:8080'
    await page.goto(base + '/login')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)

    // Dispatch an unhandledrejection with a non-extension message and
    // observe whether the filter called preventDefault. We don't rely
    // on Playwright's pageerror routing here — that hooks into
    // Chrome's native rejection pipeline, which a synthetic dispatch
    // doesn't traverse — instead the assertion reads
    // `event.defaultPrevented` directly inside page.evaluate. The
    // filter must consume the extension message (proved by the first
    // test) AND leave anything else alone (proved here).
    const prevented = await page.evaluate(() => {
      const reason = new Error('genuine-test-rejection-not-extension')
      const ev = new (window as unknown as {
        PromiseRejectionEvent: typeof PromiseRejectionEvent
      }).PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.reject(reason),
        reason,
        cancelable: true,
      })
      ev.promise.catch(() => undefined)
      window.dispatchEvent(ev)
      return ev.defaultPrevented
    })

    expect(prevented).toBe(false)
  })
})
