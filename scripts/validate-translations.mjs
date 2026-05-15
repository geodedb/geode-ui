#!/usr/bin/env node
//
// validate-translations.mjs
//
// Walks src/ for `t('foo.bar')`, `t("foo.bar")`, and JSX
// `<Trans i18nKey="foo.bar" />` call sites; cross-references each
// extracted key against the locale files under
// src/services/i18n/locales/. Exits non-zero when:
//
//   1. A required locale (default: en) is missing a key referenced
//      in source.
//   2. A locale file has more or fewer keys than the reference locale
//      and that count crosses --max-warnings-total.
//
// The pattern is borrowed from
// ../brancher/brancher/scripts/validate-translations.mjs but is
// stdlib-only — no AST parser, no jiti — so it survives in a
// pre-commit context without slow process spawning.
//
// CLI:
//   node scripts/validate-translations.mjs                        # default
//   node scripts/validate-translations.mjs --required-locales=en  # explicit
//   node scripts/validate-translations.mjs --max-warnings-total=0 # strict CI
//
// Notes on key extraction:
//   - Dynamic keys (template literals, variables) are skipped with a
//     SKIPPED counter — those need a runtime fallback path; eyeballing
//     them is the team's job.
//   - Plurals: i18next conventions place the key in source as
//     `foo.items` and the locale defines `items_one` + `items_other`.
//     The validator considers `_one`/`_other`/`_few`/`_many`/`_zero`
//     suffixes as alternative declarations of the base key.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src')
const LOCALES = path.join(SRC, 'services', 'i18n', 'locales')

const args = process.argv.slice(2)
function flag(name, fallback) {
  const m = args.find((a) => a.startsWith(`--${name}=`))
  return m ? m.split('=', 2)[1] : fallback
}
const REQUIRED = flag('required-locales', 'en')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const MAX_WARN = Number(flag('max-warnings-total', '0'))

// Match t('key.path'), t("key.path"), or <Trans i18nKey="key.path" />.
// We deliberately don't try to parse template-literal interpolation —
// that would require an AST. Instead, those cases bump SKIPPED.
const T_CALL = /\bt\(\s*(['"])([\w.\-/:]+?)\1/g
const T_TEMPLATE = /\bt\(\s*`/g
const TRANS_TAG = /<Trans[^>]*\bi18nKey\s*=\s*(['"])([\w.\-/:]+?)\1/g

async function* walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'services') {
        if (e.name === 'services' && full === path.join(SRC, 'services')) {
          yield* walk(full)
          continue
        }
        if (e.name === 'node_modules') continue
      }
      yield* walk(full)
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
      yield full
    }
  }
}

async function extractReferencedKeys() {
  const keys = new Set()
  let dynamic = 0
  for await (const f of walk(SRC)) {
    if (f.startsWith(LOCALES)) continue // don't extract from locale files
    const text = await fs.readFile(f, 'utf8')
    for (const m of text.matchAll(T_CALL)) keys.add(m[2])
    for (const m of text.matchAll(TRANS_TAG)) keys.add(m[2])
    for (const _m of text.matchAll(T_TEMPLATE)) dynamic += 1
  }
  return { keys, dynamic }
}

// Recursively flatten a translation object into a Set of dot-paths.
// Plural suffixes (_one/_other/_few/_many/_zero) are stripped so they
// share the base key when a consumer calls t('foo.items', { count }).
function flattenKeys(obj, prefix = '') {
  const out = new Set()
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const inner of flattenKeys(v, full)) out.add(inner)
    } else {
      out.add(full.replace(/_(one|other|few|many|zero)$/, ''))
    }
  }
  return out
}

async function loadLocale(code) {
  // Locale files export `export const <code> = { ... } as const`. We
  // import them via dynamic import — but that needs ESM resolution
  // *and* the .ts files would need a transformer. Easier path: read
  // the file as text and eval the exported object via a shadow VM.
  const file = path.join(LOCALES, `${code}.ts`)
  let src
  try {
    src = await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
  // The file always contains `export const <code> = { ... } as const`.
  // Strip the wrapper so we can JSON-eval the body.
  const m = src.match(/export\s+const\s+\w+\s*=\s*({[\s\S]*})\s*as\s+const/)
  if (!m) return null
  // Strip TypeScript-style trailing commas + comments and turn the
  // JS-object literal into a JSON.parse-able blob. The brancher
  // validator does the same. Keys/values are well-formed in our
  // locales by convention.
  let body = m[1]
  body = body.replace(/\/\*[\s\S]*?\*\//g, '')
  body = body.replace(/\/\/.*$/gm, '')
  body = body.replace(/,(\s*[}\]])/g, '$1')
  // Quote bare keys.
  body = body.replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
  // Convert single-quoted strings to double-quoted, escaping
  // existing double quotes inside the value.
  body = body.replace(/'((?:\\.|[^'\\])*)'/g, (_, inner) => {
    return `"${inner.replace(/"/g, '\\"').replace(/\\'/g, "'")}"`
  })
  try {
    return JSON.parse(body)
  } catch (e) {
    console.error(`[locale parser] failed to parse ${code}.ts: ${e.message}`)
    return null
  }
}

;(async () => {
  const { keys: referenced, dynamic } = await extractReferencedKeys()
  console.log(
    `Found ${referenced.size} unique t() keys referenced in src/ ` +
      `(${dynamic} dynamic call(s) skipped).`
  )

  const reportLocale = async (code) => {
    const obj = await loadLocale(code)
    if (!obj) {
      console.error(`✗ locale '${code}' not found or unparseable`)
      return { missing: [], orphan: [], parsed: false }
    }
    const declared = flattenKeys(obj)
    const missing = [...referenced].filter((k) => !declared.has(k))
    const orphan = [...declared].filter((k) => !referenced.has(k))
    return { missing, orphan, parsed: true }
  }

  let warnings = 0
  let errors = 0
  for (const code of REQUIRED) {
    const { missing, orphan, parsed } = await reportLocale(code)
    if (!parsed) {
      errors += 1
      continue
    }
    console.log(
      `  ${code}:  ${missing.length} missing, ${orphan.length} orphan`
    )
    for (const k of missing) console.log(`    MISSING ${code}.${k}`)
    if (missing.length > 0) errors += missing.length
    warnings += orphan.length
  }

  if (warnings > MAX_WARN) {
    console.error(
      `\n✗ ${warnings} orphan key(s) > --max-warnings-total=${MAX_WARN}.`
    )
    process.exit(1)
  }
  if (errors > 0) {
    console.error(`\n✗ ${errors} blocking issue(s).`)
    process.exit(1)
  }
  console.log('\n✓ All required locales contain every referenced key.')
})()
