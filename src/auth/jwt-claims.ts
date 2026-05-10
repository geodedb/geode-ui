// Lightweight client-side JWT claims decoder (PSR-G09 / #86).
//
// The SPA receives the access token in the LoginResp body even when
// cookie-mode is on (`src/api/auth.ts::LoginResult.access_token`).
// This module extracts the `roles` claim so the React tree can drive
// role-based UI (e.g. ProfilesPage's CRUD-action visibility) from the
// authoritative server-side role list rather than from a client-side
// heuristic that conflated DSN visibility with admin status.
//
// SECURITY:
//   - This is NOT a verifier. The server validates every request via
//     the HS256-signed cookie; a client-side decode of the same token
//     can only describe what the user CLAIMS to be, never grant any
//     authority. The UI uses it for visibility decisions only — every
//     actual mutation re-checks roles server-side.
//   - We deliberately do NOT depend on a JWT library here. The decoder
//     base64-decodes the payload segment and JSON.parses it; nothing
//     more. No signature math, no algorithm sniffing, no key handling.
//   - Errors (malformed token, missing roles, unparseable JSON) all
//     resolve to an empty roles list rather than throwing, so a
//     decode failure never breaks the UI tree above the consumer.

export type JwtClaims = {
  sub?: string
  profile?: string
  roles?: readonly string[]
  cid?: string
  iat?: number
  exp?: number
}

// base64url → bytes → string. atob() handles standard base64; JWTs use
// URL-safe base64 with `-`/`_` and may strip `=` padding, so we
// normalise before decoding.
function decodeBase64Url(segment: string): string {
  const padded =
    segment.replace(/-/g, '+').replace(/_/g, '/') +
    '==='.slice(0, (4 - (segment.length % 4)) % 4)
  if (typeof atob === 'function') {
    return atob(padded)
  }
  // Node fallback (jest, server-side rendering).
  return Buffer.from(padded, 'base64').toString('binary')
}

// Decode a JWT and return its claims as a typed shallow object. Returns
// null for any malformed input rather than throwing. The returned object
// is NOT trusted for any authority decision — see the module-level
// SECURITY note.
export function decodeJwtClaims(
  token: string | null | undefined
): JwtClaims | null {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const payload = parts[1]
  if (!payload) return null
  let raw: string
  try {
    raw = decodeBase64Url(payload)
  } catch {
    return null
  }
  // The decoded bytes are utf-8 JSON; convert via TextDecoder when
  // available so multi-byte characters in display names round-trip
  // correctly.
  let text = raw
  if (typeof TextDecoder !== 'undefined') {
    try {
      const buf = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i += 1) buf[i] = raw.charCodeAt(i) & 0xff
      text = new TextDecoder('utf-8').decode(buf)
    } catch {
      /* fall back to raw binary string */
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  // Narrow to the shape we care about; ignore extra claims.
  const obj = parsed as Record<string, unknown>
  const claims: JwtClaims = {}
  if (typeof obj.sub === 'string') claims.sub = obj.sub
  if (typeof obj.profile === 'string') claims.profile = obj.profile
  if (Array.isArray(obj.roles)) {
    claims.roles = (obj.roles as unknown[]).filter(
      (r): r is string => typeof r === 'string'
    )
  }
  if (typeof obj.cid === 'string') claims.cid = obj.cid
  if (typeof obj.iat === 'number') claims.iat = obj.iat
  if (typeof obj.exp === 'number') claims.exp = obj.exp
  return claims
}

// Convenience: extract just the roles array. Empty array on any
// failure so callers can write `roles.includes('admin')` without
// null-guards.
export function extractRoles(token: string | null | undefined): string[] {
  const claims = decodeJwtClaims(token)
  return claims?.roles ? [...claims.roles] : []
}
