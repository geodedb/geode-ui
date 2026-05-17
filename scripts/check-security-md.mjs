#!/usr/bin/env node
// GAP-037 (#282) regression gate.
//
// SECURITY.md is the public-facing disclosure contract for this project.
// In the past it has accumulated stale attributions (e.g. crediting
// `@devnw/components` for controls that ship from direct deps or in-repo
// modules). A wrong attribution on a security disclosure document
// misroutes researcher reports, so this guard fails CI if any of those
// stale strings reappear.
//
// Pure, testable. Exits 1 with a clear listing on any miss.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DEFAULT = path.resolve(HERE, '..')

// Stale attribution strings that must not appear in SECURITY.md.
// Add new patterns here as new audit findings land.
export const FORBIDDEN_PATTERNS = [
  // GAP-037: DOMPurify + RBAC mis-attributed to @devnw/components.
  '@devnw/components',
]

// Pure, testable.
export function checkSecurityMd(root) {
  const p = path.join(root, 'SECURITY.md')
  let src
  try {
    src = readFileSync(p, 'utf8')
  } catch (e) {
    return {
      ok: false,
      problems: [`cannot read ${p}: ${e.message}`],
    }
  }

  const problems = []
  const lines = src.split('\n')

  for (const pattern of FORBIDDEN_PATTERNS) {
    lines.forEach((line, idx) => {
      if (line.includes(pattern)) {
        problems.push(
          `SECURITY.md:${idx + 1} contains forbidden pattern ` +
            `'${pattern}' -- see GAP-037 (#282) for rationale`
        )
      }
    })
  }

  return { ok: problems.length === 0, problems }
}

function main() {
  const idx = process.argv.indexOf('--root')
  const root =
    idx !== -1 && process.argv[idx + 1]
      ? path.resolve(process.argv[idx + 1])
      : ROOT_DEFAULT
  const r = checkSecurityMd(root)
  if (!r.ok) {
    console.error('check-security-md: FAILED')
    for (const p of r.problems) console.error(`  - ${p}`)
    process.exitCode = 1
    return
  }
  console.log(
    `check-security-md: OK -- no forbidden patterns in SECURITY.md ` +
      `(${FORBIDDEN_PATTERNS.length} guarded)`
  )
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
