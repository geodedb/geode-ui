#!/usr/bin/env node
// QUAL #258: CHANGELOG.md backfill gate.
//
// Asserts CHANGELOG.md has:
//   1. an `## [Unreleased]` heading (so the file accumulates entries
//      between releases instead of silently slipping out of sync), and
//   2. at least one entry referencing each closure-batch date for the
//      cohort backfilled in #258 (2026-05-12 / 13 / 16 / 17).
//
// Exits 1 with a clear listing on any miss.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DEFAULT = path.resolve(HERE, '..')

// Closure-batch dates whose entries must remain present in CHANGELOG.md.
// Add new dates here as future cohorts land.
export const REQUIRED_BATCH_DATES = [
  '2026-05-12',
  '2026-05-13',
  '2026-05-16',
  '2026-05-17',
]

// Pure, testable.
export function checkChangelog(root) {
  const p = path.join(root, 'CHANGELOG.md')
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

  if (!/^##\s+\[Unreleased\]\s*$/m.test(src)) {
    problems.push(
      'CHANGELOG.md is missing an `## [Unreleased]` heading -- add one ' +
        'so closures accumulate before each release'
    )
  }

  for (const d of REQUIRED_BATCH_DATES) {
    if (!src.includes(d)) {
      problems.push(
        `CHANGELOG.md does not mention closure batch ${d} -- backfill ` +
          'required (see docs/QUALITY_GAP_ANALYSIS.md row #258)'
      )
    }
  }

  return { ok: problems.length === 0, problems }
}

function main() {
  const idx = process.argv.indexOf('--root')
  const root =
    idx !== -1 && process.argv[idx + 1]
      ? path.resolve(process.argv[idx + 1])
      : ROOT_DEFAULT
  const r = checkChangelog(root)
  if (!r.ok) {
    console.error('check-changelog: FAILED')
    for (const p of r.problems) console.error(`  - ${p}`)
    process.exitCode = 1
    return
  }
  console.log(
    `check-changelog: OK -- Unreleased section present, all ${REQUIRED_BATCH_DATES.length} required batch dates referenced`
  )
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
