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
import { login } from '../helpers/auth'

// Public + protected routes. /login is unauthenticated; everything
// else is gated by ProtectedShell.
const ROUTES_PUBLIC = ['/login']
const ROUTES_PROTECTED = [
  '/',
  '/dashboard',
  '/workspace',
  '/schema',
  '/admin/users',
  '/admin/roles',
  '/admin/policies',
  '/admin/grants',
  '/ops/backups',
  '/ops/restore',
  '/ops/migrations',
  '/ops/audit',
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

async function pageOverflowPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const dw = document.documentElement.scrollWidth
    return Math.max(0, dw - vw)
  })
}

// Returns text-bearing elements inside any form / dialog whose right
// edge exceeds the container's right edge by more than TOLERANCE_PX.
// Skips elements that sit inside a horizontally-scrollable ancestor —
// those surfaces intentionally exceed the container width.
async function containerOverflowReport(page: Page): Promise<
  Array<{
    container: string
    element: string
    rightOverflow: number
    text: string
  }>
> {
  return page.evaluate(() => {
    const CONTAINERS = 'form, [role=dialog], dialog'
    const TEXT_SELECTORS =
      'p, h1, h2, h3, h4, span, div, strong, em, code, label'
    type Hit = {
      container: string
      element: string
      rightOverflow: number
      text: string
    }
    const out: Hit[] = []
    const containers = Array.from(document.querySelectorAll(CONTAINERS))
    containers.forEach((c) => {
      const cRect = c.getBoundingClientRect()
      if (cRect.width < 1) return
      const desc = Array.from(c.querySelectorAll(TEXT_SELECTORS))
      desc.forEach((el) => {
        const cs = window.getComputedStyle(el as HTMLElement)
        if (
          cs.display === 'none' ||
          cs.visibility === 'hidden' ||
          cs.opacity === '0'
        ) {
          return
        }
        // Skip elements with a scrollable ancestor between them and the
        // container — those surfaces opt in to overflow via scroll.
        let anc: Element | null = el.parentElement
        let scrollable = false
        while (anc && anc !== c && anc !== document.body) {
          const acs = window.getComputedStyle(anc as HTMLElement)
          if (acs.overflowX === 'auto' || acs.overflowX === 'scroll') {
            scrollable = true
            break
          }
          anc = anc.parentElement
        }
        if (scrollable) return
        const r = el.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) return
        const rightOverflow = Math.max(0, r.right - cRect.right)
        if (rightOverflow <= 2) return
        const text = ((el as HTMLElement).innerText || '')
          .slice(0, 80)
          .replace(/\s+/g, ' ')
        out.push({
          container: `${c.tagName.toLowerCase()}.${(c as HTMLElement).className.toString().slice(0, 40)}`,
          element: `${el.tagName.toLowerCase()}.${(el as HTMLElement).className.toString().slice(0, 40)}`,
          rightOverflow,
          text,
        })
      })
    })
    return out
  })
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
        const overflow = await pageOverflowPx(page)
        if (overflow > TOLERANCE_PX) {
          failures.push({ route: r, overflowPx: overflow })
        }
      }

      await seedAuth(page)
      for (const r of ROUTES_PROTECTED) {
        await visit(page, base, r)
        const overflow = await pageOverflowPx(page)
        if (overflow > TOLERANCE_PX) {
          failures.push({ route: r, overflowPx: overflow })
        }
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
        container: string
        element: string
        rightOverflow: number
        text: string
      }> = []

      for (const r of ROUTES_PUBLIC) {
        await visit(page, base, r)
        const report = await containerOverflowReport(page)
        report.forEach((f) => failures.push({ route: r, ...f }))
      }
      await seedAuth(page)
      for (const r of ROUTES_PROTECTED) {
        await visit(page, base, r)
        const report = await containerOverflowReport(page)
        report.forEach((f) => failures.push({ route: r, ...f }))
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

    // Allow framework-level chatter — vite HMR, favicon 404 etc. The
    // assertion targets app code paths, not infra noise.
    const BENIGN = [
      /Failed to load resource: net::ERR_NETWORK_CHANGED/,
      /favicon\.ico/,
      /\[vite\]/,
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
