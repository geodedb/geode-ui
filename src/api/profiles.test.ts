import {
  fromWireProfile,
  toWireCreateRequest,
  toWireUpdateRequest,
} from './profiles'

test('fromWireProfile parses tls and pool_overrides from jsontext.Value strings', () => {
  const wire = {
    id: 'abc',
    scope: 'personal',
    owner_user_id: 'alice',
    name: 'p1',
    dsn: 'quic://x',
    description: 'desc',
    saved_username: 'alice',
    is_default: true,
    tls: '{"ca_pem":"---CA---","client_cert_pem":"","client_key_pem":""}',
    pool_overrides: '{"max_open_conns":32,"conn_max_lifetime_ms":90000}',
  }
  const got = fromWireProfile(wire)
  expect(got.id).toBe('abc')
  expect(got.scope).toBe('personal')
  expect(got.tls?.caPem).toBe('---CA---')
  expect(got.poolOverrides?.maxOpenConns).toBe(32)
  expect(got.poolOverrides?.connMaxLifetimeMs).toBe(90_000)
})

test('toWireCreateRequest serialises tls/pool_overrides as JSON strings', () => {
  const got = toWireCreateRequest({
    scope: 'system',
    name: 'p',
    dsn: 'quic://x:1',
    isDefault: false,
    tls: { caPem: 'CA' },
    poolOverrides: { maxOpenConns: 16 },
  })
  expect(got.scope).toBe('system')
  expect(typeof got.tls).toBe('string')
  expect(JSON.parse(got.tls as string)).toEqual({ ca_pem: 'CA' })
  expect(JSON.parse(got.pool_overrides as string)).toEqual({
    max_open_conns: 16,
  })
})

test('toWireUpdateRequest omits keys that were not provided', () => {
  const got = toWireUpdateRequest({ description: 'new' })
  expect(got.description).toBe('new')
  expect(got.tls).toBeUndefined()
  expect(got.pool_overrides).toBeUndefined()
})
