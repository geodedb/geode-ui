import type { RandomSource } from './passwordGenerator'
import { generatePassword } from './passwordGenerator'
import { MIN_PASSWORD_LENGTH, validatePassword } from './passwordPolicy'

// jsdom (>= 20) ships a usable `crypto.getRandomValues` so the
// generator runs natively in jest. The tests below double-check the
// API contract rather than the underlying entropy source.

describe('generatePassword', () => {
  it('defaults to length 20', () => {
    const pw = generatePassword()
    expect(pw.length).toBe(20)
  })

  it('honours an explicit length opt', () => {
    const pw = generatePassword({ length: 32 })
    expect(pw.length).toBe(32)
  })

  it('clamps length up to the minimum policy floor', () => {
    const pw = generatePassword({ length: 4 })
    expect(pw.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH)
  })

  it('returns a string that passes validatePassword by construction', () => {
    for (let i = 0; i < 32; i += 1) {
      const pw = generatePassword()
      const result = validatePassword(pw)
      expect(result.valid).toBe(true)
    }
  })

  it('contains at least one of each character class', () => {
    for (let i = 0; i < 16; i += 1) {
      const pw = generatePassword()
      expect(/[a-z]/.test(pw)).toBe(true)
      expect(/[A-Z]/.test(pw)).toBe(true)
      expect(/[0-9]/.test(pw)).toBe(true)
      // Symbol pool: !@#$%^&*()-_=+
      expect(/[!@#$%^&*()\-_=+]/.test(pw)).toBe(true)
    }
  })

  it('does not contain the supplied username substring (case-insensitive)', () => {
    const username = 'alice'
    for (let i = 0; i < 32; i += 1) {
      const pw = generatePassword({ username })
      expect(pw.toLowerCase()).not.toContain(username.toLowerCase())
    }
  })

  it('produces different outputs across calls (very-high probability)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 32; i += 1) {
      seen.add(generatePassword())
    }
    // 32 random 20-char strings from a 70-char pool collide with
    // vanishingly small probability; any non-trivial repeat is a real
    // bug in the entropy plumbing.
    expect(seen.size).toBe(32)
  })

  it('throws when crypto.getRandomValues is unavailable', () => {
    const original = globalThis.crypto
    // Strip crypto for the duration of this test only.
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
    })
    try {
      expect(() => generatePassword()).toThrow(/crypto.getRandomValues/i)
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: original,
        configurable: true,
      })
    }
  })
})

// QUAL #244: when the username-substring retry budget is exhausted, the
// previous fallback path returned a longer candidate *without* running
// validatePassword on it. If a pathological policy rejects every
// possible candidate (real cases: HIBP says yes, length floor not met,
// etc. in the generator's seam world), the caller would receive a
// password that the server then rejects with a 400 — silently.
//
// The fix re-validates the fallback and throws when the budget is
// truly exhausted. The test mocks the validatePassword export so it
// always returns invalid, exercises the fallback, and asserts the
// generator throws rather than returning an unvalidated candidate.
describe('generatePassword fallback re-validation (QUAL #244)', () => {
  // Mock the module so every validatePassword call returns invalid.
  // jest.isolateModules lets us re-load the generator against the
  // mock without polluting the other tests in this file.
  it('throws when validatePassword can never accept a candidate', () => {
    jest.isolateModules(() => {
      jest.doMock('./passwordPolicy', () => {
        const actual =
          jest.requireActual<typeof import('./passwordPolicy')>(
            './passwordPolicy'
          )
        return {
          ...actual,
          validatePassword: (): { valid: false; errors: string[] } => ({
            valid: false,
            errors: ['containsUsername'],
          }),
        }
      })
      // Pull the generator AFTER the mock is installed so it captures
      // the mocked validatePassword binding. The synchronous require()
      // is required by jest.isolateModules — dynamic import() would
      // bypass the isolation scope.
      const { generatePassword: gen } =
        // eslint-disable-next-line global-require
        require('./passwordGenerator') as typeof import('./passwordGenerator')
      expect(() => gen({ username: 'alice' })).toThrow(
        /passwordGenerator: exhausted retry budget/i
      )
    })
  })
})

// QUAL #262: the entropy seam is RandomSource (an object exposing
// `getRandomValues(Uint32Array)`). Exporting it + threading it through
// GenerateOptions lets the test suite assert deterministic behaviour
// against a known sequence, eliminating the long-tail flake risk of
// the probabilistic `seen.size === 32` test on slow CI workers while
// keeping the production default backed by `globalThis.crypto`.
describe('generatePassword RandomSource seam (QUAL #262)', () => {
  // sequencedRandom returns a RandomSource that emits a deterministic
  // sequence of Uint32 values. When the caller asks for more values
  // than the seed array supplies, the source cycles through the seed
  // -- so a small fixture exercises the full byte stream the
  // generator consumes.
  function sequencedRandom(seq: number[]): RandomSource {
    let idx = 0
    return {
      getRandomValues<T extends ArrayBufferView | null>(arr: T): T {
        if (arr === null) return arr
        const u32 = new Uint32Array(
          (arr as ArrayBufferView).buffer,
          (arr as ArrayBufferView).byteOffset,
          (arr as ArrayBufferView).byteLength / 4
        )
        for (let i = 0; i < u32.length; i += 1) {
          u32[i] = seq[idx % seq.length]!
          idx += 1
        }
        return arr
      },
    }
  }

  it('with a fixed seed sequence, returns a canonical password', () => {
    // A simple monotonically-increasing seed so pickIndex pulls the
    // same offsets every time the generator is called with the same
    // length.
    const rand = sequencedRandom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const a = generatePassword({ length: 16, rand })
    const b = generatePassword({
      length: 16,
      rand: sequencedRandom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    })
    // Deterministic seam: identical seed produces identical password.
    expect(a).toBe(b)
    expect(a.length).toBe(16)
  })

  it('with a deterministic source, output still passes validatePassword', () => {
    // A varied seed covers all four character pools at least once so
    // the validity rules (class mixing, min length) are met.
    const rand = sequencedRandom([
      0x11111111, 0x22222222, 0x33333333, 0x44444444, 0x55555555, 0x66666666,
      0x77777777, 0x88888888, 0x99999999, 0xaaaaaaaa, 0xbbbbbbbb, 0xcccccccc,
      0xdddddddd, 0xeeeeeeee, 0xffffff0f,
    ])
    const pw = generatePassword({ length: 20, rand })
    expect(validatePassword(pw).valid).toBe(true)
    // Class-mixing still holds: every pool is represented exactly
    // because buildOnce forces one character from each class.
    expect(/[a-z]/.test(pw)).toBe(true)
    expect(/[A-Z]/.test(pw)).toBe(true)
    expect(/[0-9]/.test(pw)).toBe(true)
    expect(/[!@#$%^&*()\-_=+]/.test(pw)).toBe(true)
  })

  it('username-substring rule still holds with a deterministic source', () => {
    // Even a deterministic seed must not emit a password that
    // contains the supplied username substring -- the rejection loop
    // is independent of entropy.
    const rand = sequencedRandom([42, 1337, 7, 99, 100, 200, 300, 400, 500])
    const pw = generatePassword({ length: 20, rand, username: 'admin' })
    expect(pw.toLowerCase()).not.toContain('admin')
  })

  it('default rand still resolves to globalThis.crypto when none supplied', () => {
    // Sanity: opts without `rand` still works because the production
    // default is unchanged.
    const pw = generatePassword({ length: 16 })
    expect(pw.length).toBe(16)
    expect(validatePassword(pw).valid).toBe(true)
  })
})
