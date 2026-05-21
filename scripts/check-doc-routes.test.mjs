import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkDocRoutes } from './check-doc-routes.mjs'

function makeRoot() {
  return mkdtempSync(path.join(tmpdir(), 'docroutes-'))
}

test('ok when no .md mentions /workspace or WorkspacePage', () => {
  const root = makeRoot()
  try {
    writeFileSync(
      path.join(root, 'README.md'),
      '# fine\nroutes: `/` and `/dashboard`\n'
    )
    const r = checkDocRoutes(root)
    assert.equal(r.ok, true, JSON.stringify(r.hits))
    assert.equal(r.scanned, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('not ok when a live .md mentions /workspace', () => {
  const root = makeRoot()
  try {
    writeFileSync(
      path.join(root, 'README.md'),
      'see `/workspace` for tiled panes\n'
    )
    const r = checkDocRoutes(root)
    assert.equal(r.ok, false)
    assert.ok(
      r.hits.some((h) => h.file === 'README.md' && h.line === 1),
      JSON.stringify(r.hits)
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('not ok when a live .md mentions WorkspacePage', () => {
  const root = makeRoot()
  try {
    writeFileSync(
      path.join(root, 'docs.md'),
      'import { WorkspacePage } from "./pages"\n'
    )
    const r = checkDocRoutes(root)
    assert.equal(r.ok, false)
    assert.ok(
      r.hits.some((h) => h.match.includes('WorkspacePage')),
      JSON.stringify(r.hits)
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('docs/audits/** is allow-listed (audit deliverables cite removed routes as evidence)', () => {
  const root = makeRoot()
  try {
    mkdirSync(path.join(root, 'docs', 'audits', '2026-05-21'), {
      recursive: true,
    })
    writeFileSync(
      path.join(root, 'docs', 'audits', '2026-05-21', 'gap-collection.md'),
      '`/workspace` route removed; WorkspacePage deleted\n'
    )
    const r = checkDocRoutes(root)
    assert.equal(r.ok, true, JSON.stringify(r.hits))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('historic surfaces (GAP_ANALYSIS_RESOLVED, plans/, .remember/, .scratch/) are allow-listed', () => {
  const root = makeRoot()
  try {
    mkdirSync(path.join(root, 'docs'), { recursive: true })
    mkdirSync(path.join(root, 'docs', 'superpowers', 'plans'), {
      recursive: true,
    })
    mkdirSync(path.join(root, '.remember'), { recursive: true })
    mkdirSync(path.join(root, '.scratch'), { recursive: true })
    writeFileSync(
      path.join(root, 'docs', 'GAP_ANALYSIS_RESOLVED.md'),
      'closed `/workspace` route 2026-05-17\n'
    )
    writeFileSync(
      path.join(root, 'docs', 'superpowers', 'plans', 'old.md'),
      '/workspace was once tiled\n'
    )
    writeFileSync(
      path.join(root, '.remember', 'today.md'),
      'WorkspacePage was deleted\n'
    )
    writeFileSync(
      path.join(root, '.scratch', 'note.md'),
      '/workspace scratch note\n'
    )
    const r = checkDocRoutes(root)
    assert.equal(r.ok, true, JSON.stringify(r.hits))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('multiple .md files are all scanned and hits report file:line', () => {
  const root = makeRoot()
  try {
    mkdirSync(path.join(root, 'docs'))
    writeFileSync(path.join(root, 'README.md'), 'ok\n')
    writeFileSync(
      path.join(root, 'docs', 'guide.md'),
      'line1\n/workspace here\nline3\n'
    )
    const r = checkDocRoutes(root)
    assert.equal(r.ok, false)
    const hit = r.hits.find((h) => h.file === path.join('docs', 'guide.md'))
    assert.ok(
      hit,
      'expected hit in docs/guide.md, got ' + JSON.stringify(r.hits)
    )
    assert.equal(hit.line, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
