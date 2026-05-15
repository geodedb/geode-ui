#!/usr/bin/env node
// Cross-check: every server error-code string the SPA branches on
// (exported from src/api/serverErrorCodes.ts) must exist as an
// `ErrCode* = "value"` constant in internal/server/errorcodes.go.
// Exit 1 with a clear message on any mismatch (or a missing/empty
// serverErrorCodes.ts, or a parse that yields zero server codes).
// Wired into pre-commit and CI.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// Parse `ErrCodeFoo = "foo_bar"` (Go const block). Returns Set<string> of values.
function goErrorCodeValues(src) {
  const out = new Set()
  const re = /\bErrCode\w+\s*=\s*"([^"]+)"/g
  let m
  while ((m = re.exec(src)) !== null) out.add(m[1])
  return out
}

// Parse `export const FOO = 'foo_bar' as const` / `export const FOO = "foo_bar"`.
// Returns Array<{name, value}>.
function tsExportedStringConsts(src) {
  const out = []
  const re = /export\s+const\s+(\w+)\s*=\s*(['"])([^'"]+)\2(?:\s+as\s+const)?/g
  let m
  while ((m = re.exec(src)) !== null) out.push({ name: m[1], value: m[3] })
  return out
}

function readMaybe(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

// Pure, testable. `root` is the repo root.
export function checkErrorCodes(root) {
  const goPath = path.join(root, 'internal', 'server', 'errorcodes.go')
  const tsPath = path.join(root, 'src', 'api', 'serverErrorCodes.ts')
  const problems = []

  const goSrc = readMaybe(goPath)
  if (goSrc === null) {
    return { ok: false, problems: [`cannot read ${goPath}`], serverCodeCount: 0, frontendCodeCount: 0 }
  }
  const tsSrc = readMaybe(tsPath)
  if (tsSrc === null) {
    return { ok: false, problems: [`cannot read ${tsPath}`], serverCodeCount: 0, frontendCodeCount: 0 }
  }

  const serverCodes = goErrorCodeValues(goSrc)
  if (serverCodes.size === 0) {
    problems.push(
      `parsed no ErrCode* constants from ${path.relative(root, goPath)} -- ` +
        `parser or file shape changed; investigate`,
    )
  }

  const frontend = tsExportedStringConsts(tsSrc)
  if (frontend.length === 0) {
    problems.push(
      `${path.relative(root, tsPath)} exports no string constants -- it must name ` +
        `the server error codes the SPA branches on (e.g. ` +
        `export const WIRE_FEATURE_MISSING = 'wire_feature_missing')`,
    )
  }

  for (const c of frontend) {
    if (serverCodes.size > 0 && !serverCodes.has(c.value)) {
      problems.push(
        `${path.relative(root, tsPath)}: ${c.name} = "${c.value}" is not declared ` +
          `as an ErrCode* constant in ${path.relative(root, goPath)} -- fix one side so they match`,
      )
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    serverCodeCount: serverCodes.size,
    frontendCodeCount: frontend.length,
  }
}

function main() {
  // Default repo root: this script lives in <root>/scripts/.
  const idx = process.argv.indexOf('--root')
  const root = idx !== -1 && process.argv[idx + 1] ? path.resolve(process.argv[idx + 1]) : path.resolve(HERE, '..')

  const r = checkErrorCodes(root)
  if (!r.ok) {
    console.error('check-error-codes: FAILED')
    for (const p of r.problems) console.error(`  - ${p}`)
    process.exitCode = 1
    return
  }
  console.log(
    `check-error-codes: OK -- ${r.frontendCodeCount} frontend-referenced code(s) ` +
      `all present in errorcodes.go (${r.serverCodeCount} server codes total)`,
  )
}

// Run main() only when invoked directly, not when imported by the test.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
