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

function parseTls(raw: unknown): TLSMaterial | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  const obj = JSON.parse(raw)
  return {
    caPem: obj.ca_pem || undefined,
    clientCertPem: obj.client_cert_pem || undefined,
    clientKeyPem: obj.client_key_pem || undefined,
  }
}

function parsePoolOverrides(raw: unknown): PoolOverrides | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  const obj = JSON.parse(raw)
  return {
    maxOpenConns: obj.max_open_conns,
    maxIdleConns: obj.max_idle_conns,
    connMaxLifetimeMs: obj.conn_max_lifetime_ms,
    connMaxIdleMs: obj.conn_max_idle_ms,
  }
}

// fromWireProfile parses the genapi-emitted Profile shape (with
// jsontext.Value-as-string for tls and pool_overrides) into the SPA's
// typed ProfileView.
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

function tlsToWire(t?: TLSMaterial): string | undefined {
  if (!t) return undefined
  const obj: Record<string, string> = {}
  if (t.caPem) obj.ca_pem = t.caPem
  if (t.clientCertPem) obj.client_cert_pem = t.clientCertPem
  if (t.clientKeyPem) obj.client_key_pem = t.clientKeyPem
  return Object.keys(obj).length === 0 ? undefined : JSON.stringify(obj)
}

function poToWire(o?: PoolOverrides): string | undefined {
  if (!o) return undefined
  const obj: Record<string, number> = {}
  if (o.maxOpenConns !== undefined) obj.max_open_conns = o.maxOpenConns
  if (o.maxIdleConns !== undefined) obj.max_idle_conns = o.maxIdleConns
  if (o.connMaxLifetimeMs !== undefined) {
    obj.conn_max_lifetime_ms = o.connMaxLifetimeMs
  }
  if (o.connMaxIdleMs !== undefined) obj.conn_max_idle_ms = o.connMaxIdleMs
  return Object.keys(obj).length === 0 ? undefined : JSON.stringify(obj)
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
