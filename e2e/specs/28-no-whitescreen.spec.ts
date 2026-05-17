// Generic "no view goes blank, no chunk-load throws" sweep. Walks
// every primary route plus the explicit dev/graph-bench fanout
// (?renderer=cytoscape AND ?renderer=reagraph) and asserts:
//
//   1) The root mounted SOMETHING (innerHTML longer than a safe floor,
//      i.e. not the empty `<div id="root"></div>` skeleton). Catches
//      the operator-reported white-screen class.
//
//   2) No `pageerror` event fired during the route's settle window.
//      Catches the dispatcher-S TypeError thrown by a lazy chunk
//      whose top-level evaluation accesses an internal React shape
//      the host's React version doesn't expose. The dispatch happens
//      synchronously during chunk-load (not inside a React component
//      body), so it bypasses Suspense and lands on `window.onerror`.
//
// We deliberately do NOT enumerate specific chunk hashes — the spec
// is generic across routes and resilient to future bundle splits.

/* eslint-disable no-await-in-loop, no-restricted-syntax */

import { test, expect, Page } from '@playwright/test'
import { login } from '../helpers/auth'

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
  // /dev/graph-bench has two renderer modes; both must mount cleanly.
  '/dev/graph-bench?n=200&renderer=cytoscape',
  '/dev/graph-bench?n=200&renderer=reagraph',
]

// A blank #root is the empty container the index.html ships with
// (`<div id="root"></div>`). Anything React painted at all will
// raise innerHTML well past 100 chars; calibrated against the
// smallest non-blank route (the login form, ~1.6KB of HTML).
const MIN_ROOT_HTML_LEN = 100

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

// Filter the page-error / console-error stream for ACTIONABLE errors
// (TypeError, ReferenceError, ChunkLoadError, syntax/runtime throws
// from app code). Skip benign noise that's outside our control
// (DevTools install hook, favicon 404, vite HMR chatter that doesn't
// run in production but might in dev).
function isActionableError(msg: string): boolean {
  if (/installHook\.js/.test(msg)) return false
  if (/favicon\.ico/.test(msg)) return false
  if (/Failed to load resource: net::ERR_NETWORK_CHANGED/.test(msg)) {
    return false
  }
  return /TypeError|ReferenceError|ChunkLoadError|Uncaught|Error:/.test(msg)
}

test.describe('no view goes blank and no chunk-load throws', () => {
  test('every route mounts and emits no actionable error', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(240_000)
    const base = baseURL ?? 'http://localhost:8080'

    const errors: Array<{ route: string; kind: string; text: string }> = []
    page.on('console', (m) => {
      if (m.type() === 'error') {
        errors.push({ route: page.url(), kind: 'console', text: m.text() })
      }
    })
    page.on('pageerror', (e) => {
      errors.push({ route: page.url(), kind: 'pageerror', text: String(e) })
    })

    const blanks: Array<{ route: string; rootHTML: number }> = []

    const visit = async (route: string): Promise<void> => {
      await page
        .goto(base + route, { waitUntil: 'domcontentloaded' })
        .catch(() => undefined)
      // 1.5s is enough for lazy chunks to download + evaluate against a
      // local container — long enough that a chunk-load throw lands as
      // a pageerror before we sample, short enough that the sweep over
      // 16 routes finishes inside the test timeout.
      await page.waitForTimeout(1500)
      const rootHTML = await page.evaluate(
        () => (document.getElementById('root')?.innerHTML ?? '').length
      )
      blanks.push({ route, rootHTML })
    }

    for (const r of ROUTES_PUBLIC) {
      await visit(r)
    }
    await seedAuth(page)
    for (const r of ROUTES_PROTECTED) {
      await visit(r)
    }

    const blank = blanks.filter((b) => b.rootHTML < MIN_ROOT_HTML_LEN)
    expect(
      blank,
      `routes whose #root never mounted real content: ${JSON.stringify(blank, null, 2)}`
    ).toEqual([])

    const actionable = errors
      .filter((e) => isActionableError(e.text))
      .map((e) => ({
        route: e.route.replace(base, ''),
        kind: e.kind,
        text: e.text.slice(0, 300),
      }))
    expect(
      actionable,
      `actionable errors during route walk: ${JSON.stringify(actionable, null, 2)}`
    ).toEqual([])
  })
})
