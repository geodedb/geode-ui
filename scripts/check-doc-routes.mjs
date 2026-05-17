#!/usr/bin/env node
// QUAL #253 / gap-residue gate: asserts that the deleted `/workspace`
// route and the `WorkspacePage` component name don't reappear in live
// `.md` documentation.
//
// Historical artefacts are explicitly allow-listed (closure-record
// docs, design plans superseded by deletion) because they describe
// what once existed; flagging them would force rewriting history.
//
// Exits 1 with a clear file:line listing on any hit.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DEFAULT = path.resolve(HERE, '..')

// Path patterns (relative to repo root) that are allowed to retain
// workspace references because they document past state, not the
// current codebase.
const HISTORICAL_ALLOWLIST = [
  /^docs\/GAP_ANALYSIS_RESOLVED\.md$/,
  /^docs\/superpowers\/plans\//,
  /^node_modules\//,
  /^gen\//,
  // Daily-notes / scratch directories are session journals, not
  // user-facing docs; their historical claims aren't subject to
  // the residue rule.
  /^\.remember\//,
  /^\.scratch\//,
  // The gap-tracking row that DESCRIBES this very check is allowed
  // to use the term once in its evidence column. Once #253 is
  // marked Closed the row gets rewritten anyway.
  /^docs\/QUALITY_GAP_ANALYSIS\.md$/,
  /^docs\/GAP_ANALYSIS\.md$/,
]

// Forbidden terms in live docs.
const FORBIDDEN = [/\/workspace\b/, /\bWorkspacePage\b/]

function isAllowed(rel) {
  return HISTORICAL_ALLOWLIST.some((re) => re.test(rel))
}

function walk(dir, root, acc) {
  for (const ent of readdirSync(dir)) {
    const full = path.join(dir, ent)
    const rel = path.relative(root, full)
    if (rel.startsWith('.git') || rel.startsWith('node_modules')) continue
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walk(full, root, acc)
    } else if (st.isFile() && full.endsWith('.md')) {
      acc.push({ full, rel })
    }
  }
}

// Pure, testable.
export function checkDocRoutes(root) {
  const files = []
  walk(root, root, files)

  const hits = []
  for (const f of files) {
    if (isAllowed(f.rel)) continue
    let src
    try {
      src = readFileSync(f.full, 'utf8')
    } catch {
      continue
    }
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const re of FORBIDDEN) {
        if (re.test(lines[i])) {
          hits.push({
            file: f.rel,
            line: i + 1,
            match: lines[i].trim().slice(0, 200),
          })
          break
        }
      }
    }
  }

  return { ok: hits.length === 0, hits, scanned: files.length }
}

function main() {
  const idx = process.argv.indexOf('--root')
  const root =
    idx !== -1 && process.argv[idx + 1]
      ? path.resolve(process.argv[idx + 1])
      : ROOT_DEFAULT
  const r = checkDocRoutes(root)
  if (!r.ok) {
    console.error(
      'check-doc-routes: FAILED -- residue from deleted /workspace route detected:'
    )
    for (const h of r.hits) console.error(`  ${h.file}:${h.line}: ${h.match}`)
    console.error(
      '\nAllowed historical surfaces: ' +
        HISTORICAL_ALLOWLIST.map(String).join(', ')
    )
    process.exitCode = 1
    return
  }
  console.log(
    `check-doc-routes: OK -- ${r.scanned} .md file(s) scanned, no live /workspace residue`
  )
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
