import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkSecurityMd, FORBIDDEN_PATTERNS } from './check-security-md.mjs'

function fixtureWith(content) {
  const root = mkdtempSync(path.join(tmpdir(), 'security-md-'))
  writeFileSync(path.join(root, 'SECURITY.md'), content)
  return root
}

test('ok when SECURITY.md cites direct deps only', () => {
  const body = [
    '# Security',
    '',
    '- **DOMPurify**: HTML sanitization (`dompurify@^3.4.0`)',
    '- **RBAC**: vocabulary in `src/lib/rbacVocab.ts`',
    '',
  ].join('\n')
  const root = fixtureWith(body)
  try {
    const r = checkSecurityMd(root)
    assert.equal(r.ok, true, JSON.stringify(r.problems))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('not ok when @devnw/components attribution returns', () => {
  const body = [
    '# Security',
    '',
    '- **DOMPurify**: HTML sanitization via `@devnw/components`',
    '',
  ].join('\n')
  const root = fixtureWith(body)
  try {
    const r = checkSecurityMd(root)
    assert.equal(r.ok, false)
    assert.ok(
      r.problems.some((p) => p.includes('@devnw/components')),
      JSON.stringify(r.problems)
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('not ok when SECURITY.md does not exist', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'security-md-'))
  try {
    const r = checkSecurityMd(root)
    assert.equal(r.ok, false)
    assert.ok(
      r.problems.some((p) => /cannot read/.test(p)),
      JSON.stringify(r.problems)
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('FORBIDDEN_PATTERNS is non-empty', () => {
  assert.ok(FORBIDDEN_PATTERNS.length > 0)
})
