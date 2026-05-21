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
  test('renders login form without picker when /profiles/public is unreachable', async ({
    page,
  }) => {
    // Task 7 refactor (commit 20ce7a3, "feat(auth): LoginPage three-way
    // branch (filter / onboard / add toggle)") removed the free-text
    // Profile fallback input that the previous LoginPage rendered when
    // fetchPublicProfiles rejected. The post-refactor render branch is:
    //
    //   noProfiles    = profiles !== null && length === 0 && !loadErr
    //   showOnboard   = false (default)
    //   loadErr=true  → noProfiles is false (the !loadErr guard) AND
    //                   showOnboard is false, so the standard login
    //                   form renders. The ProfileFilter is gated by
    //                   `profiles && length > 0 && !loadErr` so it is
    //                   NOT rendered. The form submits with the default
    //                   profile state value ('default' from useState).
    //
    // The intent of this test is still "the SPA stays usable when the
    // public-profiles fetch fails" — we just assert it via the new
    // shape: form + submit visible, picker absent, add-profile toggle
    // available so the operator can pivot to onboarding.
    await page.route('**/api/v1/profiles/public', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'unavailable' }),
      })
    )
    await page.goto('/login')

    // The form mounts. Username/Password are <wa-input>s — their
    // <label for=...> targets the host element, but getByLabel can't
    // resolve the inner shadow <input>. Assert via the stable
    // data-testid on the host instead.
    await expect(page.getByTestId('login-username')).toBeVisible({
      timeout: 5000,
    })
    await expect(page.getByTestId('login-password')).toBeVisible()
    await expect(page.getByTestId('login-submit-btn')).toBeVisible()

    // The ProfileFilter picker MUST be absent — its render is gated on
    // !loadErr (LoginPage.tsx:159).
    await expect(page.getByTestId('profile-filter-input')).toHaveCount(0)

    // The add-profile toggle MUST remain visible so the operator can
    // still pivot into the OnboardProfileForm even when discovery
    // failed.
    await expect(page.getByTestId('login-add-profile')).toBeVisible()
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
