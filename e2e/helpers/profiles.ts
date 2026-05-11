// e2e/helpers/profiles.ts
//
// Shared scaffolding for the new profile-management spec files
// (14-profiles-page, 15-profile-api, 16-public-profiles, 17-add-connection,
// 18-connection-switcher).
//
// Contract:
//   - Every profile created during a test is namespaced with
//     `e2e-<uuid>-<purpose>` so concurrent specs cannot collide and
//     a leaked profile is immediately identifiable.
//   - createProfileViaApi / deleteProfileViaApi go through the REST
//     surface with Bearer auth (the CSRF middleware skips the
//     Authorization-header path; see 09-ops.spec.ts for the pattern).
//   - freshLogin mints a NEW JWT with a fresh per-actor rate-limit
//     bucket. Use it from rate-limit specs so they don't drain the
//     bootstrap admin's bucket and starve the rest of the suite.

import { APIRequestContext, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { login } from './auth'

const ADMIN_USER = process.env.ADMIN_USER ?? 'geode'
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ?? 'Geode E2E Bootstrap Password 2024'
const ADMIN_PROFILE = process.env.ADMIN_PROFILE ?? 'default'

export function makeProfileName(purpose: string): string {
  return `e2e-${randomUUID()}-${purpose}`
}

export interface CreatedProfile {
  id: string
  name: string
}

export interface CreateProfileBody {
  name: string
  scope?: 'system' | 'personal'
  dsn?: string
  description?: string
  is_default?: boolean
  saved_username?: string
  tls?: {
    ca_pem?: string
    client_cert_pem?: string
    client_key_pem?: string
  }
  pool_overrides?: {
    max_open_conns?: number
    max_idle_conns?: number
    conn_max_lifetime_ms?: number
    conn_max_idle_ms?: number
  }
}

// MAX_RATE_LIMIT_RETRIES caps how many times we'll re-issue a request
// after a 429. The per-actor bucket is keyed by JWT subject, which is
// shared across every parallel worker in the suite — so transient 429s
// happen whenever multiple profile-CRUD tests fire concurrently. The
// budget covers the worst case: the bucket refills at 0.5 tokens/sec,
// and under sustained pressure cleanup DELETEs may need to wait many
// Retry-After windows before they slot into a free token. 15 attempts
// at ~1-2 sec each gives ~15-30 sec of patience per call.
const MAX_RATE_LIMIT_RETRIES = 15

/* eslint-disable no-await-in-loop, no-plusplus, no-continue */
async function sleep(ms: number): Promise<void> {
  await new Promise<void>((r) => {
    setTimeout(r, ms)
  })
}

export async function createProfileViaApi(
  request: APIRequestContext,
  token: string,
  body: CreateProfileBody
): Promise<CreatedProfile> {
  const payload = {
    scope: 'personal',
    dsn: 'bolt://localhost:7687',
    is_default: false,
    ...body,
  }
  let lastStatus = 0
  let lastBody = ''
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    const res = await request.post('/api/v1/profiles', {
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      data: payload,
    })
    if (res.ok()) {
      const json = (await res.json()) as { id: string; name: string }
      return { id: json.id, name: json.name }
    }
    lastStatus = res.status()
    lastBody = await res.text()
    if (res.status() === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const ra = Number(res.headers()['retry-after'] ?? '1')
      await sleep(Math.max(1, ra) * 1000 + 200)
      continue
    }
    break
  }
  expect(
    false,
    `createProfileViaApi(${body.name}) failed after ${MAX_RATE_LIMIT_RETRIES + 1} attempts: ${lastStatus} ${lastBody}`
  ).toBeTruthy()
  // expect.toBeTruthy(false) above always throws; this throw is
  // unreachable but satisfies the type checker's no-implicit-undefined
  // return.
  throw new Error('unreachable')
}

export async function patchProfileViaApi(
  request: APIRequestContext,
  token: string,
  id: string,
  body: Record<string, unknown>
): Promise<unknown> {
  let lastStatus = 0
  let lastBody = ''
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    const res = await request.patch(`/api/v1/profiles/${id}`, {
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      data: body,
    })
    if (res.ok()) return res.json()
    lastStatus = res.status()
    lastBody = await res.text()
    if (res.status() === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const ra = Number(res.headers()['retry-after'] ?? '1')
      await sleep(Math.max(1, ra) * 1000 + 200)
      continue
    }
    break
  }
  throw new Error(
    `patchProfileViaApi(${id}) failed after ${MAX_RATE_LIMIT_RETRIES + 1} attempts: ${lastStatus} ${lastBody}`
  )
}

export async function deleteProfileViaApi(
  request: APIRequestContext,
  token: string,
  id: string
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    const res = await request.delete(`/api/v1/profiles/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    // 404 is acceptable — the test may have already deleted via UI.
    if (res.ok() || res.status() === 404) return
    if (res.status() === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const ra = Number(res.headers()['retry-after'] ?? '1')
      await sleep(Math.max(1, ra) * 1000 + 200)
      continue
    }
    throw new Error(
      `deleteProfileViaApi(${id}) failed: ${res.status()} ${await res.text()}`
    )
  }
}
/* eslint-enable no-await-in-loop, no-plusplus, no-continue */

// freshLogin re-authenticates against /auth/login with the bootstrap
// admin credentials. Returns a token whose profile-CRUD rate-limit
// bucket starts empty — use this from rate-limit specs so they don't
// drain the shared bucket.
//
// NOTE: the per-actor key is the JWT subject, NOT the JWT itself. Two
// freshLogin() calls return tokens with the SAME subject, so they
// share a bucket. Rate-limit specs that need a clean bucket should
// run serially (test.describe.configure({ mode: 'serial' })) and call
// freshLogin once per spec.
export async function freshLogin(req: APIRequestContext): Promise<string> {
  return login(req)
}

export const ADMIN_CREDS = {
  user: ADMIN_USER,
  password: ADMIN_PASSWORD,
  profile: ADMIN_PROFILE,
}
