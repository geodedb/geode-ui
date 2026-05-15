// Generic runtime contrast sweep. Forces a theme variant via the
// localStorage key the SPA reads at mount (`geode.ui.theme`), walks
// every primary route, and asserts WCAG AA contrast for every visible
// text-bearing element.
//
// Why runtime instead of (or in addition to) the static
// scripts/check-contrast.mjs sweep: the static check validates a
// fixed set of TOKEN pairs (text.primary on bg.surface, etc.). It
// can't catch a component that hardcodes a light-mode color
// (`color: #2a1f3a`) and renders it on a dark surface — which is
// exactly the "dark text on dark background" class of bug an
// operator reports after switching theme. This spec measures what
// the user actually sees: computed-style color + the effective
// background found by walking up the box tree (skipping `transparent`
// ancestors).
//
// Output: when failing, the assertion error names the route, the
// element (tag + testid + a 40-char text slice + computed color +
// effective background), and the ratio. That's enough to pin the
// offending component without a manual screenshot diff.

/* eslint-disable no-await-in-loop, no-restricted-syntax */

import { test, expect, Page } from '@playwright/test'
import { login } from '../helpers/auth'

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

const THEMES = ['light', 'dark'] as const

// WCAG AA: 4.5:1 for body text (< 18pt regular OR < 14pt bold), 3:1
// for large text. Treat the threshold as a function of computed font
// size and weight per spec; in practice nearly all text in the UI is
// body-class, so 4.5 is the dominant bound.
const RATIO_NORMAL = 4.5
const RATIO_LARGE = 3.0

async function seedAuth(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const token = await login(page.request)
  await page.context().addInitScript(
    ({ tok, themeChoice }: { tok: string; themeChoice: string }) => {
      sessionStorage.setItem('geode-ui.session-hint', '1')
      localStorage.setItem('geode-ui.profile', 'default')
      // Force the SPA's theme variant before mount. ThemeProvider reads
      // this exact key (src/theme/ThemeContext.tsx:8). Without seeding
      // here, the provider defaults to 'system' and the harness's
      // matchMedia might or might not agree with what we want to test.
      localStorage.setItem('geode.ui.theme', themeChoice)
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
    },
    { tok: token, themeChoice: theme }
  )
}

// Shape returned by inPageContrastReport — extracted so the function
// signature stays on one line and eslint's indent rule doesn't fight
// prettier over where to put the closing `} {`.
type ContrastFailure = {
  tag: string
  testid: string
  text: string
  fg: string
  bg: string
  ratio: number
  threshold: number
  fontSizePx: number
  fontWeight: string
}
type ContrastReport = { route: string; failures: ContrastFailure[] }

// Run inside the page: parse CSS color tokens (rgb/rgba/hex/named)
// into [r,g,b,a], walk up the box tree to find the effective opaque
// background, compute WCAG relative luminance, return the contrast
// ratio + the resolved fg/bg for diagnostic.
function inPageContrastReport(): ContrastReport {
  type RGBA = [number, number, number, number]
  const RATIO_NORMAL_LOCAL = 4.5
  const RATIO_LARGE_LOCAL = 3.0
  const route = window.location.pathname

  const parseColor = (s: string): RGBA | null => {
    if (!s) return null
    if (s === 'transparent') return [0, 0, 0, 0]
    const rgb = s.match(
      /^rgba?\(\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)(?:[\s,/]+(-?\d+(?:\.\d+)?%?))?\s*\)$/i
    )
    if (rgb) {
      const r = parseFloat(rgb[1] ?? '0')
      const g = parseFloat(rgb[2] ?? '0')
      const b = parseFloat(rgb[3] ?? '0')
      let a = 1
      if (rgb[4] != null) {
        a = rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4])
      }
      return [r, g, b, a]
    }
    const hex = s.match(/^#([0-9a-f]{3,8})$/i)
    if (hex && hex[1]) {
      const h = hex[1]
      if (h.length === 3) {
        return [
          parseInt(h[0]! + h[0]!, 16),
          parseInt(h[1]! + h[1]!, 16),
          parseInt(h[2]! + h[2]!, 16),
          1,
        ]
      }
      if (h.length === 6) {
        return [
          parseInt(h.slice(0, 2), 16),
          parseInt(h.slice(2, 4), 16),
          parseInt(h.slice(4, 6), 16),
          1,
        ]
      }
      if (h.length === 8) {
        return [
          parseInt(h.slice(0, 2), 16),
          parseInt(h.slice(2, 4), 16),
          parseInt(h.slice(4, 6), 16),
          parseInt(h.slice(6, 8), 16) / 255,
        ]
      }
    }
    return null
  }

  // Alpha-blend fg over bg (Porter-Duff "over").
  const composite = (fg: RGBA, bg: RGBA): RGBA => {
    const a = fg[3] + bg[3] * (1 - fg[3])
    if (a === 0) return [0, 0, 0, 0]
    return [
      (fg[0] * fg[3] + bg[0] * bg[3] * (1 - fg[3])) / a,
      (fg[1] * fg[3] + bg[1] * bg[3] * (1 - fg[3])) / a,
      (fg[2] * fg[3] + bg[2] * bg[3] * (1 - fg[3])) / a,
      a,
    ]
  }

  // Walk ancestors, collecting partially-transparent backgrounds,
  // until we hit an opaque one (or html's default white).
  const effectiveBackground = (el: Element): RGBA => {
    let node: Element | null = el
    const stack: RGBA[] = []
    while (node) {
      const cs = window.getComputedStyle(node as HTMLElement)
      const c = parseColor(cs.backgroundColor)
      if (c && c[3] > 0) {
        stack.unshift(c)
        if (c[3] >= 1) break
      }
      node = node.parentElement
    }
    // Default page background — most browsers paint white if the page
    // root doesn't set one. Use html's computed value if present.
    const htmlBg = parseColor(
      window.getComputedStyle(document.documentElement).backgroundColor
    )
    let bg: RGBA =
      htmlBg && htmlBg[3] >= 1 ? htmlBg : ([255, 255, 255, 1] as RGBA)
    for (const layer of stack) bg = composite(layer, bg)
    return bg
  }

  const srgbToLinear = (c: number): number => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const luminance = (rgba: RGBA): number =>
    0.2126 * srgbToLinear(rgba[0]) +
    0.7152 * srgbToLinear(rgba[1]) +
    0.0722 * srgbToLinear(rgba[2])
  const contrast = (fg: RGBA, bg: RGBA): number => {
    const L1 = luminance(fg)
    const L2 = luminance(bg)
    const lighter = Math.max(L1, L2)
    const darker = Math.min(L1, L2)
    return (lighter + 0.05) / (darker + 0.05)
  }

  // Hides elements that aren't actually visible: 0-size, display:none,
  // visibility:hidden, opacity:0, or no rendered text.
  const isVisible = (el: Element): boolean => {
    const cs = window.getComputedStyle(el as HTMLElement)
    if (
      cs.display === 'none' ||
      cs.visibility === 'hidden' ||
      parseFloat(cs.opacity) === 0
    ) {
      return false
    }
    const r = (el as HTMLElement).getBoundingClientRect()
    if (r.width < 4 || r.height < 4) return false
    if (r.bottom < 0 || r.top > window.innerHeight) return false
    if (r.right < 0 || r.left > window.innerWidth) return false
    return true
  }

  // Returns the immediate text the element renders (excluding text
  // contributed by descendants). Many container elements have an
  // accumulated innerText that includes children — we only care about
  // elements whose OWN text rendering is at risk.
  const ownText = (el: Element): string => {
    let t = ''
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) {
        t += n.textContent ?? ''
      }
    }
    return t.trim()
  }

  const failures: ContrastFailure[] = []

  // Skip elements whose actual visible background is painted from a
  // shadow-DOM ancestor (custom element). `wa-button`, `wa-badge`,
  // wa-card etc. all render their own bg inside their shadow root —
  // our light-DOM ancestor walk only sees the page/form bg behind
  // the component, which gives a misleading effective bg and a
  // false-positive contrast report. We can't safely compute the
  // actual bg from outside the shadow root, so for those subtrees
  // we trust WA's own contrast contract (which our bridge enforces
  // via the brand/success/etc. fill+on token pairs).
  const inShadowRenderingHost = (el: Element): boolean => {
    let p: Element | null = el.parentElement
    while (p) {
      const name = p.tagName.toLowerCase()
      if (
        name === 'wa-button' ||
        name === 'wa-badge' ||
        name === 'wa-tab' ||
        name === 'wa-tag' ||
        name === 'wa-callout'
      ) {
        return true
      }
      p = p.parentElement
    }
    return false
  }

  // Walk every element in the document. Cheap enough at our DOM sizes
  // and avoids missing anything via overly-targeted selectors.
  const all = document.querySelectorAll('*')
  all.forEach((el) => {
    const text = ownText(el)
    if (!text) return
    // Drop punctuation-only or single-glyph icon text — the
    // contrast story for an `×` close button is governed by its
    // border + adjacent-element semantics, not raw glyph contrast.
    if (text.length < 2 && !/[A-Za-z0-9]/.test(text)) return
    if (!isVisible(el)) return
    if (inShadowRenderingHost(el)) return
    const cs = window.getComputedStyle(el as HTMLElement)
    const fg = parseColor(cs.color)
    if (!fg) return
    // Skip if the foreground itself is fully transparent — that
    // means the text isn't visible to the user regardless of bg.
    if (fg[3] === 0) return
    const bg = effectiveBackground(el)
    // Compositing fg-on-bg respects alpha — text usually has alpha=1
    // but in case it doesn't, compose first.
    const composedFg = composite(fg, bg)
    const ratio = contrast(composedFg, bg)
    const fontSizePx = parseFloat(cs.fontSize) || 16
    // WCAG 'large text' = ≥ 18pt regular OR ≥ 14pt bold (≈24px or 19px).
    const isBold = parseInt(cs.fontWeight, 10) >= 700
    const isLarge = fontSizePx >= 24 || (isBold && fontSizePx >= 19)
    const threshold = isLarge ? RATIO_LARGE_LOCAL : RATIO_NORMAL_LOCAL
    if (ratio + 1e-6 < threshold) {
      failures.push({
        tag: el.tagName.toLowerCase(),
        testid: (el as HTMLElement).getAttribute('data-testid') ?? '',
        text: text.slice(0, 60).replace(/\s+/g, ' '),
        fg: `rgba(${composedFg.map((n, i) => (i < 3 ? Math.round(n) : n.toFixed(2))).join(',')})`,
        bg: `rgba(${bg.map((n, i) => (i < 3 ? Math.round(n) : n.toFixed(2))).join(',')})`,
        ratio: Number(ratio.toFixed(2)),
        threshold,
        fontSizePx: Number(fontSizePx.toFixed(1)),
        fontWeight: cs.fontWeight,
      })
    }
  })

  return { route, failures }
}

async function visit(page: Page, base: string, route: string): Promise<void> {
  await page
    .goto(base + route, { waitUntil: 'domcontentloaded' })
    .catch(() => undefined)
  await page.waitForTimeout(300)
}

test.describe('contrast — WCAG AA across themes & routes', () => {
  for (const theme of THEMES) {
    test(`every visible text element meets WCAG AA @ ${theme}`, async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(180_000)
      const base = baseURL ?? 'http://localhost:8080'

      // Public routes first — login page renders without auth.
      await page.context().clearCookies()
      await page.addInitScript((themeChoice: string) => {
        localStorage.setItem('geode.ui.theme', themeChoice)
      }, theme)

      type RouteFailures = {
        route: string
        theme: string
        failures: ReturnType<typeof inPageContrastReport>['failures']
      }
      const allFailures: RouteFailures[] = []

      for (const r of ROUTES_PUBLIC) {
        await visit(page, base, r)
        // Confirm the SPA actually adopted the theme (avoids accidental
        // false-pass against the wrong palette).
        const resolved = await page.evaluate(() =>
          document.documentElement.getAttribute('data-theme')
        )
        expect(resolved, `theme attribute should be "${theme}" on ${r}`).toBe(
          theme
        )
        const report = await page.evaluate(inPageContrastReport)
        if (report.failures.length > 0) {
          allFailures.push({ route: r, theme, failures: report.failures })
        }
      }

      // Now seed auth and walk protected routes.
      await seedAuth(page, theme)
      for (const r of ROUTES_PROTECTED) {
        await visit(page, base, r)
        const resolved = await page.evaluate(() =>
          document.documentElement.getAttribute('data-theme')
        )
        expect(resolved, `theme attribute should be "${theme}" on ${r}`).toBe(
          theme
        )
        const report = await page.evaluate(inPageContrastReport)
        if (report.failures.length > 0) {
          allFailures.push({ route: r, theme, failures: report.failures })
        }
      }

      // Collapse to a stable, readable failure message: route, the
      // worst offender per route (lowest ratio first), and the
      // computed colors so the fix target is obvious.
      const summary = allFailures.flatMap((rf) =>
        rf.failures.map((f) => ({
          route: rf.route,
          theme: rf.theme,
          tag: f.tag,
          testid: f.testid,
          text: f.text,
          fg: f.fg,
          bg: f.bg,
          ratio: f.ratio,
          threshold: f.threshold,
        }))
      )
      summary.sort((a, b) => a.ratio - b.ratio)
      // Write the FULL summary to .scratch/triage for diagnostics —
      // the expect() message truncates so the file is the load-bearing
      // artifact when iterating fixes. Path is gitignored.
      if (summary.length > 0) {
        const fs = await import('node:fs')
        const path = await import('node:path')
        const dir = path.resolve(__dirname, '../../.scratch/triage')
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(
          path.join(dir, `contrast-${theme}.json`),
          JSON.stringify(summary, null, 2)
        )
      }
      expect(
        summary,
        `${summary.length} contrast violations @ ${theme} (full list at .scratch/triage/contrast-${theme}.json):\n${JSON.stringify(summary.slice(0, 30), null, 2)}`
      ).toEqual([])
      // RATIO_NORMAL/RATIO_LARGE are referenced for documentation
      // purposes; the actual thresholds live inside the in-page
      // evaluator so they can be applied per-element.
      expect(RATIO_NORMAL).toBeGreaterThan(RATIO_LARGE)
    })
  }
})
