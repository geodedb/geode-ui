import { APIRequestContext } from '@playwright/test'

const ADMIN_USER = process.env.ADMIN_USER ?? 'geode'
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ?? 'Geode E2E Bootstrap Password 2024'
const ADMIN_PROFILE = process.env.ADMIN_PROFILE ?? 'default'

export interface LoginOptions {
  username?: string
  password?: string
  profile?: string
}

// Programmatic login. Used by the authedContext fixture
// (e2e/fixtures.ts) to seed a JWT into localStorage so each test
// skips the login flow.
//
// 2026-05-21 multi-upstream extension: takes an optional creds/
// profile override so the two-Geode spec (38-multi-upstream) can
// mint a JWT against the `social` profile via the same code path.
// Defaults preserve the existing fixture behaviour byte-for-byte.
export async function login(
  req: APIRequestContext,
  opts: LoginOptions = {}
): Promise<string> {
  const res = await req.post('/api/v1/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    form: {
      username: opts.username ?? ADMIN_USER,
      password: opts.password ?? ADMIN_PASSWORD,
      profile: opts.profile ?? ADMIN_PROFILE,
    },
  })
  if (!res.ok()) {
    const body = await res.text().catch(() => '')
    throw new Error(`login failed (${res.status()}): ${body}`)
  }
  const json = (await res.json()) as { access_token: string }
  return json.access_token
}
