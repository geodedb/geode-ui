import { APIRequestContext } from '@playwright/test'

const ADMIN_USER = process.env.ADMIN_USER ?? 'geode'
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ?? 'Geode E2E Bootstrap Password 2024'
const ADMIN_PROFILE = process.env.ADMIN_PROFILE ?? 'default'

// Programmatic login. Used by the authedContext fixture (e2e/fixtures.ts)
// to seed a JWT into localStorage so each test skips the login flow.
export async function login(req: APIRequestContext): Promise<string> {
  const res = await req.post('/api/v1/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    form: {
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
      profile: ADMIN_PROFILE,
    },
  })
  if (!res.ok()) {
    const body = await res.text().catch(() => '')
    throw new Error(`login failed (${res.status()}): ${body}`)
  }
  const json = (await res.json()) as { access_token: string }
  return json.access_token
}
