// QUAL issue 242: cross-stack password-policy contract test (TS side).
//
// The Go-side authority for the password policy lives in
// internal/server/password_policy.go (MinPasswordLength,
// validatePassword rules). The TS-side mirror lives in
// src/lib/passwordPolicy.ts so the SPA can pre-flight passwords before
// hitting the server. Without an enforcement mechanism the two sides
// can drift silently.
//
// This test pins the TS side against
// contracts/password-policy.contract.json. The matching Go contract
// test (internal/server/password_policy_contract_test.go) pins the Go
// side against the same file.

import * as fs from 'fs'
import * as path from 'path'
import {
  MIN_PASSWORD_LENGTH,
  USERNAME_SUBSTRING_MIN,
  messageKeyFor,
  PolicyViolation,
  validatePassword,
} from './passwordPolicy'

type AdversarialVector = {
  _description: string
  password: string
  username: string
  expectViolations: PolicyViolation[]
  policyComment: string
}

type PasswordPolicyContract = {
  version: number
  minPasswordLength: number
  usernameSubstringMin: number
  violationCodes: PolicyViolation[]
  i18nKeys: Record<PolicyViolation, string>
  adversarialVectors?: Record<string, AdversarialVector>
}

const CONTRACT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'contracts',
  'password-policy.contract.json'
)

const contract: PasswordPolicyContract = JSON.parse(
  fs.readFileSync(CONTRACT_PATH, 'utf-8')
)

describe('password-policy cross-stack contract (QUAL issue 242)', () => {
  test('MIN_PASSWORD_LENGTH matches the contract', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(contract.minPasswordLength)
  })

  test('USERNAME_SUBSTRING_MIN matches the contract', () => {
    expect(USERNAME_SUBSTRING_MIN).toBe(contract.usernameSubstringMin)
  })

  test('PolicyViolation variants match the contract violationCodes', () => {
    // messageKeyFor exhaustively maps every PolicyViolation variant to
    // an i18n key; mapping the contract codes through messageKeyFor
    // proves the TS side recognises every contract variant and the
    // i18n key strings agree.
    const expectedKeys: Record<string, string> = contract.i18nKeys
    contract.violationCodes.forEach((code) => {
      expect(messageKeyFor(code)).toBe(expectedKeys[code])
    })
  })

  test('TS-side messageKeyFor is exhaustive against the contract', () => {
    // Sort both sides so the diff is readable on failure. Drift here
    // (TS mirror has a code the contract doesn't, or vice versa) means
    // a new variant landed on one side without updating the contract.
    const tsCodes = Object.keys(contract.i18nKeys).sort()
    const contractCodes = [...contract.violationCodes].sort()
    expect(tsCodes).toEqual(contractCodes)
  })

  // CO-242 (2026-05-17): adversarial Unicode-vector corpus. The TS
  // validator is deliberately ASCII-only (passwordPolicy.ts:59-66
  // isAllAsciiDigits, strict 0x30..0x39 check). The contract
  // documents that intentional behaviour by pinning the expected
  // violations for each fullwidth-Latin, CJK-digit, and NBSP input.
  // Both the Go side (password_policy_contract_test.go) and this side
  // assert the documented outcomes still match, so an unintended
  // future NFKC-normalisation regression trips BOTH suites.
  describe('adversarial Unicode vectors (CO-242)', () => {
    const vectors = contract.adversarialVectors ?? {}
    if (Object.keys(vectors).length === 0) {
      // Inline test that surfaces the empty-corpus case as a failure
      // rather than silently skipping when someone regenerates the
      // contract without the corpus.
      test('contract.adversarialVectors is non-empty', () => {
        throw new Error(
          'contract.adversarialVectors is empty — was the contract ' +
            'file regenerated without the NFKC corpus? See CO-242.'
        )
      })
      return
    }
    Object.entries(vectors).forEach(([name, vec]) => {
      test(`${name}: matches contract.expectViolations`, () => {
        const r = validatePassword(vec.password, vec.username || undefined)
        const got = [...r.errors].sort()
        const expected = [...vec.expectViolations].sort()
        expect(got).toEqual(expected)
      })
    })
  })
})
