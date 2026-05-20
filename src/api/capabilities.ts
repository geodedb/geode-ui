import { client } from './client'
import { CONFLICT, WIRE_FEATURE_MISSING } from './serverErrorCodes'

// Capabilities mirrors the `GET /api/v1/capabilities` response. The
// generated client types `admin_writable` as `Record<string, unknown>`
// (a nested object in the schema becomes raw JSON in genapi), so this
// module re-narrows it to the four known boolean flags the SPA gates on.
//
// `admin_writable.{users,roles,policies,grants}` report whether the
// *connected* Geode build accepts the corresponding admin DDL over the
// GQL wire (CREATE USER / CREATE ROLE / CREATE POLICY / GRANT). Against
// every released build today they are all `false` — the server
// hardcodes them pending the separate Geode wire-RBAC work. When that
// lands the server flips the flags and the create CTAs light up here
// with no SPA change.

export interface AdminWritable {
  users: boolean
  roles: boolean
  policies: boolean
  grants: boolean
}

export interface Capabilities {
  geodeVersion: string
  adminWritable: AdminWritable
  // metricsEnabled reflects whether the server has GEODE_METRICS_URL
  // configured (== the /api/v1/metrics proxy will return real data
  // rather than 503 METRICS_DISABLED). The Dashboard's metric cards
  // gate on this so the first render is correct even before the
  // metrics-polling hook has issued its first probe.
  metricsEnabled: boolean
}

// ADMIN_WRITABLE_NONE is the conservative default applied before the
// `/capabilities` fetch resolves (and if it fails): treat every admin
// DDL family as unsupported so the CTAs render gated rather than
// flashing enabled-then-disabled.
export const ADMIN_WRITABLE_NONE: AdminWritable = {
  users: false,
  roles: false,
  policies: false,
  grants: false,
}

function asBool(v: unknown): boolean {
  return v === true
}

// fetchCapabilities calls the generated client and normalises the
// loosely-typed response into the narrowed shape above.
export async function fetchCapabilities(): Promise<Capabilities> {
  const raw = await client.getCapabilities({})
  const aw = (raw.admin_writable ?? {}) as Record<string, unknown>
  return {
    geodeVersion:
      typeof raw.geode_version === 'string' ? raw.geode_version : '',
    adminWritable: {
      users: asBool(aw.users),
      roles: asBool(aw.roles),
      policies: asBool(aw.policies),
      grants: asBool(aw.grants),
    },
    metricsEnabled: asBool(
      (raw as unknown as Record<string, unknown>).metrics_enabled
    ),
  }
}

// isWireFeatureMissingError reports whether a rejected client call looks
// like the server's `wire_feature_missing` response (HTTP 501 — the
// connected Geode build doesn't implement the DDL over the wire). The
// generated client throws an `HTTPError` whose `status` is the numeric
// code and whose `body` is the raw response text; handler tests stub a
// plain `Error` with `status`/`body` (the latter sometimes pre-parsed),
// so this accepts both shapes.
export function isWireFeatureMissingError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { status?: unknown; body?: unknown; message?: unknown }
  if (e.status === 501) return true
  const body = parseErrBody(e.body)
  if (body && body.error === WIRE_FEATURE_MISSING) return true
  if (typeof e.message === 'string') {
    if (/http status 501\b/i.test(e.message)) return true
    if (e.message.includes(WIRE_FEATURE_MISSING)) return true
  }
  return false
}

// wireFeatureMissingDescription extracts the server's
// `error_description` from a `wire_feature_missing` rejection so the UI
// can surface it verbatim instead of the `http status 501: {…}` blob.
// Returns null when no description can be recovered (the caller falls
// back to a clean i18n string).
export function wireFeatureMissingDescription(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const e = err as { body?: unknown; message?: unknown }
  const body = parseErrBody(e.body)
  if (body && typeof body.error_description === 'string') {
    return body.error_description
  }
  // Last resort: pull a JSON object out of the message text.
  if (typeof e.message === 'string') {
    const match = e.message.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = parseErrBody(match[0])
      if (parsed && typeof parsed.error_description === 'string') {
        return parsed.error_description
      }
    }
  }
  return null
}

// isConflictError reports whether a rejected client call looks like the
// server's HTTP 409 `conflict` response. For the profile CRUD handlers
// the only producer is `profilestore.ErrConflict` -> `storeErrorToHTTP`
// -> `ErrCodeConflict`, surfaced when a profile mutation (POST or
// PATCH) tries to land a name that already exists in the same scope
// for the same owner. Accepts the same shape envelope as
// isWireFeatureMissingError.
export function isConflictError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { status?: unknown; body?: unknown; message?: unknown }
  if (e.status === 409) return true
  const body = parseErrBody(e.body)
  if (body && body.error === CONFLICT) return true
  if (typeof e.message === 'string') {
    if (/http status 409\b/i.test(e.message)) return true
    if (e.message.includes(`"error":"${CONFLICT}"`)) return true
  }
  return false
}

interface ErrBody {
  error?: string
  error_description?: string
}

function parseErrBody(body: unknown): ErrBody | null {
  if (!body) return null
  if (typeof body === 'object') return body as ErrBody
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body)
      if (parsed && typeof parsed === 'object') return parsed as ErrBody
    } catch {
      return null
    }
  }
  return null
}
