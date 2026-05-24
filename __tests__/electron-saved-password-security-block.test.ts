// APP-01 R1 (2026-05-24 appsec): pin the SECURITY block above the
// saved-password IPC handlers in `electron/main.ts`. The block
// documents the OS-user trust boundary explicitly: a renderer
// compromise can call `geode:get-stored-password` for any
// `(profile, username)` pair. The doc note is the immediate cheap
// control (R1); R2 (per-session unlock token) and R3 (OS-native
// re-auth) land in subsequent commits.
//
// This regression test is intentionally fragile-by-design: removing
// the SECURITY block fails the test in code review even before R2 /
// R3 fix the underlying contract. Update both the test AND the
// source comment intentionally if the docs change shape.

import fs from 'node:fs'
import path from 'node:path'

const MAIN_PATH = path.resolve(__dirname, '..', 'electron', 'main.ts')
const DOC_PATH = path.resolve(__dirname, '..', 'docs', 'ELECTRON.md')

describe('APP-01 R1: saved-password SECURITY block in electron/main.ts', () => {
  const src = fs.readFileSync(MAIN_PATH, 'utf8')

  test('a SECURITY block is present in the saved-password handler region', () => {
    expect(src).toMatch(/SECURITY \(APP-01\)/)
  })

  test('the block documents the OS-user trust boundary explicitly', () => {
    expect(src).toMatch(/OS[- ]user trust boundary/i)
  })

  test('the block calls out that a renderer compromise can read every saved password', () => {
    // Both keywords must appear in the SECURITY block region; the
    // block is intentionally chatty so loosen to two `expect`s instead
    // of a colocation regex.
    expect(src).toMatch(/renderer compromise/i)
    expect(src).toMatch(/exfiltrat/i)
  })

  test('the block sits before the geode:get-stored-password handler', () => {
    const securityIdx = src.indexOf('SECURITY (APP-01)')
    const handlerIdx = src.indexOf("'geode:get-stored-password'")
    expect(securityIdx).toBeGreaterThanOrEqual(0)
    expect(handlerIdx).toBeGreaterThanOrEqual(0)
    expect(securityIdx).toBeLessThan(handlerIdx)
  })
})

describe('APP-01 R1: docs/ELECTRON.md "Saved-password trust boundary" section', () => {
  const doc = fs.readFileSync(DOC_PATH, 'utf8')

  test('the section is present with the planner-spec header', () => {
    expect(doc).toMatch(/## Saved-password trust boundary/)
  })

  test('the section names the renderer-compromise threat explicitly', () => {
    expect(doc).toMatch(/renderer/i)
    expect(doc).toMatch(/saved password/i)
  })
})
