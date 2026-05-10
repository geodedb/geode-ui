// PSR-G09 (#86) — pin the JWT-claims decoder contract.
//
// The decoder must:
//   1. Extract the roles claim from a well-formed HS256 JWT.
//   2. Tolerate malformed input (return null / empty array, never throw).
//   3. Tolerate base64url padding edge cases.
//   4. Ignore non-string entries inside roles.
//   5. Round-trip multi-byte characters in display names (sub/profile).

import { decodeJwtClaims, extractRoles } from './jwt-claims'

function makeJwt(payload: Record<string, unknown>): string {
  // Synthesise a valid-shape JWT (header.payload.signature). Signature
  // is bogus — the client decoder doesn't verify, so any non-empty
  // string survives.
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64Url(JSON.stringify(payload))
  return `${header}.${body}.fake-signature`
}

function base64Url(s: string): string {
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

describe('decodeJwtClaims', () => {
  test('extracts sub / profile / roles / cid', () => {
    const token = makeJwt({
      sub: 'alice',
      profile: 'prod',
      roles: ['admin', 'reader'],
      cid: 'cid-1',
      iat: 1700000000,
      exp: 1700003600,
    })
    const claims = decodeJwtClaims(token)
    expect(claims).toEqual({
      sub: 'alice',
      profile: 'prod',
      roles: ['admin', 'reader'],
      cid: 'cid-1',
      iat: 1700000000,
      exp: 1700003600,
    })
  })

  test('returns null for malformed input', () => {
    expect(decodeJwtClaims(null)).toBeNull()
    expect(decodeJwtClaims(undefined)).toBeNull()
    expect(decodeJwtClaims('')).toBeNull()
    expect(decodeJwtClaims('not-a-jwt')).toBeNull()
    expect(decodeJwtClaims('only.two')).toBeNull()
    expect(decodeJwtClaims('aaa.!!!.bbb')).toBeNull()
    // Payload that decodes to non-JSON.
    expect(
      decodeJwtClaims(`${base64Url('{}')}.${base64Url('garbage')}.sig`)
    ).toBeNull()
  })

  test('returns claims even when roles is missing', () => {
    const token = makeJwt({ sub: 'alice' })
    const claims = decodeJwtClaims(token)
    expect(claims).toEqual({ sub: 'alice' })
  })

  test('drops non-string entries inside roles', () => {
    const token = makeJwt({ roles: ['admin', 42, null, 'reader'] })
    expect(decodeJwtClaims(token)?.roles).toEqual(['admin', 'reader'])
  })

  test('handles base64url padding edge cases', () => {
    // Three bytes => no padding; one byte => "==" padding stripped.
    const token = makeJwt({ sub: 'a' })
    expect(decodeJwtClaims(token)?.sub).toBe('a')
  })

  test('round-trips multi-byte unicode in claims', () => {
    const token = makeJwt({
      sub: 'δοκιμή',
      profile: '日本語',
      roles: ['αδμιν'],
    })
    const claims = decodeJwtClaims(token)
    expect(claims?.sub).toBe('δοκιμή')
    expect(claims?.profile).toBe('日本語')
    expect(claims?.roles).toEqual(['αδμιν'])
  })
})

describe('extractRoles', () => {
  test('returns the roles array on well-formed input', () => {
    const token = makeJwt({ roles: ['admin', 'reader'] })
    expect(extractRoles(token)).toEqual(['admin', 'reader'])
  })

  test('returns an empty array on malformed input or missing roles', () => {
    expect(extractRoles(null)).toEqual([])
    expect(extractRoles(undefined)).toEqual([])
    expect(extractRoles('')).toEqual([])
    expect(extractRoles('not-a-jwt')).toEqual([])
    expect(extractRoles(makeJwt({}))).toEqual([])
  })
})
