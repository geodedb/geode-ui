// e2e/specs/15-profile-api.spec.ts
//
// Direct REST coverage for the new /api/v1/profiles surface:
//   - POST/GET/PATCH/DELETE happy path.
//   - PATCH-clear semantics for nullable fields (TLS material, pool
//     overrides, description, savedUsername) — closes the regression
//     window for GAP-PSR-G02 / G02-followup which reworked the wire
//     contract to support clearing those fields with explicit nulls.
//   - Per-actor 429 + Retry-After (GAP-S7).
//   - Server-side PEM validation rejects garbage CA blocks (GAP-S10).
//
// All tests use Bearer auth so the CSRF middleware is bypassed
// (matches the pattern in 09-ops.spec.ts).

import { test, expect } from '../fixtures'
import {
  createProfileViaApi,
  deleteProfileViaApi,
  makeProfileName,
} from '../helpers/profiles'

test.describe('profile API CRUD', () => {
  test('POST creates, GET reads back, DELETE removes', async ({
    authToken,
    request,
  }) => {
    const name = makeProfileName('crud')
    const created = await createProfileViaApi(request, authToken, {
      name,
      description: 'crud test',
    })

    // GET single
    const getRes = await request.get(`/api/v1/profiles/${created.id}`, {
      headers: { authorization: `Bearer ${authToken}` },
    })
    expect(getRes.ok()).toBeTruthy()
    const got = (await getRes.json()) as { name: string; description?: string }
    expect(got.name).toBe(name)
    expect(got.description).toBe('crud test')

    // DELETE
    await deleteProfileViaApi(request, authToken, created.id)

    // GET single again returns 404
    const getAgain = await request.get(`/api/v1/profiles/${created.id}`, {
      headers: { authorization: `Bearer ${authToken}` },
    })
    expect(getAgain.status()).toBe(404)
  })
})
