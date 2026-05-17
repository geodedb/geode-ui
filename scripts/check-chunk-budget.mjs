#!/usr/bin/env node
// PERF-N6 (#285) chunk-budget tripwire.
//
// Walks the production build output (`internal/ui/dist/`) looking for
// JavaScript chunks larger than the configured raw-byte budget. Async
// chunks (Monaco editor, Cytoscape, etc.) are the primary risk surface
// because they cross the wire on first interaction and dominate cold-
// page TTI on the slowest devices we target.
//
// We deliberately do NOT depend on `webpack-bundle-analyzer` so this
// check can run in CI without adding a new devDependency. The dist
// directory shape is stable across webpack v5 emissions.
//
// Defaults:
//   - root:        repo root (so `node scripts/check-chunk-budget.mjs`
//                  is the canonical invocation)
//   - dist:        `internal/ui/dist`
//   - budget:      4 MiB raw bytes per single chunk
//   - extensions:  `.js` only (CSS chunks are tiny in this build)
//
// Override via flags:
//   --root <path>     repo root (default: directory containing this script's parent)
//   --dist <path>     dist directory relative to root (default: internal/ui/dist)
//   --budget <bytes>  raw-byte budget per chunk (default: 4 MiB = 4194304)
//
// Exits 1 when any chunk exceeds the budget. Exits 0 with a one-line
// summary otherwise. Pure / testable — the core scanner is exported as
// `checkChunkBudget({ distDir, budgetBytes })`.

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DEFAULT = path.resolve(HERE, '..')
const DIST_DEFAULT = path.join('internal', 'ui', 'dist')
const BUDGET_DEFAULT = 4 * 1024 * 1024 // 4 MiB

// Pure, testable. distDir is absolute; budgetBytes is a positive
// integer. Returns { ok, total, perChunk: [{ name, size }], offenders:
// [{ name, size }] } so the CI caller can format the violations any
// way it likes.
export function checkChunkBudget({ distDir, budgetBytes }) {
  let entries
  try {
    entries = readdirSync(distDir, { withFileTypes: true })
  } catch (e) {
    return {
      ok: false,
      problems: [`cannot read ${distDir}: ${e.message}`],
      perChunk: [],
      offenders: [],
      total: 0,
    }
  }
  const perChunk = []
  for (const e of entries) {
    if (!e.isFile()) continue
    // .js chunks only — chunk-budget is about JS payload weight on
    // the wire; CSS and source maps are interesting separately but
    // sit far below the threshold today.
    if (!e.name.endsWith('.js')) continue
    if (e.name.endsWith('.map')) continue
    const full = path.join(distDir, e.name)
    const s = statSync(full)
    perChunk.push({ name: e.name, size: s.size })
  }
  perChunk.sort((a, b) => b.size - a.size)
  const offenders = perChunk.filter((c) => c.size > budgetBytes)
  const total = perChunk.reduce((acc, c) => acc + c.size, 0)
  if (offenders.length === 0) {
    return { ok: true, problems: [], perChunk, offenders, total }
  }
  const problems = offenders.map(
    (c) =>
      `chunk ${c.name} is ${c.size} bytes (>${budgetBytes} budget); ` +
      'split it or raise the budget after benchmarking the new chunk on a slow device.'
  )
  return { ok: false, problems, perChunk, offenders, total }
}

function parseFlag(argv, name, fallback) {
  const i = argv.indexOf(name)
  if (i !== -1 && argv[i + 1] !== undefined) return argv[i + 1]
  return fallback
}

function fmtBytes(n) {
  const KiB = 1024
  const MiB = 1024 * 1024
  if (n >= MiB) return `${(n / MiB).toFixed(2)} MiB`
  if (n >= KiB) return `${(n / KiB).toFixed(2)} KiB`
  return `${n} B`
}

function main() {
  const argv = process.argv.slice(2)
  const root = path.resolve(parseFlag(argv, '--root', ROOT_DEFAULT))
  const dist = path.resolve(root, parseFlag(argv, '--dist', DIST_DEFAULT))
  const budget = Number(parseFlag(argv, '--budget', BUDGET_DEFAULT))
  if (!Number.isFinite(budget) || budget <= 0) {
    console.error(`check-chunk-budget: invalid budget ${budget}`)
    process.exitCode = 2
    return
  }
  const r = checkChunkBudget({ distDir: dist, budgetBytes: budget })
  // Always print a summary so CI logs show what the check observed.
  if (r.perChunk.length === 0) {
    console.warn(
      `check-chunk-budget: no .js chunks found under ${dist}; ` +
        'did you run `npm run build` first?'
    )
  } else {
    const heaviest = r.perChunk.slice(0, 5)
    console.log(
      `check-chunk-budget: ${r.perChunk.length} .js chunks, ` +
        `total=${fmtBytes(r.total)}, budget=${fmtBytes(budget)} per chunk`
    )
    for (const c of heaviest) {
      console.log(`  ${c.name}\t${fmtBytes(c.size)}`)
    }
  }
  if (!r.ok) {
    console.error('check-chunk-budget: FAILED')
    for (const p of r.problems) console.error(`  - ${p}`)
    process.exitCode = 1
    return
  }
  console.log('check-chunk-budget: OK')
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
