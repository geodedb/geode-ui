#!/usr/bin/env node
//
// check-contrast.mjs
//
// Validates that the foreground/background pairs in the geode-ui theme
// meet WCAG AA contrast (4.5:1 for body text, 3.0:1 for large text and
// non-text UI). Run via:
//
//   node scripts/check-contrast.mjs
//   pnpm lint:contrast
//
// Exits 0 on pass, 1 on fail.
//
// The theme is small enough that we mirror its leaf values inline here
// rather than spinning up tsx/ts-node to import the .ts modules. Keep
// these in sync with src/theme/light.ts and src/theme/dark.ts; if the
// values drift, the contrast script may pass while the runtime UI
// still has a regression. The CI pipeline runs both this script and
// `tsc --noEmit` so a stale color here is caught quickly.

const themes = {
  light: {
    'colors.primary': '#601ca0',
    'bg.canvas': '#f7f2ff',
    'bg.surface': '#ffffff',
    'bg.subtle': '#f3ecff',
    'text.primary': '#2a1f3a',
    'text.secondary': '#7a7285',
    'text.muted': '#96929b',
    'text.onPrimary': '#ffffff',
    'text.danger': '#b91c1c',
    'text.success': '#047857',
  },
  dark: {
    'colors.primary': '#b17bf6',
    'bg.canvas': '#1c0f2e',
    'bg.surface': '#2a1f3a',
    'bg.subtle': '#241634',
    'text.primary': '#f5efff',
    'text.secondary': '#cca8fb',
    'text.muted': '#96929b',
    'text.onPrimary': '#1c0f2e',
    'text.danger': '#fca5a5',
    'text.success': '#6ee7b7',
  },
}

function srgbToLinear(c) {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex) {
  const m = hex
    .replace('#', '')
    .match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) throw new Error(`Cannot parse hex: ${hex}`)
  const [, r, g, b] = m
  const R = srgbToLinear(parseInt(r, 16))
  const G = srgbToLinear(parseInt(g, 16))
  const B = srgbToLinear(parseInt(b, 16))
  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}

function contrastRatio(fg, bg) {
  const a = relativeLuminance(fg)
  const b = relativeLuminance(bg)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

const PAIRS = [
  { name: 'body / canvas', fg: 'text.primary', bg: 'bg.canvas', threshold: 4.5 },
  {
    name: 'body / surface',
    fg: 'text.primary',
    bg: 'bg.surface',
    threshold: 4.5,
  },
  {
    name: 'secondary / surface',
    fg: 'text.secondary',
    bg: 'bg.surface',
    threshold: 4.5,
  },
  {
    name: 'muted / surface',
    fg: 'text.muted',
    bg: 'bg.surface',
    threshold: 3.0,
  },
  {
    name: 'on-primary / primary',
    fg: 'text.onPrimary',
    bg: 'colors.primary',
    threshold: 4.5,
  },
  {
    name: 'danger text / surface',
    fg: 'text.danger',
    bg: 'bg.surface',
    threshold: 4.5,
  },
  {
    name: 'success text / surface',
    fg: 'text.success',
    bg: 'bg.surface',
    threshold: 4.5,
  },
]

const failures = []

for (const variant of ['light', 'dark']) {
  const theme = themes[variant]
  for (const p of PAIRS) {
    const fg = theme[p.fg]
    const bg = theme[p.bg]
    const ratio = contrastRatio(fg, bg)
    const pass = ratio >= p.threshold
    const tag = pass ? '✓' : '✗'
    const line = `${tag} ${variant.padEnd(5)}  ${p.name.padEnd(24)} ${ratio
      .toFixed(2)
      .padStart(5)}:1  need ${p.threshold}:1   ${p.fg}=${fg} on ${p.bg}=${bg}`
    console.log(line)
    if (!pass) failures.push(line)
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} contrast pair(s) fail WCAG AA.`)
  process.exit(1)
}
console.log('\nAll contrast pairs meet WCAG AA.')
process.exit(0)
