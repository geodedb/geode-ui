import {
  fromWireProfile,
  isWireProfile,
  toWireCreateRequest,
  toWireUpdateRequest,
} from './profiles'

test('fromWireProfile parses tls and pool_overrides from object inputs', () => {
  const wire = {
    id: 'abc',
    scope: 'personal',
    owner_user_id: 'alice',
    name: 'p1',
    dsn: 'quic://x',
    description: 'desc',
    saved_username: 'alice',
    is_default: true,
    tls: { ca_pem: '---CA---', client_cert_pem: '', client_key_pem: '' },
    pool_overrides: { max_open_conns: 32, conn_max_lifetime_ms: 90000 },
  }
  const got = fromWireProfile(wire)
  expect(got.id).toBe('abc')
  expect(got.scope).toBe('personal')
  expect(got.tls?.caPem).toBe('---CA---')
  expect(got.poolOverrides?.maxOpenConns).toBe(32)
  expect(got.poolOverrides?.connMaxLifetimeMs).toBe(90_000)
})

test('fromWireProfile also accepts legacy string inputs (defensive)', () => {
  const wire = {
    id: 'abc',
    scope: 'personal',
    name: 'p1',
    is_default: false,
    tls: '{"ca_pem":"X"}',
    pool_overrides: '{"max_open_conns":8}',
  }
  const got = fromWireProfile(wire)
  expect(got.tls?.caPem).toBe('X')
  expect(got.poolOverrides?.maxOpenConns).toBe(8)
})

test('toWireCreateRequest emits tls/pool_overrides as nested objects', () => {
  const got = toWireCreateRequest({
    scope: 'system',
    name: 'p',
    dsn: 'quic://x:1',
    isDefault: false,
    tls: { caPem: 'CA' },
    poolOverrides: { maxOpenConns: 16 },
  })
  expect(got.scope).toBe('system')
  expect(got.tls).toEqual({ ca_pem: 'CA' })
  expect(got.pool_overrides).toEqual({ max_open_conns: 16 })
})

test('toWireUpdateRequest omits keys that were not provided', () => {
  const got = toWireUpdateRequest({ description: 'new' })
  expect(got.description).toBe('new')
  expect(got.tls).toBeUndefined()
  expect(got.pool_overrides).toBeUndefined()
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

test('toWireUpdateRequest emits pool_overrides:{} when caller passes empty PoolOverrides (clear)', () => {
  const got = toWireUpdateRequest({ poolOverrides: {} })
  expect(got).toHaveProperty('pool_overrides')
  expect(got.pool_overrides).toEqual({})
})

test('toWireUpdateRequest preserves explicit nonzero TLS / pool fields', () => {
  const got = toWireUpdateRequest({
    tls: { caPem: 'CA' },
    poolOverrides: { maxOpenConns: 8 },
  })
  expect(got.tls).toEqual({ ca_pem: 'CA' })
  expect(got.pool_overrides).toEqual({ max_open_conns: 8 })
})

test('toWireUpdateRequest set->clear round-trip for TLS', () => {
  // First call: set CA PEM
  const set = toWireUpdateRequest({ tls: { caPem: 'X' } })
  expect(set.tls).toEqual({ ca_pem: 'X' })
  // Second call: clear by passing empty
  const clear = toWireUpdateRequest({ tls: {} })
  expect(clear.tls).toEqual({})
})

test('toWireUpdateRequest set->clear round-trip for pool overrides', () => {
  const set = toWireUpdateRequest({ poolOverrides: { maxOpenConns: 16 } })
  expect(set.pool_overrides).toEqual({ max_open_conns: 16 })
  const clear = toWireUpdateRequest({ poolOverrides: {} })
  expect(clear.pool_overrides).toEqual({})
})

// PSR-G02-followup (#124): nullable scalar fields. With genapi now
// emitting *string / *bool, the SPA can express:
//   - absent          (input key undefined) -> wire key omitted
//   - clear-to-empty  (input key '')        -> wire key present with ''
//   - set-to-value    (input key 'foo')     -> wire key present with 'foo'
//
// And for is_default:
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

test('toWireUpdateRequest distinguishes absent vs explicit false for is_default', () => {
  const absent = toWireUpdateRequest({})
  expect(absent).not.toHaveProperty('is_default')

  const cleared = toWireUpdateRequest({ isDefault: false })
  expect(cleared).toHaveProperty('is_default')
  expect(cleared.is_default).toBe(false)

  const set = toWireUpdateRequest({ isDefault: true })
  expect(set.is_default).toBe(true)
})

test('toWireUpdateRequest distinguishes absent vs explicit empty for saved_username and dsn', () => {
  const absent = toWireUpdateRequest({})
  expect(absent).not.toHaveProperty('saved_username')
  expect(absent).not.toHaveProperty('dsn')

  const cleared = toWireUpdateRequest({ savedUsername: '', dsn: '' })
  expect(cleared.saved_username).toBe('')
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
