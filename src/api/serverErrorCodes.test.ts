import * as codes from './serverErrorCodes'

describe('serverErrorCodes', () => {
  it('every exported value is a non-empty snake_case string', () => {
    const values = Object.values(codes)
    expect(values.length).toBeGreaterThan(0)
    values.forEach((v) => {
      expect(typeof v).toBe('string')
      expect(v).toMatch(/^[a-z][a-z0-9_]*$/)
    })
  })

  it('exports WIRE_FEATURE_MISSING with the server-contract value', () => {
    expect(codes.WIRE_FEATURE_MISSING).toBe('wire_feature_missing')
  })
})
