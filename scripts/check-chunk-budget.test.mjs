import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkChunkBudget } from './check-chunk-budget.mjs'

function fixtureWith(files) {
  // files: Array<[name, sizeOrBuffer]>
  const dir = mkdtempSync(path.join(tmpdir(), 'chunk-budget-'))
  for (const [name, val] of files) {
    const full = path.join(dir, name)
    mkdirSync(path.dirname(full), { recursive: true })
    if (typeof val === 'number') {
      writeFileSync(full, Buffer.alloc(val))
    } else {
      writeFileSync(full, val)
    }
  }
  return dir
}

test('ok when every chunk is under the budget', () => {
  const dist = fixtureWith([
    ['main.js', 1000],
    ['vendors.js', 2000],
  ])
  try {
    const r = checkChunkBudget({ distDir: dist, budgetBytes: 4096 })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.offenders.length, 0)
    assert.equal(r.perChunk.length, 2)
    assert.equal(r.total, 3000)
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})

test('not ok when a chunk exceeds the budget', () => {
  const dist = fixtureWith([
    ['main.js', 1000],
    ['oversized.js', 5000],
  ])
  try {
    const r = checkChunkBudget({ distDir: dist, budgetBytes: 4096 })
    assert.equal(r.ok, false)
    assert.equal(r.offenders.length, 1)
    assert.equal(r.offenders[0].name, 'oversized.js')
    assert.equal(r.offenders[0].size, 5000)
    assert.ok(
      r.problems.some((p) => p.includes('oversized.js')),
      JSON.stringify(r.problems)
    )
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})

test('non-.js files are ignored', () => {
  const dist = fixtureWith([
    ['main.js', 1000],
    ['styles.css', 50_000_000], // huge CSS — should not trip the gate
    ['main.js.map', 50_000_000], // source map — likewise
  ])
  try {
    const r = checkChunkBudget({ distDir: dist, budgetBytes: 4096 })
    assert.equal(r.ok, true)
    assert.equal(r.perChunk.length, 1)
    assert.equal(r.perChunk[0].name, 'main.js')
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})

test('chunks are sorted heaviest-first', () => {
  const dist = fixtureWith([
    ['a.js', 100],
    ['b.js', 1000],
    ['c.js', 500],
  ])
  try {
    const r = checkChunkBudget({ distDir: dist, budgetBytes: 4096 })
    assert.equal(r.ok, true)
    assert.deepEqual(
      r.perChunk.map((c) => c.name),
      ['b.js', 'c.js', 'a.js']
    )
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})

test('missing dist directory surfaces a clear error', () => {
  const r = checkChunkBudget({
    distDir: '/nonexistent/path/internal/ui/dist',
    budgetBytes: 4 * 1024 * 1024,
  })
  assert.equal(r.ok, false)
  assert.ok(
    r.problems.some((p) => /cannot read/.test(p)),
    JSON.stringify(r.problems)
  )
})

test('two chunks at exactly the budget pass (boundary)', () => {
  const dist = fixtureWith([
    ['a.js', 4096],
    ['b.js', 4096],
  ])
  try {
    const r = checkChunkBudget({ distDir: dist, budgetBytes: 4096 })
    // Strict `> budget` -> at-budget chunks pass.
    assert.equal(r.ok, true, JSON.stringify(r.problems))
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})
