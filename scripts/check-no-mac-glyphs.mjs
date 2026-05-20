#!/usr/bin/env node
/* eslint-disable no-console */
//
// GAP-047 ratchet — refuses any mac-specific keyboard glyph
// (⌘ / ⌥ / ⇧ / ⌃) in user-facing copy outside the single platform-
// detection seam at src/lib/platformKeyHints.ts.
//
// Pre-fix the hint strings `query.runHotkey` / `query.formatHotkey` and
// inline UI comments hardcoded the mac glyphs, which read as foreign
// symbols on the ~70% of users running Linux or Windows. This script
// runs in pre-commit + CI as the cheap regression gate that catches
// "someone retyped ⌘ into a string literal" before the diff lands.
//
// Scope:
//   • src/services/i18n/locales/*.ts  — all locale tables
//   • src/components/**/*.{ts,tsx}    — call sites
//   • src/pages/**/*.{ts,tsx}         — page-level glue
//   • src/lib/**/*.{ts,tsx}           — the single allowlisted file
//     (platformKeyHints.ts) is matched by basename and skipped.
//
// CLI: `node scripts/check-no-mac-glyphs.mjs` — exit 0 on clean, exit
// 1 with a per-offender printout on hit. No deps beyond node stdlib.

import fs from 'node:fs/promises'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

const GLYPHS = ['⌘', '⌥', '⇧', '⌃']
const GLYPH_RE = new RegExp(`[${GLYPHS.join('')}]`)

const SCAN_ROOTS = [
  'src/services/i18n/locales',
  'src/components',
  'src/pages',
  'src/lib',
]

// The single seam where modKeyLabel() / shiftKeyLabel() emit "⌘" / "⇧"
// on macOS. Matched by basename so it survives moves under src/lib/.
const ALLOWLIST_BASENAMES = new Set([
  'platformKeyHints.ts',
  'platformKeyHints.test.ts',
])

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    if (ALLOWLIST_BASENAMES.has(entry.name)) continue
    yield full
  }
}

async function main() {
  const offenders = []
  for (const root of SCAN_ROOTS) {
    const abs = path.join(REPO_ROOT, root)
    try {
      // eslint-disable-next-line no-await-in-loop
      const stat = await fs.stat(abs)
      if (!stat.isDirectory()) continue
    } catch {
      continue
    }
    // eslint-disable-next-line no-restricted-syntax
    for await (const file of walk(abs)) {
      // eslint-disable-next-line no-await-in-loop
      const raw = await fs.readFile(file, 'utf8')
      if (!GLYPH_RE.test(raw)) continue
      const lines = raw.split('\n')
      lines.forEach((line, idx) => {
        if (GLYPH_RE.test(line)) {
          offenders.push({
            file: path.relative(REPO_ROOT, file),
            line: idx + 1,
            snippet: line.trim(),
          })
        }
      })
    }
  }

  if (offenders.length === 0) {
    return 0
  }
  console.error('check-no-mac-glyphs: mac-specific keyboard glyphs found.')
  console.error('  Route them through src/lib/platformKeyHints.ts instead.')
  console.error('')
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}`)
    console.error(`    ${o.snippet}`)
  }
  return 1
}

const code = await main()
process.exit(code)
