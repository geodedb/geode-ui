import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkErrorCodes } from './check-error-codes.mjs'

function fixture(goSrc, tsSrc) {
  const root = mkdtempSync(path.join(tmpdir(), 'errcodes-'))
  mkdirSync(path.join(root, 'internal', 'server'), { recursive: true })
  mkdirSync(path.join(root, 'src', 'api'), { recursive: true })
  writeFileSync(path.join(root, 'internal', 'server', 'errorcodes.go'), goSrc)
  writeFileSync(path.join(root, 'src', 'api', 'serverErrorCodes.ts'), tsSrc)
  return root
}

test('ok when every frontend code exists in errorcodes.go', () => {
  const root = fixture(
    `package server\nconst (\n\tErrCodeWireFeatureMissing = "wire_feature_missing"\n\tErrCodeNotFound = "not_found"\n)\n`,
    `export const WIRE_FEATURE_MISSING = 'wire_feature_missing' as const\n`,
  )
  try {
    const r = checkErrorCodes(root)
    assert.equal(r.ok, true, JSON.stringify(r.problems))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('not ok when a frontend code is missing from errorcodes.go', () => {
  const root = fixture(
    `package server\nconst (\n\tErrCodeNotFound = "not_found"\n)\n`,
    `export const WIRE_FEATURE_MISSING = 'wire_feature_missing' as const\n`,
  )
  try {
    const r = checkErrorCodes(root)
    assert.equal(r.ok, false)
    assert.ok(r.problems.some((p) => p.includes('wire_feature_missing')), JSON.stringify(r.problems))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('not ok when serverErrorCodes.ts is empty', () => {
  const root = fixture(
    `package server\nconst ( ErrCodeNotFound = "not_found" )\n`,
    `// empty\n`,
  )
  try {
    const r = checkErrorCodes(root)
    assert.equal(r.ok, false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('not ok when errorcodes.go parses to zero constants', () => {
  const root = fixture(
    `package server\n// no const block\n`,
    `export const WIRE_FEATURE_MISSING = 'wire_feature_missing' as const\n`,
  )
  try {
    const r = checkErrorCodes(root)
    assert.equal(r.ok, false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
