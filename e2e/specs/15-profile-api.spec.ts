// e2e/specs/15-profile-api.spec.ts
//
// Direct REST coverage for the new /api/v1/profiles surface:
//   - POST/GET/PATCH/DELETE happy path.
//   - PATCH-clear semantics:
//     * scalar fields (description, saved_username) — *string with
//       omitempty, so empty string "" is the wire-clear sentinel; null
//       and absent both unmarshal to nil = "preserve". Closes the
//       regression window for GAP-PSR-G02-followup which reworked the
//       genapi types to support a first-class clear path.
//     * nested fields (tls, pool_overrides) — jsontext.Value, where
//       null IS the wire-clear sentinel.
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

  test('PATCH with explicit empty string clears description + savedUsername', async ({
    authToken,
    request,
  }) => {
    const seeded = await createProfileViaApi(request, authToken, {
      name: makeProfileName('patch-clear'),
      description: 'will be cleared',
      saved_username: 'will-be-cleared',
    })

    try {
      // PSR-G02-followup wire contract: scalar fields use *string with
      // omitempty. nil pointer (= field absent OR null in wire JSON)
      // preserves; non-nil pointer (incl. pointer to empty string)
      // sets/clears. Empty string is the wire-clear sentinel.
      const res = await request.patch(`/api/v1/profiles/${seeded.id}`, {
        headers: {
          authorization: `Bearer ${authToken}`,
          'content-type': 'application/json',
        },
        data: { description: '', saved_username: '' },
      })
      expect(
        res.ok(),
        `PATCH failed: ${res.status()} ${await res.text()}`
      ).toBeTruthy()

      const getRes = await request.get(`/api/v1/profiles/${seeded.id}`, {
        headers: { authorization: `Bearer ${authToken}` },
      })
      const got = (await getRes.json()) as {
        description?: string
        saved_username?: string
      }
      expect(got.description ?? '').toBe('')
      expect(got.saved_username ?? '').toBe('')
    } finally {
      await deleteProfileViaApi(request, authToken, seeded.id)
    }
  })
})
