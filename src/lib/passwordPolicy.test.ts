import {
  MIN_PASSWORD_LENGTH,
  USERNAME_SUBSTRING_MIN,
  messageKeyFor,
  validatePassword,
} from './passwordPolicy'

describe('validatePassword', () => {
  describe('rule 1: minimum length', () => {
    it(`flags tooShort when pw is below ${MIN_PASSWORD_LENGTH} chars`, () => {
      const r = validatePassword('shortpw') // 7 chars
      expect(r.valid).toBe(false)
      expect(r.errors).toContain('tooShort')
    })

    it(`accepts the floor exactly at ${MIN_PASSWORD_LENGTH} chars`, () => {
      // mixed-class to avoid the weakPattern rule
      const r = validatePassword('Abcdef1234!@')
      expect(r.valid).toBe(true)
    })
  })

  describe('rule 2: weak pattern (all-same / all-digits)', () => {
    it('flags all-same-character passwords', () => {
      const r = validatePassword('aaaaaaaaaaaa')
      expect(r.errors).toContain('weakPattern')
    })

    it('flags all-digit passwords (ASCII)', () => {
      const r = validatePassword('123456789012')
      expect(r.errors).toContain('weakPattern')
    })

    it('does NOT flag mixed alphanumeric passwords', () => {
      const r = validatePassword('Abcd1234!@xy')
      expect(r.errors).not.toContain('weakPattern')
    })

    it('does NOT flag CJK digits (matches server strict-ASCII rule)', () => {
      // Fullwidth digits aren't ASCII 0-9 so the rule should NOT fire.
      const r = validatePassword('123456789012'.replace(/0/g, '０'))
      expect(r.errors).not.toContain('weakPattern')
    })
  })

  describe('rule 3: username substring', () => {
    it('flags when password contains username (case-insensitive)', () => {
      const r = validatePassword('AliceSecret123!', 'alice')
      expect(r.errors).toContain('containsUsername')
    })

    it('flags when username case differs from password case', () => {
      const r = validatePassword('aliceSecret123!', 'ALICE')
      expect(r.errors).toContain('containsUsername')
    })

    it(`does NOT activate the rule when username < ${USERNAME_SUBSTRING_MIN} chars`, () => {
      const r = validatePassword('alSomethingPwd!', 'al')
      expect(r.errors).not.toContain('containsUsername')
    })

    it('does NOT flag when username substring is absent', () => {
      const r = validatePassword('UnrelatedPwd123!', 'alice')
      expect(r.errors).not.toContain('containsUsername')
    })

    it('does NOT activate when username is unprovided', () => {
      const r = validatePassword('AliceSecret123!')
      expect(r.errors).not.toContain('containsUsername')
    })
  })

  describe('aggregation', () => {
    it('returns all violations at once (not first-fail)', () => {
      // too-short AND contains username
      const r = validatePassword('alice', 'alice')
      expect(r.errors).toEqual(
        expect.arrayContaining(['tooShort', 'containsUsername'])
      )
    })

    it('valid === true iff errors.length === 0', () => {
      const ok = validatePassword('Abcdef1234!@xyz')
      expect(ok.valid).toBe(true)
      expect(ok.errors).toHaveLength(0)
    })
  })

  describe('messageKeyFor', () => {
    it('maps each violation to an i18n key', () => {
      expect(messageKeyFor('tooShort')).toBe('users.passwordTooShort')
      expect(messageKeyFor('weakPattern')).toBe('users.passwordWeakPattern')
      expect(messageKeyFor('containsUsername')).toBe(
        'users.passwordContainsUsername'
      )
    })
  })
})
