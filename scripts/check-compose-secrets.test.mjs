import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  checkComposeSecrets,
  FORBIDDEN_LITERALS,
  REQUIRED_FROM_ENV,
} from './check-compose-secrets.mjs'

function fixtureRoot(composeBody) {
  const root = mkdtempSync(path.join(tmpdir(), 'compose-secrets-'))
  mkdirSync(path.join(root, 'deploy'))
  writeFileSync(
    path.join(root, 'deploy', 'docker-compose.test.yml'),
    composeBody,
    'utf8'
  )
  return root
}

test('flags the pre-fix forbidden literals (regression for #322/#323)', () => {
  // Fixture YAML must contain literal `${VAR:-default}` shell syntax —
  // these are template literals from JS's perspective (note the
  // escaped `\${...}` form), so eslint's `no-template-curly-in-string`
  // doesn't trip. We construct via backtick template-literal syntax to
  // splice the FORBIDDEN_LITERALS values without re-encoding them.
  const root = fixtureRoot(
    [
      'services:',
      '  geode-ui:',
      '    environment:',
      `      GEODE_PROFILESTORE_KEY: \${GEODE_PROFILESTORE_KEY:-${FORBIDDEN_LITERALS[0]}}`,
      '    command:',
      '    - -jwt-secret-hex',
      `    - \${JWT_SECRET_HEX:-${FORBIDDEN_LITERALS[1]}}`,
      '',
    ].join('\n')
  )
  try {
    const { errors } = checkComposeSecrets(root)
    // One error per forbidden literal + one per env var still using
    // default-substitution form. Both vars use `${VAR:-default}`, so we
    // expect at least 4 distinct findings (2 literal + 2 form).
    assert.ok(
      errors.length >= 4,
      `expected >=4 errors, got ${errors.length}: ${JSON.stringify(errors)}`
    )
    assert.ok(
      errors.some((e) => e.includes('forbidden literal')),
      'expected a "forbidden literal" error'
    )
    assert.ok(
      errors.some((e) => e.includes('GEODE_PROFILESTORE_KEY')),
      'expected a GEODE_PROFILESTORE_KEY error'
    )
    assert.ok(
      errors.some((e) => e.includes('JWT_SECRET_HEX')),
      'expected a JWT_SECRET_HEX error'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('passes when every secret is required-from-env (no default)', () => {
  // The fixture YAML literals carry `${VAR:?msg}` shell-interpolation
  // syntax — eslint's `no-template-curly-in-string` would mis-flag these
  // as "you meant a template literal". They are literal compose syntax;
  // disable the rule for the fixture-construction block.
  const root = fixtureRoot(
    /* eslint-disable no-template-curly-in-string */
    [
      'services:',
      '  geode-ui:',
      '    environment:',
      '      GEODE_PROFILESTORE_KEY: ${GEODE_PROFILESTORE_KEY:?GEODE_PROFILESTORE_KEY must be set for the test stack}',
      '    command:',
      '    - -jwt-secret-hex',
      '    - ${JWT_SECRET_HEX:?JWT_SECRET_HEX must be set for the test stack}',
      '',
    ].join('\n')
    /* eslint-enable no-template-curly-in-string */
  )
  try {
    const { errors } = checkComposeSecrets(root)
    assert.deepEqual(errors, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('flags default-substitution form even when the default is non-literal', () => {
  // A future contributor might "fix" the literal by parameterising the
  // default but keep `:-` — that still defeats compose's fail-loud
  // behaviour when the operator forgets to set the env. The gate must
  // catch that regression too.
  const root = fixtureRoot(
    /* eslint-disable no-template-curly-in-string */
    [
      'services:',
      '  geode-ui:',
      '    environment:',
      '      GEODE_PROFILESTORE_KEY: ${GEODE_PROFILESTORE_KEY:-some-other-placeholder}',
      '',
    ].join('\n')
    /* eslint-enable no-template-curly-in-string */
  )
  try {
    const { errors } = checkComposeSecrets(root)
    assert.ok(
      errors.some(
        (e) =>
          e.includes('GEODE_PROFILESTORE_KEY') && e.includes('required form')
      ),
      `expected a "required form" error, got ${JSON.stringify(errors)}`
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('REQUIRED_FROM_ENV pins both load-bearing secrets', () => {
  assert.ok(REQUIRED_FROM_ENV.includes('GEODE_PROFILESTORE_KEY'))
  assert.ok(REQUIRED_FROM_ENV.includes('JWT_SECRET_HEX'))
})
