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
