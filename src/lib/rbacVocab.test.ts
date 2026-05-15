// Phase-2 reproduction test: the static RBAC vocabulary module derived
// from Geode's own enums (see ~/src/devnw/codepros/geode/geode
// src/security/geode_auth_lib.zig — Action / Resource, and
// RowLevelPolicy.Operation). On current code `src/lib/rbacVocab.ts` does
// not exist, so this import fails ("Cannot find module './rbacVocab'")
// and every assertion below is unreachable — the intended red.
//
// The fixer may rename the module; if so, update the import path. The
// behavioral contract pinned here is: the four value lists exist with
// the documented members, and `permissionSuggestions()` produces the
// `<action>:<resource>` cross-product (plus bare actions) including
// 'read:graph'.
import {
  RBAC_ACTIONS,
  RBAC_RESOURCES,
  RBAC_GRANTEE_KINDS,
  RLS_OPERATIONS,
  permissionSuggestions,
} from './rbacVocab'

test('RBAC_ACTIONS mirrors geode_auth_lib.Action', () => {
  expect([...RBAC_ACTIONS]).toEqual([
    'create',
    'read',
    'update',
    'delete',
    'execute',
    'grant',
    'revoke',
    'all',
  ])
})

test('RBAC_RESOURCES mirrors geode_auth_lib.Resource', () => {
  expect([...RBAC_RESOURCES]).toEqual([
    'graph',
    'node',
    'edge',
    'property',
    'index',
    'user',
    'role',
    'permission',
    'query',
    'transaction',
    'system',
  ])
})

test('RBAC_GRANTEE_KINDS is [user, role]', () => {
  expect([...RBAC_GRANTEE_KINDS]).toEqual(['user', 'role'])
})

test('RLS_OPERATIONS mirrors RowLevelPolicy.Operation', () => {
  expect([...RLS_OPERATIONS]).toEqual([
    'select',
    'insert',
    'update',
    'delete',
    'all',
  ])
})

test('permissionSuggestions() includes the action:resource cross-product', () => {
  const s = permissionSuggestions()
  expect(s).toContain('read:graph')
  expect(s).toContain('create:user')
  expect(s).toContain('delete:edge')
  // Bare actions remain valid permission strings on their own.
  expect(s).toContain('all')
  // Every entry should be a non-empty string; the cross-product alone is
  // 8 * 11 = 88 entries, so the list is comfortably larger than the bare
  // action list.
  expect(s.length).toBeGreaterThanOrEqual(RBAC_ACTIONS.length)
  s.forEach((entry) => {
    expect(typeof entry).toBe('string')
    expect(entry.length).toBeGreaterThan(0)
  })
})
