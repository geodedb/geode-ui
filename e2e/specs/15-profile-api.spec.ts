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

  test('POST rejects an obviously-malformed CA PEM (GAP-S10)', async ({
    authToken,
    request,
  }) => {
    const res = await request.post('/api/v1/profiles', {
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
      },
      data: {
        name: makeProfileName('pem-bad'),
        scope: 'personal',
        dsn: 'bolt://localhost:7687',
        is_default: false,
        tls: { ca_pem: 'not a real PEM block at all, just garbage bytes' },
      },
    })

    expect(
      res.status(),
      `expected 4xx for malformed PEM, got ${res.status()}`
    ).toBeGreaterThanOrEqual(400)
    expect(res.status()).toBeLessThan(500)

    const body = await res.json().catch(() => ({}) as Record<string, unknown>)
    // pemvalidate.go uses error sentinels "invalid CA PEM" /
    // "invalid client cert PEM" / "invalid client key PEM". The
    // genapi error envelope wraps them in {code, description}.
    const text = JSON.stringify(body).toLowerCase()
    expect(text).toMatch(/invalid.*pem|pem.*invalid|ca.*invalid/)
  })
})

test.describe.configure({ mode: 'serial' })
test.describe('profile API rate limit (GAP-S7)', () => {
  // The rate-limit probe is intentionally serial: it drives the
  // per-actor bucket to exhaustion and back, which would interfere
  // with concurrent profile-CRUD tests if we ran in parallel.
  // Block-level eslint-disable mirrors helpers/globalSetup.ts — the
  // sequential awaits + setTimeout polls are part of the contract
  // the test exercises (rate-limit timing).
  /* eslint-disable no-plusplus, no-await-in-loop, no-unsafe-finally */
  test('exhausting the burst returns 429 + Retry-After', async ({
    authToken,
    request,
  }) => {
    // ProfileLimiterDefaults: 0.5 req/s steady, burst 10. Fire up to
    // 25 POSTs back-to-back; the first ~10 succeed (burst), then the
    // remainder must 429 with Retry-After. Each successful POST is a
    // real row — collect ids and clean up via retry-on-429 below.
    const created: string[] = []
    let saw429 = false
    let retryAfter: string | null = null
    let burstError: Error | null = null

    for (let i = 0; i < 25; i++) {
      const res = await request.post('/api/v1/profiles', {
        headers: {
          authorization: `Bearer ${authToken}`,
          'content-type': 'application/json',
        },
        data: {
          name: makeProfileName(`burst-${i}`),
          scope: 'personal',
          dsn: 'bolt://localhost:7687',
          is_default: false,
        },
      })
      if (res.status() === 429) {
        saw429 = true
        retryAfter = res.headers()['retry-after'] ?? null
        // Body shape from rejectProfileCRUD():
        // { code: 'rate_limited', description, reason: 'actor_rate_limited' }
        const body = (await res.json()) as { code?: string; reason?: string }
        expect(body.code).toBe('rate_limited')
        expect(body.reason).toBe('actor_rate_limited')
        break
      }
      if (res.ok()) {
        const json = (await res.json()) as { id: string }
        created.push(json.id)
      } else {
        const body = await res.text()
        burstError = new Error(
          `unexpected status ${res.status()} during burst: ${body}`
        )
        break
      }
    }

    try {
      if (burstError) throw burstError
      expect(
        saw429,
        'never observed a 429 in 25 POSTs — bucket is wider than expected'
      ).toBeTruthy()
      expect(retryAfter, 'Retry-After header missing on 429').toBeTruthy()
      expect(Number(retryAfter)).toBeGreaterThanOrEqual(1)
    } finally {
      // Cleanup DELETEs also count against the per-actor bucket, which
      // is now empty. ProfileLimiterDefaults refills at 0.5 tokens/sec,
      // so deleting N profiles takes ~2*N seconds in the worst case.
      // Retry each DELETE on 429 with the server's Retry-After hint
      // rather than blocking up-front and hoping we waited enough.
      let cleanupError: Error | null = null
      for (let i = 0; i < created.length; i++) {
        const id = created[i]
        let done = false
        while (!done) {
          const del = await request.delete(`/api/v1/profiles/${id}`, {
            headers: { authorization: `Bearer ${authToken}` },
          })
          if (del.ok() || del.status() === 404) {
            done = true
          } else if (del.status() === 429) {
            const ra = Number(del.headers()['retry-after'] ?? '1')
            await new Promise<void>((r) => {
              setTimeout(r, Math.max(1, ra) * 1000 + 200)
            })
          } else {
            cleanupError = new Error(
              `cleanup DELETE(${id}) failed: ${del.status()} ${await del.text()}`
            )
            done = true
          }
        }
        if (cleanupError) break
      }
      if (cleanupError) throw cleanupError
    }
  })
  /* eslint-enable no-plusplus, no-await-in-loop, no-unsafe-finally */
})
