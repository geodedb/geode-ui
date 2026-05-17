import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkChangelog, REQUIRED_BATCH_DATES } from './check-changelog.mjs'

function fixtureWith(content) {
  const root = mkdtempSync(path.join(tmpdir(), 'changelog-'))
  writeFileSync(path.join(root, 'CHANGELOG.md'), content)
  return root
}

test('ok with [Unreleased] heading and all required batch dates', () => {
  const body = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    ...REQUIRED_BATCH_DATES.map((d) => `### Added -- ${d}`),
    '',
  ].join('\n')
  const root = fixtureWith(body)
  try {
    const r = checkChangelog(root)
    assert.equal(r.ok, true, JSON.stringify(r.problems))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('not ok when [Unreleased] heading missing', () => {
  const body = [
    '# Changelog',
    '',
    '## v0.1.0',
    '',
    ...REQUIRED_BATCH_DATES.map((d) => `### Added -- ${d}`),
    '',
  ].join('\n')
  const root = fixtureWith(body)
  try {
    const r = checkChangelog(root)
    assert.equal(r.ok, false)
    assert.ok(
      r.problems.some((p) => p.includes('[Unreleased]')),
      JSON.stringify(r.problems)
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('not ok when a required batch date is missing', () => {
  const dates = REQUIRED_BATCH_DATES.slice(0, REQUIRED_BATCH_DATES.length - 1)
  const body = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    ...dates.map((d) => `### Added -- ${d}`),
    '',
  ].join('\n')
  const root = fixtureWith(body)
  try {
    const r = checkChangelog(root)
    assert.equal(r.ok, false)
    assert.ok(
      r.problems.some((p) =>
        p.includes(REQUIRED_BATCH_DATES[REQUIRED_BATCH_DATES.length - 1])
      ),
      JSON.stringify(r.problems)
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('not ok when CHANGELOG.md does not exist', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'changelog-'))
  try {
    const r = checkChangelog(root)
    assert.equal(r.ok, false)
    assert.ok(
      r.problems.some((p) => /cannot read/.test(p)),
      JSON.stringify(r.problems)
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
