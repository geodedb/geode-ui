import { gqlSpecAnchor } from './gqlSpecIndex'

// GAP-062: lock in the contract that the LSP hover handler reads.

describe('gqlSpecAnchor', () => {
  test('maps MATCH to the core page anchor', () => {
    const a = gqlSpecAnchor('MATCH')
    expect(a?.href).toBe('/docs/gql-core#match')
  })

  test('is case-insensitive', () => {
    expect(gqlSpecAnchor('match')?.href).toBe('/docs/gql-core#match')
    expect(gqlSpecAnchor('Match')?.href).toBe('/docs/gql-core#match')
  })

  test('collapses whitespace in multi-word keys', () => {
    expect(gqlSpecAnchor('CREATE   USER')?.href).toBe(
      '/docs/gql-auth-ddl#create-user'
    )
  })

  test('routes CREATE POLICY to the upstream-deferred page', () => {
    expect(gqlSpecAnchor('CREATE POLICY')?.page).toBe('gql-policies')
  })

  test('returns null for an unknown token', () => {
    expect(gqlSpecAnchor('totally-not-a-keyword')).toBeNull()
  })

  test('handles ORDER BY (whitespace + multi-word)', () => {
    expect(gqlSpecAnchor('ORDER BY')?.anchor).toBe('order-by')
  })
})
