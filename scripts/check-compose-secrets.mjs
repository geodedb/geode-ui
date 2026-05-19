#!/usr/bin/env node
// SEC #322/#323: e2e compose must not embed hardcoded test secrets.
//
// The pre-fix `docker-compose.test.yml` carried inline defaults:
//   GEODE_PROFILESTORE_KEY: ${VAR:-AAAA...} (32 zero bytes, base64)
//   -jwt-secret-hex        ${VAR:-0123456789abcdef...} (predictable hex)
//
// An operator copying the compose to a non-test environment without
// rotating env values would inherit those defaults, yielding cleartext-
// equivalent profile encryption and forgeable HS256 JWTs. This gate
// asserts the compose file uses the required-from-env form `${VAR:?…}`
// (or no default at all) for every load-bearing secret, and that no
// known-bad literals appear anywhere in the file.
//
// Exits 1 with a clear listing on any miss.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DEFAULT = path.resolve(HERE, '..')

// Files audited. Keep narrow — production compose files may legitimately
// carry placeholder values if they're documented as such; this gate
// targets the test stack that is the documented source of the risk.
export const AUDITED_FILES = ['deploy/docker-compose.test.yml']

// Literals that MUST NOT appear in the audited files. The first two are
// the pre-fix defaults from SEC #322/#323; extend the list when future
// audits flag additional well-known test values.
export const FORBIDDEN_LITERALS = [
  // 32 zero bytes, base64 — pre-fix GEODE_PROFILESTORE_KEY default.
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', // pragma: allowlist secret
  // Predictable hex — pre-fix JWT_SECRET_HEX default. Matched whole so
  // shorter test fixtures (e.g. a 32-char hex in unrelated docs) don't
  // false-positive.
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', // pragma: allowlist secret
]

// Env vars that MUST appear in the required-from-env form `${VAR:?…}`
// (or with no default) so compose fails loud when they're unset.
export const REQUIRED_FROM_ENV = ['GEODE_PROFILESTORE_KEY', 'JWT_SECRET_HEX']

// Pure, testable. Returns { errors: string[] } so tests can assert.
export function checkComposeSecrets(root) {
  const errors = []
  AUDITED_FILES.forEach((rel) => {
    const abs = path.join(root, rel)
    let body
    try {
      body = readFileSync(abs, 'utf8')
    } catch (e) {
      errors.push(`cannot read ${rel}: ${e.message}`)
      return
    }
    FORBIDDEN_LITERALS.forEach((lit) => {
      if (body.includes(lit)) {
        errors.push(
          `${rel}: forbidden literal present (${lit.slice(0, 16)}…) ` +
            '— replace with a required-from-env reference or strip the default'
        )
      }
    })
    REQUIRED_FROM_ENV.forEach((v) => {
      // Permitted forms:
      //   ${VAR}            - bare reference, fails if unset
      //   ${VAR:?msg}       - explicit required form, fails with a message
      // Forbidden:
      //   ${VAR:-default}   - silently substitutes the default
      //   ${VAR-default}    - silently substitutes when unset
      const re = new RegExp(`\\$\\{${v}:?-`, 'g')
      if (re.test(body)) {
        errors.push(
          `${rel}: ${v} uses default-substitution form (\${${v}:-…} ` +
            `or \${${v}-…}) - switch to required form \${${v}:?message}`
        )
      }
    })
  })
  return { errors }
}

function main() {
  const { errors } = checkComposeSecrets(ROOT_DEFAULT)
  if (errors.length > 0) {
    process.stderr.write(
      `check:compose-secrets — ${errors.length} issue(s):\n` +
        errors.map((e) => `  • ${e}`).join('\n') +
        '\n'
    )
    process.exit(1)
  }
  process.stdout.write('check:compose-secrets — clean\n')
}

// Run only when invoked as the entry point. The unit test imports the
// exported `checkComposeSecrets` directly and never trips this guard.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
