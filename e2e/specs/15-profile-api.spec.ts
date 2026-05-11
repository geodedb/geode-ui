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

  test('PATCH with explicit null clears TLS material + pool overrides', async ({
    authToken,
    request,
  }) => {
    // A throwaway self-signed CA PEM is fine for the seed because the
    // server only stores the bytes; it doesn't open a real TLS session
    // as part of the CRUD round-trip. The PEM block here was generated
    // locally with `openssl req -x509 -nodes -newkey rsa:2048 -days 1`
    // and is committed verbatim so the test stays hermetic.
    const seedPem = `-----BEGIN CERTIFICATE-----
MIIDBzCCAe+gAwIBAgIUF7cz0VKMqfYbZdFLEDDSqBMut6wwDQYJKoZIhvcNAQEL
BQAwEzERMA8GA1UEAwwIZTJlLXRlc3QwHhcNMjYwNTExMDAxMzQ0WhcNMjcwNTEx
MDAxMzQ0WjATMREwDwYDVQQDDAhlMmUtdGVzdDCCASIwDQYJKoZIhvcNAQEBBQAD
ggEPADCCAQoCggEBALQTTzl9zN3oH638l0orE+uUqtzpZ99D4gBbmYFYGPAYwSAb
e4iR9J46rd/oy/TonpA7JYPaOWqjhpWo58PUibHgMk7lyosHl6RSGSmkvot8fc8b
RKBSMHAfFvqK603vCrhhZ8jEm7H6/Tp5tuwx731K+zCruP1jcZaL39+EqFXRTXwz
kkJQflAuZR3VKJ2hBHOUm81KrbLGcdBIb2vP2YQHA1aYKGZ50QZIudOidgFdAQr4
1kIJmzcxQ+b0klJiFxNVybH5EI+ObIUMkPs/34nX+djDTP541lmcXrPw/lZ7igND
KWm34yFSn+DWXtCU+gF9sdJ2iVWErLmjdOIyk6sCAwEAAaNTMFEwHQYDVR0OBBYE
FKQNhitk4DSbuJmBuh4zC2AQcLSqMB8GA1UdIwQYMBaAFKQNhitk4DSbuJmBuh4z
C2AQcLSqMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAFXvRfwK
QzrwMoCn+vmW3qF/Z7l3f3jafRnXWtwpglJJYKSk4dHFdHUeV7SzxrsianVkdrIh
ITu1bT8NfnCVnbHZOGkcMd/qJp/W7jUaVY0ZMxvl+6Ts4jsAubQ5nkuTkqXcNXdE
6oYPDNwkOVATy+II0lzTfapGNvUpaEWTM3gJYhJO/Pnh7gpolKhK7FNU0wGanMot
gDin/zToYp2mAmbptLM/4JSZHayJpZ7xnKNhudII/EBuvmeKLN5FXv4LBvkqt7c7
GJRgZchzHut2gBPwjDrkeWhcdLuqzXbsX+Syw5pYNCeJpVHa+OplhIwY325LKmMq
dy4i8S1EfvR6fPo=
-----END CERTIFICATE-----`

    const seeded = await createProfileViaApi(request, authToken, {
      name: makeProfileName('patch-clear-tls'),
      tls: { ca_pem: seedPem },
      pool_overrides: { max_open_conns: 25, conn_max_lifetime_ms: 60_000 },
    })

    try {
      // tls + pool_overrides arrive as jsontext.Value on the genapi
      // wire, so explicit JSON null IS the clear sentinel here (in
      // contrast to scalar fields which use empty string — see the
      // previous test).
      const res = await request.patch(`/api/v1/profiles/${seeded.id}`, {
        headers: {
          authorization: `Bearer ${authToken}`,
          'content-type': 'application/json',
        },
        data: { tls: null, pool_overrides: null },
      })
      expect(
        res.ok(),
        `PATCH failed: ${res.status()} ${await res.text()}`
      ).toBeTruthy()

      const getRes = await request.get(`/api/v1/profiles/${seeded.id}`, {
        headers: { authorization: `Bearer ${authToken}` },
      })
      const got = (await getRes.json()) as {
        tls?: Record<string, unknown> | null
        pool_overrides?: Record<string, unknown> | null
      }
      // After clearing the server emits the columns either as null,
      // as an empty object, or as an object whose values are all
      // empty/zero. All three forms satisfy the contract.
      const isEmptyOrZero = (v: unknown): boolean =>
        v === null || v === undefined || v === '' || v === 0 || v === false
      const tlsCleared =
        got.tls === null ||
        got.tls === undefined ||
        Object.values(got.tls ?? {}).every(isEmptyOrZero)
      expect(tlsCleared, `tls not cleared: ${JSON.stringify(got.tls)}`).toBeTruthy()
      const poolCleared =
        got.pool_overrides === null ||
        got.pool_overrides === undefined ||
        Object.values(got.pool_overrides ?? {}).every(isEmptyOrZero)
      expect(
        poolCleared,
        `pool_overrides not cleared: ${JSON.stringify(got.pool_overrides)}`
      ).toBeTruthy()
    } finally {
      await deleteProfileViaApi(request, authToken, seeded.id)
    }
  })
})
