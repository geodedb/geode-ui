// QUALITY #231: import the generated `Profile` shape so the API call
// site is typed against the wire contract directly. fromWireProfile()
// still accepts `unknown` to keep the parser fail-closed, but the
// listProfiles() reader no longer carries the legacy `unknown[]` cast.
//
// genapi 0.11.1: the generated client now performs camelCase<->snake_case
// conversion at the wire boundary -- request bodies are converted
// camelCase->snake_case on the way OUT, responses snake_case->camelCase on
// the way IN (gen/client/react/client.ts: toWire/fromWire). The SPA
// therefore works in camelCase END TO END: the builders below emit
// camelCase DTOs (the client snakes them for the wire) and fromWireProfile
// reads the camelCase response the client hands back. The ONLY snake_case
// the SPA still sees is the LEGACY JSON-STRING form of `tls` /
// `pool_overrides`: convertKeys does not descend into string values, so a
// string-encoded payload decodes to its original snake_case keys. The
// nested parsers below accept EITHER casing to stay robust to both forms.
import type { CreateProfileReq, Profile as GenProfile } from '@api'
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

// parseTls / parsePoolOverrides read the nested object the generated client
// hands back. The current object form arrives camelCase (the client
// converted it); the legacy JSON-STRING form decodes to snake_case (the
// client skips strings). Read camelCase first, fall back to snake_case so
// both forms narrow correctly.
function parseTls(raw: unknown): TLSMaterial | undefined {
  const obj = parseMaybe(raw)
  if (!obj) return undefined
  return {
    caPem: ((obj.caPem ?? obj.ca_pem) as string | undefined) || undefined,
    clientCertPem:
      ((obj.clientCertPem ?? obj.client_cert_pem) as string | undefined) ||
      undefined,
    clientKeyPem:
      ((obj.clientKeyPem ?? obj.client_key_pem) as string | undefined) ||
      undefined,
  }
}

function parsePoolOverrides(raw: unknown): PoolOverrides | undefined {
  const obj = parseMaybe(raw)
  if (!obj) return undefined
  return {
    maxOpenConns: (obj.maxOpenConns ?? obj.max_open_conns) as
      | number
      | undefined,
    maxIdleConns: (obj.maxIdleConns ?? obj.max_idle_conns) as
      | number
      | undefined,
    connMaxLifetimeMs: (obj.connMaxLifetimeMs ?? obj.conn_max_lifetime_ms) as
      | number
      | undefined,
    connMaxIdleMs: (obj.connMaxIdleMs ?? obj.conn_max_idle_ms) as
      | number
      | undefined,
  }
}

// WireProfile mirrors the camelCase Profile the generated client returns
// (gen/client/react/client.ts `interface Profile`). The client already
// converted the server's snake_case response, so every scalar field is
// camelCase here. `tls` and `pool_overrides` arrive as either a nested
// object (current server output, already camelCased) or a JSON-encoded
// string (legacy/test form, still snake_case); typed `unknown` here so
// `parseTls` / `parsePoolOverrides` own the narrowing.
//
// IMPORTANT: this type is the SPA's view of the (post-conversion) client
// contract, not a re-export of the genapi Go struct. If
// `gen/types/types.gen.go`'s Profile shape changes, this type and
// `fromWireProfile` below must move with it.
export type WireProfile = {
  id?: string
  scope?: string
  ownerUserId?: string
  name?: string
  dsn?: string
  description?: string
  savedUsername?: string
  isDefault?: boolean
  tls?: unknown
  poolOverrides?: unknown
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

// fromWireProfile parses the (camelCase) Profile the generated client
// returns into the SPA's typed ProfileView. tls and pool_overrides are
// accepted as either a nested object (current client output) or a
// JSON-encoded string (legacy/test form), so the two sides can be deployed
// independently.
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
    ownerUserId: wire.ownerUserId || undefined,
    name: wire.name ?? '',
    dsn: wire.dsn || undefined,
    description: wire.description || undefined,
    savedUsername: wire.savedUsername || undefined,
    isDefault: !!wire.isDefault,
    tls: parseTls(wire.tls),
    poolOverrides: parsePoolOverrides(wire.poolOverrides),
  }
}

type WireTLS = {
  caPem?: string
  clientCertPem?: string
  clientKeyPem?: string
}
// tlsToWire serialises the SPA TLSMaterial into the camelCase DTO the
// generated client expects; the client converts the keys to snake_case on
// the wire (ca_pem / client_cert_pem / client_key_pem).
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
  if (t.caPem) out.caPem = t.caPem
  if (t.clientCertPem) out.clientCertPem = t.clientCertPem
  if (t.clientKeyPem) out.clientKeyPem = t.clientKeyPem
  return out
}

type WirePO = {
  maxOpenConns?: number
  maxIdleConns?: number
  connMaxLifetimeMs?: number
  connMaxIdleMs?: number
}
// poToWire mirrors tlsToWire's PSR-G02 contract: undefined means
// "absent" (preserve server state); a defined object (even an empty
// one) means the caller explicitly intends the new state, so an empty
// `{}` clears every override on the server. The generated client
// converts the keys to snake_case (max_open_conns / ...) on the wire.
function poToWire(o?: PoolOverrides): WirePO | undefined {
  if (o === undefined) return undefined
  const out: WirePO = {}
  if (o.maxOpenConns !== undefined) out.maxOpenConns = o.maxOpenConns
  if (o.maxIdleConns !== undefined) out.maxIdleConns = o.maxIdleConns
  if (o.connMaxLifetimeMs !== undefined) {
    out.connMaxLifetimeMs = o.connMaxLifetimeMs
  }
  if (o.connMaxIdleMs !== undefined) out.connMaxIdleMs = o.connMaxIdleMs
  return out
}

export function toWireCreateRequest(
  input: CreateProfileInput
): CreateProfileReq {
  return {
    scope: input.scope,
    name: input.name,
    dsn: input.dsn,
    description: input.description ?? '',
    savedUsername: input.savedUsername ?? '',
    isDefault: input.isDefault,
    tls: tlsToWire(input.tls),
    poolOverrides: poToWire(input.poolOverrides),
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
    out.savedUsername = input.savedUsername
  }
  if (input.isDefault !== undefined) out.isDefault = input.isDefault
  if (input.tls !== undefined) out.tls = tlsToWire(input.tls)
  if (input.poolOverrides !== undefined) {
    out.poolOverrides = poToWire(input.poolOverrides)
  }
  return out
}

// Higher-level helpers used by the page + editor.

export async function listProfiles(): Promise<ProfileView[]> {
  const r = await client.getProfiles({})
  // QUALITY #231: `r.profiles` is now typed as `Array<GenProfile>` via
  // the generated `ProfileList` interface (gen/client/react/client.ts).
  // fromWireProfile() still narrows internally via isWireProfile (it
  // accepts `unknown` so the parser stays fail-closed against any
  // future server-side schema drift), but the consumer no longer
  // needs an `as unknown[]` cast.
  const profiles: ReadonlyArray<GenProfile> = r.profiles ?? []
  return profiles.map((p) => fromWireProfile(p))
}

// NOTE: a single-row `getProfile(id)` helper used to live here. It was
// removed (Q03 / #91) because it had zero callers in the SPA -- the page
// always rehydrates via `listProfiles()` after a mutation. Add it back in
// a focused commit when a caller actually appears (the genapi workaround
// pattern documented above is the template).

export async function createProfile(
  input: CreateProfileInput
): Promise<ProfileView> {
  const r = await client.postProfiles(toWireCreateRequest(input))
  return fromWireProfile(r)
}

export async function updateProfile(
  id: string,
  input: UpdateProfileInput
): Promise<ProfileView> {
  const wire = toWireUpdateRequest(input)
  // genapi 0.11.1: the generated client maps the {profileId} URL token to
  // the schema field `profileId` (camelCase) and converts it to the
  // snake_case `profile_id` path segment on the wire, so we pass a typed
  // UpdateProfileReq directly -- no `as unknown as {...}` cast.
  const r = await client.patchProfileid({ ...wire, profileId: id })
  return fromWireProfile(r)
}

export async function deleteProfile(id: string): Promise<void> {
  await client.deleteProfileid({ profileId: id })
}
