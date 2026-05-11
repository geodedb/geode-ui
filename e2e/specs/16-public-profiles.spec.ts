// e2e/specs/16-public-profiles.spec.ts
//
// Coverage for /api/v1/profiles/public — the unauthenticated bootstrap
// endpoint that LoginPage and AddConnectionModal use to populate their
// profile pickers. The endpoint must:
//   - Be reachable without a JWT (no Authorization header).
//   - Return only system-scope profiles (never personal).
//   - Return { profiles: PublicProfile[] } where PublicProfile carries
//     `name` and optional `description` only — DSN, owner, TLS material,
//     pool overrides, and saved usernames are server-side secrets.

import { test, expect } from '../fixtures'

test.describe('public profiles endpoint', () => {
  test('GET /profiles/public returns 200 without auth', async ({ request }) => {
    const res = await request.get('/api/v1/profiles/public')
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { profiles: unknown }
    expect(Array.isArray(body.profiles)).toBeTruthy()
  })

  test('public profiles do NOT carry sensitive fields', async ({ request }) => {
    const res = await request.get('/api/v1/profiles/public')
    const body = (await res.json()) as {
      profiles: Record<string, unknown>[]
    }
    body.profiles.forEach((p) => {
      expect(p).toHaveProperty('name')
      // Negative assertions: these MUST NOT appear in the public list.
      expect(p).not.toHaveProperty('dsn')
      expect(p).not.toHaveProperty('tls')
      expect(p).not.toHaveProperty('pool_overrides')
      expect(p).not.toHaveProperty('owner_user_id')
      expect(p).not.toHaveProperty('saved_username')
    })
  })

  test('seed default profile is present in public list', async ({
    request,
  }) => {
    const res = await request.get('/api/v1/profiles/public')
    const body = (await res.json()) as {
      profiles: { name: string }[]
    }
    expect(body.profiles.some((p) => p.name === 'default')).toBeTruthy()
  })
})

test.describe('login page profile picker', () => {
  test('falls back to free-text Profile input when /profiles/public is unreachable', async ({
    page,
  }) => {
    // Force the public-profile fetch to fail BEFORE the SPA mounts.
    await page.route('**/api/v1/profiles/public', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'unavailable' }),
      })
    )
    await page.goto('/login')

    // LoginPage's fallback: when fetchPublicProfiles rejects, it
    // silently swaps the <ProfileList> button list for a free-text
    // <Field label='Profile'>...<Input id='login-profile'/></Field>.
    // The button-shaped picker (role=list, label='Available profiles')
    // must NOT render; the text input MUST.
    await expect(page.locator('#login-profile')).toBeVisible({ timeout: 5000 })
    await expect(
      page.getByRole('list', { name: /available profiles/i })
    ).toHaveCount(0)
    // Form remains usable.
    await expect(page.getByLabel('Username')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
  })
})

test.describe('SPA static asset fallback (f6d1bc7)', () => {
  test('asset-shaped 404s return 404 with non-HTML Content-Type', async ({
    request,
  }) => {
    const res = await request.get('/static/js/does-not-exist.abc123.js')
    expect(res.status()).toBe(404)
    const ct = (res.headers()['content-type'] ?? '').toLowerCase()
    expect(ct.includes('text/html')).toBeFalsy()
  })

  test('unknown SPA route falls through to index.html (200)', async ({
    request,
  }) => {
    // The SPA route /not-a-real-route is unknown to the server but the
    // fallback intentionally serves index.html so client-side routing
    // can take over. We assert the OPPOSITE shape from the test above:
    // 200 + text/html.
    const res = await request.get('/not-a-real-route')
    expect(res.status()).toBe(200)
    const ct = (res.headers()['content-type'] ?? '').toLowerCase()
    expect(ct.includes('text/html')).toBeTruthy()
  })

  test('asset-shaped paths under nested dirs also 404', async ({ request }) => {
    // Catches the regression where the file-suffix heuristic only fired
    // on the top-level path. Hashed bundle names live under /static/.
    const css = await request.get('/static/css/does-not-exist.deadbeef.css')
    expect(css.status()).toBe(404)
    const map = await request.get('/static/js/missing.bundle.js.map')
    expect(map.status()).toBe(404)
  })
})
