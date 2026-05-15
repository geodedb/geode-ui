// scripts/bench-gate.ts
// Compares the latest bench results JSON to a baseline. Exits non-zero
// on regression > THRESHOLD% on any per-record metric. Invoked manually:
//
//   npx ts-node scripts/bench-gate.ts <results.json> <baseline.json>
//
// Both files have the shape produced by e2e/specs/19-graph-bench.spec.ts.

/* eslint-disable no-console -- this is a CLI tool */

import * as fs from 'node:fs'

type Record = {
  renderer: 'cytoscape' | 'reagraph'
  n: number
  tier: 'small' | 'mid' | 'large'
  firstPaintMs: number
  firstInteractiveMs: number
  layoutMs: number
  avgFps: number
  p5Fps: number
}

type Doc = { records: Record[] }

const THRESHOLD = 0.1 // 10%

// Lower is better for these:
const LOWER_IS_BETTER = new Set([
  'firstPaintMs',
  'firstInteractiveMs',
  'layoutMs',
])
// Higher is better for these:
const HIGHER_IS_BETTER = new Set(['avgFps', 'p5Fps'])

function regressed(metric: string, baseline: number, current: number): boolean {
  if (baseline <= 0) return false
  if (LOWER_IS_BETTER.has(metric)) {
    return (current - baseline) / baseline > THRESHOLD
  }
  if (HIGHER_IS_BETTER.has(metric)) {
    return (baseline - current) / baseline > THRESHOLD
  }
  return false
}

function key(r: Record): string {
  return `${r.renderer}|${r.n}`
}

function main(): void {
  const [, , resultsPath, baselinePath] = process.argv
  if (!resultsPath || !baselinePath) {
    console.error('usage: bench-gate.ts <results.json> <baseline.json>')
    process.exit(2)
  }
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8')) as Doc
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as Doc
  const baselineByKey = new Map(baseline.records.map((r) => [key(r), r]))

  const METRICS = [
    'firstPaintMs',
    'firstInteractiveMs',
    'layoutMs',
    'avgFps',
    'p5Fps',
  ] as const

  const failures: string[] = []
  results.records.forEach((cur) => {
    const base = baselineByKey.get(key(cur))
    if (!base) return // new combo — no baseline to compare
    METRICS.forEach((m) => {
      const b = base[m] as unknown as number
      const c = cur[m] as unknown as number
      if (regressed(m, b, c)) {
        failures.push(`${key(cur)} ${m}: baseline=${b} current=${c}`)
      }
    })
  })

  if (failures.length > 0) {
    console.error(
      `bench-gate: ${failures.length} regression(s) > ${THRESHOLD * 100}%:`
    )
    failures.forEach((f) => console.error(`  ${f}`))
    process.exit(1)
  }
  console.log('bench-gate: all metrics within threshold')
}

main()
