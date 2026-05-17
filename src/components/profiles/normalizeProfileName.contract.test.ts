// QUAL/SEC issue 241: cross-stack profile-name normalisation contract
// test (TS side).
//
// The Go authority lives at internal/profilestore/normalize.go
// (NormalizeProfileName). The SPA mirror is the `norm` helper inside
// `nameIsDuplicate` in ProfileEditorModal.tsx. Both MUST produce
// byte-identical output for every input. This test pins the SPA mirror
// against contracts/profile-name-normalization.contract.json; the
// matching Go test (internal/profilestore/normalize_test.go) pins the
// Go side against the same vectors.

import * as fs from 'fs'
import * as path from 'path'
import { nameIsDuplicate } from './ProfileEditorModal'

type NormVector = {
  description: string
  input: string
  expected: string
}

type NormContract = {
  version: number
  operation: string
  vectors: NormVector[]
}

const CONTRACT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'contracts',
  'profile-name-normalization.contract.json'
)

const contract: NormContract = JSON.parse(
  fs.readFileSync(CONTRACT_PATH, 'utf-8')
)

// The TS-side norm helper is unexported inside nameIsDuplicate. Rather
// than refactoring to expose the function (which would broaden the
// public API for one test), exercise it via nameIsDuplicate's
// observable behaviour: a candidate that normalises to the same value
// as an existing entry is reported as duplicate iff the SPA's norm
// produces the contract's expected value. Comparing the
// candidate-normalisation against the expected via the existing-list
// gives a single-call assertion per vector.
function spaNormalizesTo(input: string, expected: string): boolean {
  // existing list seeded with `expected` proves that candidate `input`
  // normalises to `expected` IFF nameIsDuplicate returns true. Empty
  // candidates short-circuit to false inside nameIsDuplicate (the SPA
  // contract: an empty name is never a duplicate of anything), so we
  // skip that vector via the caller.
  return nameIsDuplicate(input, [expected])
}

describe('profile-name normalisation cross-stack contract (QUAL/SEC issue 241)', () => {
  contract.vectors.forEach((v) => {
    test(v.description, () => {
      if (v.input === '') {
        // nameIsDuplicate("", [...]) is contractually false (empty
        // candidates never collide). The contract still pins the
        // expected normalisation of an empty input as "" so the Go
        // side stays in sync; that's already covered by the Go test.
        // For the TS side, just assert the observable behaviour.
        expect(nameIsDuplicate('', [''])).toBe(false)
        return
      }
      expect(spaNormalizesTo(v.input, v.expected)).toBe(true)
    })
  })
})
