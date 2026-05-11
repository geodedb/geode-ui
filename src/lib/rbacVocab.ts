// Static RBAC vocabulary mirroring Geode's own enums. Geode exposes no
// SHOW PERMISSIONS / SHOW ROLES introspection over the wire, so these
// lists are hand-maintained against the authoritative source:
//   ~/src/devnw/codepros/geode/geode/src/security/geode_auth_lib.zig
//     Action   = enum { create, read, update, delete, execute, grant, revoke, all }
//     Resource = enum { graph, node, edge, property, index, user, role, permission, query, transaction, system }
//     RowLevelPolicy.Operation = enum { select, insert, update, delete, all }
//
// The CLI convention for a permission string is `<action>:<resource>`
// (e.g. `read:users`, `read:graph`) or a bare action keyword. Geode
// persists the string verbatim (see auth_cli.zig cmdGrant), so these
// are *suggestions* for autocomplete — free text is still accepted.

export const RBAC_ACTIONS = [
  'create',
  'read',
  'update',
  'delete',
  'execute',
  'grant',
  'revoke',
  'all',
] as const

export const RBAC_RESOURCES = [
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
] as const

export const RBAC_GRANTEE_KINDS = ['user', 'role'] as const

export const RLS_OPERATIONS = [
  'select',
  'insert',
  'update',
  'delete',
  'all',
] as const

export type RbacAction = (typeof RBAC_ACTIONS)[number]
export type RbacResource = (typeof RBAC_RESOURCES)[number]
export type RbacGranteeKind = (typeof RBAC_GRANTEE_KINDS)[number]
export type RlsOperation = (typeof RLS_OPERATIONS)[number]

// permissionSuggestions returns the `<action>:<resource>` cross-product
// plus the bare action keywords, deduplicated — suitable for the
// <datalist> backing the grant/role permission fields. The order is
// stable (cross-product first, then bare actions) so snapshot-style
// tests can rely on it, but callers should treat it as an unordered set.
export function permissionSuggestions(): string[] {
  const crossProduct = RBAC_ACTIONS.flatMap((action) =>
    RBAC_RESOURCES.map((resource) => `${action}:${resource}`)
  )
  // Dedup while preserving order: cross-product entries first, then the
  // bare action keywords (none of which collide with an `a:r` pair).
  return Array.from(new Set([...crossProduct, ...RBAC_ACTIONS]))
}
