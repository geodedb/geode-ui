#!/usr/bin/env node
//
// detect-hardcoded-strings.mjs
//
// Scans .tsx files under src/ for hardcoded user-facing strings in
// JSX prop positions that almost always end up rendered to the user
// (alt, title, label, placeholder, aria-label, etc.). Flagged
// strings should be replaced with a `t('domain.key')` call routed
// through our i18n module.
//
// Pattern modeled on brancher/scripts/detect-hardcoded-strings.mjs.
//
// CLI:
//   node scripts/detect-hardcoded-strings.mjs           # list, exit 0
//   node scripts/detect-hardcoded-strings.mjs --strict  # exit 1 on hit
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, '..', 'src')
const STRICT = process.argv.includes('--strict')

const TARGET_PROPS = new Set([
  'alt',
  'title',
  'label',
  'placeholder',
  'description',
  'header',
  'aria-label',
  'aria-description',
  'aria-roledescription',
])

// Skip strings that are obviously not user-facing copy.
const SKIP_VALUE = [
  /^[\s\d.,:%+-]+$/,
  /^[#@./_-]+$/,
  /^https?:|^mailto:|^tel:|^geode:|^app:/,
  /^[a-z][\w-]*$/,
  /^\d{4}-\d{2}-\d{2}T/,
  /^\$\{/,
]

const ALLOW_FILE_PATTERNS = [
  /\.test\.tsx?$/,
  /\.spec\.tsx?$/,
  /\.stories\.tsx?$/,
  /[/\\]services[/\\]i18n[/\\]/,
  /[/\\]test-utils[/\\]/,
]

async function* walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      yield* walk(full)
    } else if (/\.tsx$/.test(e.name)) {
      yield full
    }
  }
}

const ATTR = /\b([a-zA-Z_][\w-]*)=(?:"((?:\\.|[^"\\])+)"|'((?:\\.|[^'\\])+)')/g

const violations = []

for await (const f of walk(SRC)) {
  if (ALLOW_FILE_PATTERNS.some((re) => re.test(f))) continue
  const text = await fs.readFile(f, 'utf8')
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    let m
    while ((m = ATTR.exec(line)) !== null) {
      const [, name, dq, sq] = m
      const val = dq ?? sq
      if (!TARGET_PROPS.has(name)) continue
      if (!/[A-Za-z]/.test(val)) continue
      if (SKIP_VALUE.some((re) => re.test(val))) continue
      if (!/\s/.test(val) && val.length < 24) continue
      violations.push({
        file: path.relative(path.join(__dirname, '..'), f),
        line: i + 1,
        attr: name,
        value: val,
      })
    }
    ATTR.lastIndex = 0
  })
}

if (violations.length === 0) {
  console.log('No hardcoded user-facing strings detected.')
  process.exit(0)
}

console.error(
  `${STRICT ? 'FAIL' : 'WARN'}: ${violations.length} hardcoded string(s):`
)
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.attr}="${v.value}"`)
}
console.error(
  '\nReplace with: import { useTranslation } from "react-i18next"; ' +
    'const { t } = useTranslation(); …<X label={t("domain.key")} />\n'
)
process.exit(STRICT ? 1 : 0)
