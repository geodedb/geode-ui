// e2e/specs/39-profile-onboarding.spec.ts
//
// Onboard flow against the live compose stack. Asserts that POST
// /api/v1/profiles/onboard:
//   - rejects bad creds (no profile written)
//   - accepts good creds (profile appears in /api/v1/profiles/public
//     on the next fetch)

import { test, expect } from '@playwright/test'

const GOOD_USER = 'geode'
const GOOD_PASS = 'Geode E2E Bootstrap Password 2024'
// `insecure_tls_skip_verify=true` matches the seed profile's DSN
// (deploy/profiles.test.json) — the e2e compose stack speaks QUIC
// over a self-signed TLS cert that the onboard probe would otherwise
// reject. Production callers point at trust-rooted certs and omit it.
const DSN = 'quic://geode:3141?insecure_tls_skip_verify=true'

test('rejects an onboard attempt with wrong upstream credentials', async ({
  request,
}) => {
  const res = await request.post('/api/v1/profiles/onboard', {
    data: {
      name: 'rejected-profile',
      dsn: DSN,
      description: 'should not persist',
      admin_username: GOOD_USER,
      admin_password: 'definitely-not-the-password',
    },
  })
  expect(res.status()).toBe(401)
  // /api/v1/profiles/public is anonymous, so we can verify the
  // rejected profile did NOT land.
  const list = await request.get('/api/v1/profiles/public')
  const body = await list.json()
  const names = (body.profiles as Array<{ name: string }>).map((p) => p.name)
  expect(names).not.toContain('rejected-profile')
})

test('accepts an onboard with good creds and the new profile appears in /profiles/public', async ({
  request,
}) => {
  const name = `onb-${Date.now()}`
  const res = await request.post('/api/v1/profiles/onboard', {
    data: {
      name,
      dsn: DSN,
      description: 'created by 39-profile-onboarding.spec.ts',
      admin_username: GOOD_USER,
      admin_password: GOOD_PASS,
    },
  })
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.profile_name).toBe(name)
  expect(typeof body.access_token).toBe('string')
  // /profiles/public reflects the new profile.
  const list = await request.get('/api/v1/profiles/public')
  const names = (await list.json()).profiles.map((p: { name: string }) => p.name)
  expect(names).toContain(name)
})
