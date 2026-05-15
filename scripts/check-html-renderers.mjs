#!/usr/bin/env node
//
// check-html-renderers.mjs
//
// Closes Q-NEW-2 / S-NEW-3 — guards against the two ways a future
// contributor could turn the i18n module's `escapeValue: false`
// setting (src/services/i18n/config.ts) into an XSS vector:
//
//   • <X dangerouslySetInnerHTML={{__html: ...}} />
//   • <Trans i18nKey="..." />   (renders translation string as JSX
//     including HTML — only safe with explicit `components` allowlist)
//
// Both are zero-pre-existing-hits at landing time, so this script
// runs strict from day one. New introductions need an explicit
// `// eslint-disable-next-line html-renderer` annotation if the
// reviewer accepts the risk.
//
// CLI:
//   node scripts/check-html-renderers.mjs           # exits 0 / 1
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, '..', 'src')

const PATTERNS = [
  {
    name: 'dangerouslySetInnerHTML',
    regex: /dangerouslySetInnerHTML/g,
    advice:
      'React lets `dangerouslySetInnerHTML` skip text-escaping. With\n' +
      '  i18n configured `escapeValue: false`, feeding a translated\n' +
      '  value into this prop creates a stored-XSS sink. Render the\n' +
      '  value as text (React escapes), or sanitise via DOMPurify\n' +
      '  before passing the {__html} object.',
  },
  {
    name: '<Trans>',
    regex: /<Trans\b/g,
    advice:
      'react-i18next <Trans> renders translation strings as JSX,\n' +
      '  including HTML. With i18n configured `escapeValue: false`,\n' +
      "  any HTML-shaped translation value is rendered as markup. Use\n" +
      '  the plain `t("key")` form for text, or pass a strict `components`\n' +
      '  allowlist to <Trans> if HTML is required.',
  },
]

const ALLOW_FILE_PATTERNS = [
  /\.test\.tsx?$/,
  /\.spec\.tsx?$/,
  /\.stories\.tsx?$/,
  // The check script itself references the patterns by name.
  /[/\\]check-html-renderers\.mjs$/,
]

async function* walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      yield* walk(full)
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      yield full
    }
  }
}

const violations = []

for await (const f of walk(SRC)) {
  if (ALLOW_FILE_PATTERNS.some((re) => re.test(f))) continue
  const text = await fs.readFile(f, 'utf8')
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    // Honor an explicit per-line escape hatch.
    if (/\/\/\s*eslint-disable-next-line\s+html-renderer/.test(lines[i - 1] ?? '')) return
    for (const p of PATTERNS) {
      p.regex.lastIndex = 0
      if (p.regex.test(line)) {
        violations.push({
          file: path.relative(path.join(__dirname, '..'), f),
          line: i + 1,
          name: p.name,
          snippet: line.trim().slice(0, 120),
          advice: p.advice,
        })
      }
    }
  })
}

if (violations.length === 0) {
  console.log('No JSX HTML renderers detected.')
  process.exit(0)
}

console.error(`FAIL: ${violations.length} JSX HTML renderer(s) introduced:`)
const seen = new Set()
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.name}`)
  console.error(`    ${v.snippet}`)
  if (!seen.has(v.name)) {
    seen.add(v.name)
    console.error('  Why this matters:')
    for (const adv of v.advice.split('\n')) console.error(`    ${adv.trim()}`)
  }
}
console.error(
  '\nIf the introduction is intentional and reviewed, suppress with the\n' +
    'preceding-line annotation:  // eslint-disable-next-line html-renderer'
)
process.exit(1)
