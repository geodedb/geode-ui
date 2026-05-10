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

// fromWireProfile parses the server's Profile shape into the SPA's typed
// ProfileView. tls and pool_overrides are accepted as either a nested JSON
// object (current server output) or a JSON-encoded string (legacy/test
// form), so the two sides can be deployed independently.
export function fromWireProfile(wire: any): ProfileView {
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
  return ((r.profiles ?? []) as unknown[]).map((p) => fromWireProfile(p as any))
}

// NOTE: the genapi TS client extracts the path-token name from the
// request object using the path's literal token (`profileId`, camel),
// not the schema's snake_case field name (`profile_id`). The TS type
// `ProfileIDPath { profile_id: string }` is therefore wrong at runtime
// — passing `{profile_id: id}` throws "missing path parameter profileId"
// inside expandPath. We work around this by sending `profileId` and
// casting through `as unknown` so TypeScript doesn't complain. The
// structural fix lives in genapi's TS template (~/src/devnw/go/genapi);
// tracked as a follow-up to Plan A's path-binding fix.

export async function getProfile(id: string): Promise<ProfileView> {
  const r = await client.getProfileid({ profileId: id } as unknown as {
    profile_id: string
  })
  return fromWireProfile(r)
}

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
  const r = await client.patchProfileid({
    ...wire,
    profileId: id,
  } as unknown as {
    description?: string
  })
  return fromWireProfile(r)
}

export async function deleteProfile(id: string): Promise<void> {
  await client.deleteProfileid({ profileId: id } as unknown as {
    profile_id: string
  })
}
