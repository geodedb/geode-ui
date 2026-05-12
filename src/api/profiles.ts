import { client } from './client'

export type Scope = 'system' | 'personal'

export interface TLSMaterial {
  caPem?: string
  clientCertPem?: string
  clientKeyPem?: string
}

export interface PoolOverrides {
  maxOpenConns?: number
  maxIdleConns?: number
  connMaxLifetimeMs?: number
  connMaxIdleMs?: number
}

export interface ProfileView {
  id: string
  scope: Scope
  ownerUserId?: string
  name: string
  dsn?: string
  description?: string
  savedUsername?: string
  isDefault: boolean
  tls?: TLSMaterial
  poolOverrides?: PoolOverrides
}

export interface CreateProfileInput {
  scope: Scope
  name: string
  dsn: string
  description?: string
  savedUsername?: string
  isDefault: boolean
  tls?: TLSMaterial
  poolOverrides?: PoolOverrides
}

export type UpdateProfileInput = Partial<Omit<CreateProfileInput, 'scope'>>

// parseMaybe coerces an unknown wire value into a plain object, handling
// both the legacy string-encoded form (jsontext.Value serialised as a JSON
// string token) and the current object form (nested JSON object).
function parseMaybe(v: unknown): Record<string, unknown> | null {
  if (!v) return null
  if (typeof v === 'string') {
    if (v.length === 0) return null
    try {
      const parsed = JSON.parse(v) as unknown
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  if (typeof v === 'object') return v as Record<string, unknown>
  return null
}

function parseTls(raw: unknown): TLSMaterial | undefined {
  const obj = parseMaybe(raw)
  if (!obj) return undefined
  return {
    caPem: (obj.ca_pem as string | undefined) || undefined,
    clientCertPem: (obj.client_cert_pem as string | undefined) || undefined,
    clientKeyPem: (obj.client_key_pem as string | undefined) || undefined,
  }
}

function parsePoolOverrides(raw: unknown): PoolOverrides | undefined {
  const obj = parseMaybe(raw)
  if (!obj) return undefined
  return {
    maxOpenConns: obj.max_open_conns as number | undefined,
    maxIdleConns: obj.max_idle_conns as number | undefined,
    connMaxLifetimeMs: obj.conn_max_lifetime_ms as number | undefined,
    connMaxIdleMs: obj.conn_max_idle_ms as number | undefined,
  }
}

// WireProfile mirrors the server's Profile shape (see
// gen/types/types.gen.go:614 `type Profile struct`). All scalar fields
// are present on the wire (the server emits zero values rather than
// omitting keys), so they are typed required-but-possibly-empty.
// `tls` and `pool_overrides` arrive as either a nested JSON object
// (current server output) or a JSON-encoded string (legacy / test
// form); typed `unknown` here so `parseTls` / `parsePoolOverrides`
// own the narrowing.
//
// IMPORTANT: this type is the SPA's view of the wire contract, not a
// re-export of the genapi Go struct. If `gen/types/types.gen.go`'s
// Profile shape changes, this type and `fromWireProfile` below must
// move with it. Keeping it co-located with `fromWireProfile` avoids
// the indirection of a separate types file for one consumer.
export type WireProfile = {
  id?: string
  scope?: string
  owner_user_id?: string
  name?: string
  dsn?: string
  description?: string
  saved_username?: string
  is_default?: boolean
  tls?: unknown
  pool_overrides?: unknown
}

// isWireProfile narrows an unknown value to WireProfile.
//
// The narrowing is intentionally permissive on the scalar fields --
// the server already gates the schema; this guard's job is to fail
// closed on shapes that aren't even objects (null, arrays, strings,
// numbers, undefined). Once we're inside an object, every field is
// optional on the wire (the genapi-emitted struct emits zero values
// silently) so the narrowing accepts a partial shape and lets
// `fromWireProfile` apply the per-field defaults.
//
// Closes the same parser-fail-closed contract that the server-side
// PEM validator (GAP-S10) enforces in the other direction.
export function isWireProfile(x: unknown): x is WireProfile {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

// fromWireProfile parses the server's Profile shape into the SPA's typed
// ProfileView. tls and pool_overrides are accepted as either a nested JSON
// object (current server output) or a JSON-encoded string (legacy/test
// form), so the two sides can be deployed independently.
//
// Closes GAP-Q1 (#89): the parameter is typed `unknown`, narrowed via
// `isWireProfile`. A non-object input (null, array, string, number,
// undefined) returns the SPA's all-empty default ProfileView rather
// than crashing on `wire.id` indirection. The previous `any` type
// silently swallowed shape errors at the type layer; `unknown` forces
// every consumer through the narrowing guard.
export function fromWireProfile(wire: unknown): ProfileView {
  if (!isWireProfile(wire)) {
    return {
      id: '',
      scope: 'system',
      name: '',
      isDefault: false,
    }
  }
  return {
    id: wire.id ?? '',
    scope: (wire.scope ?? 'system') as Scope,
    ownerUserId: wire.owner_user_id || undefined,
    name: wire.name ?? '',
    dsn: wire.dsn || undefined,
    description: wire.description || undefined,
    savedUsername: wire.saved_username || undefined,
    isDefault: !!wire.is_default,
    tls: parseTls(wire.tls),
    poolOverrides: parsePoolOverrides(wire.pool_overrides),
  }
}

type WireTLS = {
  ca_pem?: string
  client_cert_pem?: string
  client_key_pem?: string
}
// tlsToWire serialises the SPA TLSMaterial onto the JSON wire shape.
//
// PSR-G02 contract:
//   - undefined input -> undefined output (caller did not provide the key
//     at all; PATCH should leave the server-side TLS material untouched).
//   - defined input (even with all-empty fields) -> always returns an
//     object (possibly empty `{}`); the server treats `{}` as an
//     explicit "clear all TLS material" instruction.
//
// Pre-fix this function collapsed both shapes to undefined, which made
// PATCH unable to clear previously-stored CA/cert/key PEM.
function tlsToWire(t?: TLSMaterial): WireTLS | undefined {
  if (t === undefined) return undefined
  const out: WireTLS = {}
  if (t.caPem) out.ca_pem = t.caPem
  if (t.clientCertPem) out.client_cert_pem = t.clientCertPem
  if (t.clientKeyPem) out.client_key_pem = t.clientKeyPem
  return out
}

type WirePO = {
  max_open_conns?: number
  max_idle_conns?: number
  conn_max_lifetime_ms?: number
  conn_max_idle_ms?: number
}
// poToWire mirrors tlsToWire's PSR-G02 contract: undefined means
// "absent" (preserve server state); a defined object (even an empty
// one) means the caller explicitly intends the new state, so an empty
// `{}` clears every override on the server.
function poToWire(o?: PoolOverrides): WirePO | undefined {
  if (o === undefined) return undefined
  const out: WirePO = {}
  if (o.maxOpenConns !== undefined) out.max_open_conns = o.maxOpenConns
  if (o.maxIdleConns !== undefined) out.max_idle_conns = o.maxIdleConns
  if (o.connMaxLifetimeMs !== undefined) {
    out.conn_max_lifetime_ms = o.connMaxLifetimeMs
  }
  if (o.connMaxIdleMs !== undefined) out.conn_max_idle_ms = o.connMaxIdleMs
  return out
}

export function toWireCreateRequest(
  input: CreateProfileInput
): Record<string, unknown> {
  return {
    scope: input.scope,
    name: input.name,
    dsn: input.dsn,
    description: input.description ?? '',
    saved_username: input.savedUsername ?? '',
    is_default: input.isDefault,
    tls: tlsToWire(input.tls),
    pool_overrides: poToWire(input.poolOverrides),
  }
}

export function toWireUpdateRequest(
  input: UpdateProfileInput
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (input.name !== undefined) out.name = input.name
  if (input.dsn !== undefined) out.dsn = input.dsn
  if (input.description !== undefined) out.description = input.description
  if (input.savedUsername !== undefined) {
    out.saved_username = input.savedUsername
  }
  if (input.isDefault !== undefined) out.is_default = input.isDefault
  if (input.tls !== undefined) out.tls = tlsToWire(input.tls)
  if (input.poolOverrides !== undefined) {
    out.pool_overrides = poToWire(input.poolOverrides)
  }
  return out
}

// Higher-level helpers used by the page + editor.

export async function listProfiles(): Promise<ProfileView[]> {
  const r = await client.getProfiles({})
  // GAP-Q1 (#89): fromWireProfile now accepts `unknown` and narrows
  // internally via isWireProfile, so the `as any` cast is gone. The
  // surrounding `as unknown[]` cast persists because the genapi client
  // types `r.profiles` as the legacy WireProfile-shaped struct (Q2 /
  // genapi#216 will let us drop it once the upstream TS templates land).
  return ((r.profiles ?? []) as unknown[]).map((p) => fromWireProfile(p))
}

// NOTE: a single-row `getProfile(id)` helper used to live here. It was
// removed (Q03 / #91) because it had zero callers in the SPA -- the page
// always rehydrates via `listProfiles()` after a mutation. Add it back in
// a focused commit when a caller actually appears (the genapi workaround
// pattern documented above is the template).

export async function createProfile(
  input: CreateProfileInput
): Promise<ProfileView> {
  const r = await client.postProfiles(toWireCreateRequest(input) as any)
  return fromWireProfile(r)
}

export async function updateProfile(
  id: string,
  input: UpdateProfileInput
): Promise<ProfileView> {
  const wire = toWireUpdateRequest(input)
  // genapi#216 (Q02 / #90): the generated client's expandPath now maps the
  // {profileId} URL token to the schema field `profile_id`, so we pass a
  // typed UpdateProfileReq directly -- no `as unknown as {...}` cast.
  const r = await client.patchProfileid({ ...wire, profile_id: id })
  return fromWireProfile(r)
}

export async function deleteProfile(id: string): Promise<void> {
  await client.deleteProfileid({ profile_id: id })
}
