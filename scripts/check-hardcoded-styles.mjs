#!/usr/bin/env node
//
// check-hardcoded-styles.mjs
//
// Scans src/ for hardcoded color literals (hex, rgb/a, hsl/a) outside
// the theme module. Adopted from @devnw/components' guard:hardcoded-styles
// per the Phase-4 deliverable in docs/UI_AUDIT.md (THEME-02 / COMP-07).
//
// What's allowed:
//   - Anywhere under src/theme/  (the tokens themselves)
//   - The Cytoscape stylesheet (results/cytoscapeStyle.ts) which speaks
//     a Cytoscape-specific selector language and defers to its own
//     style API; theming runs through cytoscapeStyle's render pass.
//   - Test fixtures (*.test.tsx) — they construct stub data that
//     deliberately diverges from the theme.
//   - Inline svg fill="currentColor" / stroke="currentColor" attrs.
//   - Comments (lines starting with `//` after leading whitespace).
//
// What's flagged:
//   - Hex literals (#fff, #0099ff, #00aabb22) anywhere else.
//   - rgb(), rgba(), hsl(), hsla() function calls.
//   - The keyword colors `white` / `black` used as CSS values (lower
//     bar — sometimes correct; surfacing them invites a theme-token
//     replacement instead of a one-off literal).
//
// Exit codes: 0 if clean, 1 if any violations found.
//
// Run with: node scripts/check-hardcoded-styles.mjs
// Or: pnpm lint:hardcoded-styles
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..', 'src')

const ALLOW_DIRS = [path.join(ROOT, 'theme')]
const ALLOW_FILES = [
  path.join(ROOT, 'components', 'results', 'cytoscapeStyle.ts'),
  // Self-hosted webfont CSS — declares woff2 sources, not colors.
  path.join(ROOT, 'assets', 'fonts', 'fonts.css'),
]

const HEX = /#[0-9a-fA-F]{3,8}\b/
const RGB_HSL = /\b(?:rgba?|hsla?)\s*\(/
const KEYWORD = /\b(?:white|black)\s*[;,)]/

const violations = []

async function* walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      yield* walk(full)
    } else {
      yield full
    }
  }
}

function isAllowed(filePath) {
  if (ALLOW_FILES.includes(filePath)) return true
  for (const dir of ALLOW_DIRS) {
    if (filePath.startsWith(`${dir}${path.sep}`) || filePath === dir) return true
  }
  if (filePath.endsWith('.test.tsx') || filePath.endsWith('.test.ts')) return true
  // Test utils fixtures may reference theme constants directly.
  if (filePath.startsWith(path.join(ROOT, 'test-utils') + path.sep)) return true
  return false
}

for await (const f of walk(ROOT)) {
  if (!/\.(ts|tsx|css)$/.test(f)) continue
  if (isAllowed(f)) continue

  const text = await fs.readFile(f, 'utf8')
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    // Strip comments (single-line // and /* */ on the same line).
    const code = line
      .replace(/\/\/.*$/, '')
      .replace(/\/\*.*?\*\//g, '')

    // Inline SVGs with currentColor are theme-driven, ignore.
    if (/(?:fill|stroke)=['"]currentColor['"]/.test(code)) return

    if (HEX.test(code) || RGB_HSL.test(code) || KEYWORD.test(code)) {
      // Skip lines that already speak through the theme (e.g.
      // `theme.colors.danger`).
      // The check only fires when a literal color appears outside a
      // theme accessor — line still contains an extracted hex etc.
      const m = code.match(HEX) ?? code.match(RGB_HSL) ?? code.match(KEYWORD)
      violations.push({
        file: path.relative(path.join(__dirname, '..'), f),
        line: i + 1,
        match: m?.[0] ?? '',
        snippet: line.trim(),
      })
    }
  })
}

if (violations.length === 0) {
  console.log('✓ No hardcoded styles outside src/theme/.')
  process.exit(0)
}

console.error(
  `✗ Found ${violations.length} hardcoded style literal(s) outside src/theme/:\n`
)
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.match}`)
  console.error(`    ${v.snippet}`)
}
console.error(
  '\nReplace with the relevant theme token (theme.colors.*, theme.bg.*,',
)
console.error(
  'theme.text.*, theme.border.*, theme.shadows.*) or extend the theme.'
)
process.exit(1)
