import {
  fromWireProfile,
  isWireProfile,
  toWireCreateRequest,
  toWireUpdateRequest,
} from './profiles'

// genapi 0.11.1: the generated client converts the server's snake_case
// response to camelCase before handing it to fromWireProfile, so these
// inputs use camelCase to mirror what the SPA actually receives at runtime.
test('fromWireProfile parses tls and poolOverrides from object inputs', () => {
  const wire = {
    id: 'abc',
    scope: 'personal',
    ownerUserId: 'alice',
    name: 'p1',
    dsn: 'quic://x',
    description: 'desc',
    savedUsername: 'alice',
    isDefault: true,
    tls: { caPem: '---CA---', clientCertPem: '', clientKeyPem: '' },
    poolOverrides: { maxOpenConns: 32, connMaxLifetimeMs: 90000 },
  }
  const got = fromWireProfile(wire)
  expect(got.id).toBe('abc')
  expect(got.scope).toBe('personal')
  expect(got.tls?.caPem).toBe('---CA---')
  expect(got.poolOverrides?.maxOpenConns).toBe(32)
  expect(got.poolOverrides?.connMaxLifetimeMs).toBe(90_000)
})

// The legacy JSON-STRING form is NOT descended into by the client's
// camel<->snake converter (convertKeys skips string values), so it still
// decodes to snake_case keys. parseTls / parsePoolOverrides accept both.
test('fromWireProfile also accepts legacy string inputs (defensive)', () => {
  const wire = {
    id: 'abc',
    scope: 'personal',
    name: 'p1',
    isDefault: false,
    tls: '{"ca_pem":"X"}',
    poolOverrides: '{"max_open_conns":8}',
  }
  const got = fromWireProfile(wire)
  expect(got.tls?.caPem).toBe('X')
  expect(got.poolOverrides?.maxOpenConns).toBe(8)
})

test('toWireCreateRequest emits tls/poolOverrides as nested camelCase objects', () => {
  const got = toWireCreateRequest({
    scope: 'system',
    name: 'p',
    dsn: 'quic://x:1',
    isDefault: false,
    tls: { caPem: 'CA' },
    poolOverrides: { maxOpenConns: 16 },
  })
  expect(got.scope).toBe('system')
  // The generated client converts these to snake_case (ca_pem /
  // max_open_conns) on the wire; the builder's job is the camelCase DTO.
  expect(got.tls).toEqual({ caPem: 'CA' })
  expect(got.poolOverrides).toEqual({ maxOpenConns: 16 })
})

test('toWireUpdateRequest omits keys that were not provided', () => {
  const got = toWireUpdateRequest({ description: 'new' })
  expect(got.description).toBe('new')
  expect(got.tls).toBeUndefined()
  expect(got.poolOverrides).toBeUndefined()
})

// PSR-G02: clearing TLS material via PATCH must round-trip as
// `tls: {}` on the wire, not `tls: undefined`. The server-side
// jsontext.Value-aware merge distinguishes "key absent" (preserve
// the current TLS) from "key present, all fields empty" (clear all
// TLS material). Pre-fix the SPA collapsed both to undefined.
test('toWireUpdateRequest emits tls:{} when caller passes empty TLS (clear)', () => {
  const got = toWireUpdateRequest({
    tls: { caPem: '', clientCertPem: '', clientKeyPem: '' },
  })
  expect(got).toHaveProperty('tls')
  expect(got.tls).toEqual({})
})

test('toWireUpdateRequest emits poolOverrides:{} when caller passes empty PoolOverrides (clear)', () => {
  const got = toWireUpdateRequest({ poolOverrides: {} })
  expect(got).toHaveProperty('poolOverrides')
  expect(got.poolOverrides).toEqual({})
})

test('toWireUpdateRequest preserves explicit nonzero TLS / pool fields', () => {
  const got = toWireUpdateRequest({
    tls: { caPem: 'CA' },
    poolOverrides: { maxOpenConns: 8 },
  })
  expect(got.tls).toEqual({ caPem: 'CA' })
  expect(got.poolOverrides).toEqual({ maxOpenConns: 8 })
})

test('toWireUpdateRequest set->clear round-trip for TLS', () => {
  // First call: set CA PEM
  const set = toWireUpdateRequest({ tls: { caPem: 'X' } })
  expect(set.tls).toEqual({ caPem: 'X' })
  // Second call: clear by passing empty
  const clear = toWireUpdateRequest({ tls: {} })
  expect(clear.tls).toEqual({})
})

test('toWireUpdateRequest set->clear round-trip for pool overrides', () => {
  const set = toWireUpdateRequest({ poolOverrides: { maxOpenConns: 16 } })
  expect(set.poolOverrides).toEqual({ maxOpenConns: 16 })
  const clear = toWireUpdateRequest({ poolOverrides: {} })
  expect(clear.poolOverrides).toEqual({})
})

// PSR-G02-followup (#124): nullable scalar fields. With genapi now
// emitting *string / *bool, the SPA can express:
//   - absent          (input key undefined) -> wire key omitted
//   - clear-to-empty  (input key '')        -> wire key present with ''
//   - set-to-value    (input key 'foo')     -> wire key present with 'foo'
//
// And for isDefault:
//   - absent (undefined) -> wire key omitted
//   - explicit false     -> wire key present with false (clears default)
//   - explicit true      -> wire key present with true  (sets default)
test('toWireUpdateRequest distinguishes absent vs explicit empty for description', () => {
  // Absent: key omitted
  const absent = toWireUpdateRequest({})
  expect(absent).not.toHaveProperty('description')

  // Explicit '' -> wire key present with empty string (server clears).
  const cleared = toWireUpdateRequest({ description: '' })
  expect(cleared).toHaveProperty('description')
  expect(cleared.description).toBe('')

  // Explicit value -> wire key present with the value.
  const set = toWireUpdateRequest({ description: 'hello' })
  expect(set.description).toBe('hello')
})

test('toWireUpdateRequest distinguishes absent vs explicit false for isDefault', () => {
  const absent = toWireUpdateRequest({})
  expect(absent).not.toHaveProperty('isDefault')

  const cleared = toWireUpdateRequest({ isDefault: false })
  expect(cleared).toHaveProperty('isDefault')
  expect(cleared.isDefault).toBe(false)

  const set = toWireUpdateRequest({ isDefault: true })
  expect(set.isDefault).toBe(true)
})

test('toWireUpdateRequest distinguishes absent vs explicit empty for savedUsername and dsn', () => {
  const absent = toWireUpdateRequest({})
  expect(absent).not.toHaveProperty('savedUsername')
  expect(absent).not.toHaveProperty('dsn')

  const cleared = toWireUpdateRequest({ savedUsername: '', dsn: '' })
  expect(cleared.savedUsername).toBe('')
  expect(cleared.dsn).toBe('')
})

// GAP-Q1 (#89): fromWireProfile previously accepted `wire: any`, which
// silently swallowed shape errors at the type layer; a non-object input
// would crash on `wire.id` indirection. The post-fix signature is
// `(wire: unknown)` with an internal `isWireProfile` narrowing guard.
// Non-object inputs return the SPA's all-empty default ProfileView so
// downstream consumers see a stable shape rather than a runtime throw.
test('isWireProfile rejects non-object inputs', () => {
  expect(isWireProfile(null)).toBe(false)
  expect(isWireProfile(undefined)).toBe(false)
  expect(isWireProfile('a string')).toBe(false)
  expect(isWireProfile(42)).toBe(false)
  expect(isWireProfile(true)).toBe(false)
  expect(isWireProfile([])).toBe(false)
  expect(isWireProfile([{ id: 'x' }])).toBe(false)
})

test('isWireProfile accepts plain objects (including empty)', () => {
  expect(isWireProfile({})).toBe(true)
  expect(isWireProfile({ id: 'x' })).toBe(true)
})

test('fromWireProfile returns safe default ProfileView on non-object input', () => {
  // null / undefined / array / scalar should NOT crash; they should
  // produce the all-empty default shape so downstream consumers see
  // a stable ProfileView. ESLint forbids `for...of` here so we iterate
  // via .forEach.
  const bads: unknown[] = [null, undefined, 'a string', 42, true, []]
  bads.forEach((bad) => {
    const got = fromWireProfile(bad)
    expect(got.id).toBe('')
    expect(got.scope).toBe('system')
    expect(got.name).toBe('')
    expect(got.isDefault).toBe(false)
    expect(got.tls).toBeUndefined()
    expect(got.poolOverrides).toBeUndefined()
  })
})
