/// <reference types="@testing-library/jest-dom" />
import { onboardProfile } from './auth'

const realFetch = global.fetch

beforeEach(() => {
  // eslint-disable-next-line no-extra-semi -- prettier emits the leading-semicolon protector
  ;(global as unknown as { fetch: jest.Mock }).fetch = jest.fn()
})

afterEach(() => {
  // eslint-disable-next-line no-extra-semi -- prettier emits the leading-semicolon protector
  ;(global as unknown as { fetch: typeof realFetch }).fetch = realFetch
})

test('onboardProfile posts JSON to /api/v1/profiles/onboard and returns the parsed body', async () => {
  // eslint-disable-next-line no-extra-semi -- prettier emits the leading-semicolon protector
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      profile_id: 'onb-prod',
      profile_name: 'prod',
      access_token: 'jwt-abc',
      token_type: 'bearer',
      expires_in: 3600,
      connection_id: '',
    }),
  })

  const result = await onboardProfile({
    name: 'prod',
    dsn: 'quic://prod.example.com:3141',
    description: 'production',
    admin_username: 'alice',
    admin_password: 'pw', // pragma: allowlist secret -- test stub literal
  })

  // resolveBaseUrl() returns http://localhost in jsdom (see auth.ts:
  // every fetch routes through apiUrl() now so the Electron renderer
  // bypasses the geode:// SPA-fallback).
  expect(global.fetch).toHaveBeenCalledWith(
    'http://localhost/api/v1/profiles/onboard',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
      }),
    })
  )
  const call = (global.fetch as jest.Mock).mock.calls[0]
  const body = JSON.parse(call[1].body)
  expect(body).toEqual({
    name: 'prod',
    dsn: 'quic://prod.example.com:3141',
    description: 'production',
    admin_username: 'alice',
    admin_password: 'pw', // pragma: allowlist secret -- test stub literal
  })
  expect(result.access_token).toBe('jwt-abc')
  expect(result.profile_id).toBe('onb-prod')
})

test('onboardProfile throws on non-2xx with the server-supplied error message', async () => {
  // eslint-disable-next-line no-extra-semi -- prettier emits the leading-semicolon protector
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status: 401,
    json: async () => ({
      error: 'unauthorized',
      error_description: 'upstream rejected the supplied admin credentials',
    }),
  })

  await expect(
    onboardProfile({
      name: 'prod',
      dsn: 'quic://x:3141',
      admin_username: 'alice',
      admin_password: 'wrong',
    })
  ).rejects.toThrow(/upstream rejected/)
})
