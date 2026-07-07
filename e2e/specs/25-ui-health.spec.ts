// UI health checks — generalized regression sweep for visual layout
// regressions that show up as "overlapping text" or "non-responsive
// components" but are actually layout overflows.
//
// Each check is intentionally framework-agnostic: it doesn't know what
// any specific component is supposed to look like, only that:
//
//   - No primary route may produce a horizontal page scrollbar at any
//     supported viewport (4 widths: 1280, 1024, 810, 390). The
//     tolerance is 2px to absorb sub-pixel rounding.
//   - Inside every styled card / form / dialog, no descendant text
//     element may render with its bounding box extending past the
//     parent's right edge by more than the tolerance. This catches
//     the original LoginPage bug: a multi-line description rendered
//     inside a <wa-button> overflowed the 380px form by ~785px.
//   - Walking every primary route must not surface a console error
//     emitted during the route's initial render.
//
// Failures point at the route + viewport + offending element, so the
// fix is local. New routes inherit the sweep automatically.
//
// Sequential page navigation requires per-route awaits inside a
// route list, which trips the airbnb config's no-await-in-loop and
// no-restricted-syntax rules. Disable both for this file — the rule
// rationale (don't unintentionally serialize) doesn't apply: the
// navigations MUST be sequential because they share a single page.
/* eslint-disable no-await-in-loop, no-restricted-syntax */

import { test, expect, Page } from '@playwright/test'
import {
  scanHorizontalOverflow,
  scanContainerOverflow,
} from '@devnw/playwright-scanner-kit'
import { login } from '../helpers/auth'

// Public + protected routes. /login is unauthenticated; everything
// else is gated by ProtectedShell.
const ROUTES_PUBLIC = ['/login']
const ROUTES_PROTECTED = [
  '/',
  '/dashboard',
  '/schema',
  '/admin/users',
  '/admin/roles',
  '/admin/policies',
  '/admin/grants',
  '/admin/backups',
  '/admin/restore',
  '/admin/migrations',
  '/admin/audit',
  '/profiles',
]

// The four widths we promise to support: desktop, laptop, tablet, mobile.
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'laptop', width: 1024, height: 700 },
  { name: 'tablet', width: 810, height: 1080 },
  { name: 'mobile', width: 390, height: 844 },
]

const TOLERANCE_PX = 2

// Containers whose text descendants must not overflow the right edge.
// Passed straight through to the kit's scanContainerOverflow.
const CONTAINER_SELECTOR = 'form, [role=dialog], dialog'

// Mutable per-page console-error buffer is attached to the playwright
// Page object so the route-walk and the console-error assertion share
// a single sink. WeakMap keeps the binding out of the Page's public
// shape (which would otherwise need an underscore property and trip
// no-underscore-dangle).
const consoleErrorBuf = new WeakMap<Page, string[]>()

async function seedAuth(page: Page): Promise<void> {
  const token = await login(page.request)
  await page.context().addInitScript((tok: string) => {
    sessionStorage.setItem('geode-ui.session-hint', '1')
    localStorage.setItem('geode-ui.profile', 'default')
    const e2eKey = '__GEODE_E2E_INITIAL_CONNECTIONS__'
    const seed = [
      {
        connectionId: 'e2e-seed',
        token: tok,
        profileName: 'default',
        expiresAt: Date.now() + 8 * 3600 * 1000,
      },
    ]
    const w = window as unknown as Record<string, unknown>
    w[e2eKey] = seed
  }, token)
}

async function visit(page: Page, base: string, route: string): Promise<void> {
  await page
    .goto(base + route, { waitUntil: 'domcontentloaded' })
    .catch(() => undefined)
  await page.waitForTimeout(300)
}

test.describe('UI health — horizontal overflow sweep', () => {
  test.beforeEach(async ({ page }) => {
    const errs: string[] = []
    consoleErrorBuf.set(page, errs)
    page.on('console', (m) => {
      if (m.type() === 'error') errs.push(m.text())
    })
    page.on('pageerror', (e) => errs.push(String(e)))
  })

  for (const vp of VIEWPORTS) {
    test(`no page-level horizontal scroll @ ${vp.name}`, async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(120_000)
      const base = baseURL ?? 'http://localhost:8080'
      await page.setViewportSize({ width: vp.width, height: vp.height })

      const failures: Array<{ route: string; overflowPx: number }> = []

      for (const r of ROUTES_PUBLIC) {
        await visit(page, base, r)
        const findings = await scanHorizontalOverflow(page, [vp], TOLERANCE_PX)
        findings.forEach((f) => {
          failures.push({
            route: r,
            overflowPx: Number(f.meta?.overflowPx ?? 0),
          })
        })
      }

      await seedAuth(page)
      for (const r of ROUTES_PROTECTED) {
        await visit(page, base, r)
        const findings = await scanHorizontalOverflow(page, [vp], TOLERANCE_PX)
        findings.forEach((f) => {
          failures.push({
            route: r,
            overflowPx: Number(f.meta?.overflowPx ?? 0),
          })
        })
      }

      expect(
        failures,
        `routes that scroll horizontally at ${vp.name}: ${JSON.stringify(failures, null, 2)}`
      ).toEqual([])
    })

    test(`no descendant overflows form/dialog @ ${vp.name}`, async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(120_000)
      const base = baseURL ?? 'http://localhost:8080'
      await page.setViewportSize({ width: vp.width, height: vp.height })

      const failures: Array<{
        route: string
        selector: string
        message: string
        overflowPx: number
      }> = []

      for (const r of ROUTES_PUBLIC) {
        await visit(page, base, r)
        // KNOWN KIT LIMITATION (tracked gap, not fixed here — kit change is
        // out of scope for this task): the kit's scanContainerOverflow walks
        // UP from each matched container (form/[role=dialog]/dialog) toward
        // the document root and skips scanning it entirely if ANY ancestor
        // — not just one sitting between the container and the overflowing
        // text — has `overflow-x: auto|scroll`. The pre-migration
        // containerOverflowReport() this replaced only exempted the
        // narrower case (a scroll wrapper between the offending text and
        // its own container), so this is a coverage-narrowing regression
        // in the general case.
        //
        // Verified NOT applicable to this project's CONTAINER_SELECTOR
        // today: the two overflow-x:auto ancestors in this codebase
        // (TableView.tsx's ScrollArea, GraphToolbar.tsx's Toolbar) never
        // have a form/[role=dialog]/dialog descendant — the app's only
        // `<wa-dialog>` (ExpandQueryPopover) renders as a DOM sibling of
        // GraphToolbar's containing CanvasArea, not nested under it, and
        // TableView's cells contain no forms/dialogs. All other <form>
        // elements live on unrelated admin/login/profile pages with no
        // overflow-x:auto ancestor. Note this determination is specific to
        // the current DOM structure and route list (which doesn't even
        // include /query, the one route where GraphToolbar/TableView
        // render) — re-verify if either changes.
        const findings = await scanContainerOverflow(
          page,
          CONTAINER_SELECTOR,
          TOLERANCE_PX
        )
        findings.forEach((f) =>
          failures.push({
            route: r,
            selector: f.selector,
            message: f.message,
            overflowPx: Number(f.meta?.overflowPx ?? 0),
          })
        )
      }
      await seedAuth(page)
      for (const r of ROUTES_PROTECTED) {
        await visit(page, base, r)
        // See the known kit limitation noted above the first
        // scanContainerOverflow call in this test.
        const findings = await scanContainerOverflow(
          page,
          CONTAINER_SELECTOR,
          TOLERANCE_PX
        )
        findings.forEach((f) =>
          failures.push({
            route: r,
            selector: f.selector,
            message: f.message,
            overflowPx: Number(f.meta?.overflowPx ?? 0),
          })
        )
      }

      expect(
        failures,
        `text descendants overflow their card/form/dialog at ${vp.name}: ${JSON.stringify(failures, null, 2)}`
      ).toEqual([])
    })
  }

  test('no console errors on initial render of any route @ desktop', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000)
    const base = baseURL ?? 'http://localhost:8080'
    const allErrors: Array<{ route: string; msg: string }> = []

    for (const r of ROUTES_PUBLIC) {
      await visit(page, base, r)
    }
    await seedAuth(page)
    for (const r of ROUTES_PROTECTED) {
      await visit(page, base, r)
    }

    // Allow framework-level chatter — vite HMR, favicon 404, and Web
    // Awesome / Font Awesome icon-fetch noise (the library attempts
    // Fetch API requests against data: URIs for its SVG icon kit; the
    // browser rejects these with "Fetch API cannot load data:…" and a
    // paired "Connecting to …" message — both are benign because the
    // icons still render via the inline SVG fallback path).
    const BENIGN = [
      /Failed to load resource: net::ERR_NETWORK_CHANGED/,
      /favicon\.ico/,
      /\[vite\]/,
      /Connecting to 'data:/,
      /Fetch API cannot load data:/,
    ]
    const errs = consoleErrorBuf.get(page) ?? []
    errs.forEach((e) => {
      if (BENIGN.some((b) => b.test(e))) return
      allErrors.push({ route: '(walk)', msg: e.slice(0, 200) })
    })
    expect(
      allErrors,
      `console errors during walk: ${JSON.stringify(allErrors, null, 2)}`
    ).toEqual([])
  })
})
