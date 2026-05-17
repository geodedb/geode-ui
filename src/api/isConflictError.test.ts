import { isConflictError } from './capabilities'
import { CONFLICT } from './serverErrorCodes'

describe('isConflictError', () => {
  it('returns false for non-objects', () => {
    expect(isConflictError(undefined)).toBe(false)
    expect(isConflictError(null)).toBe(false)
    expect(isConflictError('http status 409')).toBe(false)
    expect(isConflictError(409)).toBe(false)
  })

  it('returns true when status === 409', () => {
    expect(isConflictError({ status: 409 })).toBe(true)
  })

  it('returns true when body.error === CONFLICT', () => {
    expect(
      isConflictError({
        status: 500,
        body: { error: CONFLICT, error_description: 'whatever' },
      })
    ).toBe(true)
  })

  it('returns true when body is a JSON string with error === CONFLICT', () => {
    expect(
      isConflictError({
        body: JSON.stringify({
          error: CONFLICT,
          error_description: 'duplicate name',
        }),
      })
    ).toBe(true)
  })

  it('returns true when message text includes "http status 409"', () => {
    expect(
      isConflictError(
        new Error(
          'http status 409: {"error":"conflict","error_description":"profile name already exists in this scope"}'
        )
      )
    ).toBe(true)
  })

  it('returns true when message text embeds the "conflict" error code', () => {
    expect(
      isConflictError(new Error('something happened: "error":"conflict"'))
    ).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isConflictError(new Error('boom'))).toBe(false)
    expect(isConflictError({ status: 500 })).toBe(false)
    expect(isConflictError({ body: { error: 'wire_feature_missing' } })).toBe(
      false
    )
  })
})
