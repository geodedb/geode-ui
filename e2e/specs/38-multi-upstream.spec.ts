// e2e/specs/38-multi-upstream.spec.ts
//
// Multi-upstream specs against the two-Geode compose stack:
//
//   - `default` profile → primary geode (movies + vulndb seeds)
//   - `social`  profile → geode-b (10k-node / 50k-edge synthetic
//     social graph from deploy/geode/seed/gen-social.py)
//
// What these specs assert:
//
//   1. The Connection-switcher's AddConnection flow can switch the
//      `<select id="add-profile">` picker to `social`, sign in with
//      the upstream admin credentials, and land a second
//      menuitemradio row in the switcher.
//   2. Once active, queries against `geode-b` (social) return the
//      expected Person count from the seeded social graph and an
//      edge count from the FOLLOWS relationship.
//   3. The primary upstream still serves its own movies fixture
//      across the same session, proving the two connections are
//      independent and the SPA routes queries to the active one.
//
// The specs use the wire-DSN admin credentials baked into the
// docker-compose `default` profile. Each connection rotation is a
// signed login through /api/v1/auth/login (cookie-based), not just a
// SPA state flip — so a failure in the Geode-b bootstrap surfaces
// here as a login error rather than passing silently.

import { test, expect, Page } from '@playwright/test'
import { test as authedTest } from '../fixtures'
import { sel } from '../helpers/selectors'
import { login } from '../helpers/auth'

const ADMIN_USER = process.env.ADMIN_USER ?? 'geode'
const ADMIN_PASS =
  process.env.ADMIN_PASSWORD ?? 'Geode E2E Bootstrap Password 2024'

// Expected social-graph counts. Kept in lockstep with the
// deploy/geode/seed/gen-social.py defaults — bumping the generator
// without updating these will fail this spec loudly rather than
// silently masking a partial seed.
//
// Geode v0.5.18's `geode query -f` re-runs the last statement of
// each ~100-statement batch (observed empirically across many seed
// files), so the actual landed count is slightly above the
// generator's nominal target. The seed-bootstrap dedupe pass cleans
// most of that up for vulndb / movies, but the dedup query against a
// 10k-node label produces a response shape the current grep regex
// misses on this build. Tolerating a small overshoot range here is
// pragmatic — the spec's purpose is to prove the SPA can route
// queries to a second upstream and get back realistic counts, not
// to assert exactly-10000.
const SOCIAL_NODES_MIN = 10_000
const SOCIAL_NODES_MAX = 10_500
const SOCIAL_EDGES_AT_LEAST = 49_000 // generator's collision-cap floor

async function connectSocial(page: Page): Promise<void> {
  await sel.connectionTrigger(page).click()
  await sel.addConnectionMenuItem(page).click()
  // The public-profile picker auto-selects the default; flip it to
  // `social` so the next login authenticates against geode-b instead.
  await page.locator('#add-profile').selectOption('social')
  await page.getByLabel('Username').fill(ADMIN_USER)
  await page.getByLabel('Password').fill(ADMIN_PASS)
  await sel.addConnectionSubmit(page).click()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })
}

authedTest.describe('multi-upstream (two-Geode compose stack)', () => {
  authedTest(
    'AddConnection against the social profile lands a second switcher row',
    async ({ authedPage: page }) => {
      await page.goto('/')
      await connectSocial(page)
      await sel.connectionTrigger(page).click()
      // One menuitemradio for `default` + one for `social` after the
      // connectMore round-trip lands.
      await expect(
        page.getByRole('menuitemradio', { name: /default/i })
      ).toHaveCount(1)
      await expect(
        page.getByRole('menuitemradio', { name: /social/i })
      ).toHaveCount(1)
    }
  )

  authedTest(
    'queries against the social profile return the seeded 10k/50k counts',
    async ({ authedPage: page }) => {
      // Hop through the SPA-level switcher to authenticate against
      // geode-b, then drop down to /api/v1/query for the actual
      // count probes — running the count() scans through the SPA
      // editor would race with Monaco's mount + Web Awesome's
      // toolbar paint and isn't what this spec is here to assert.
      await page.goto('/')
      await connectSocial(page)
      await sel.connectionTrigger(page).click()
      await page
        .getByRole('menuitemradio', { name: /social/i })
        .first()
        .click()

      // page.request inherits the browser's cookie jar (the SPA's
      // session cookie + CSRF cookie), so we reuse it for the API
      // probes instead of building a parallel APIRequestContext.
      const csrfRes = await page.request.get('/api/v1/csrf')
      const csrf = (await csrfRes.json()).csrf_token

      // Re-mint against the `social` profile so the Authorization
      // header carries the matching profile claim. The SPA's
      // switcher already wrote a cookie when we clicked `social`
      // above; this Bearer is independent so a regression in the
      // cookie path doesn't mask a regression in the query path.
      const socialToken = await login(page.request, {
        username: ADMIN_USER,
        password: ADMIN_PASS,
        profile: 'social',
      })

      const headers = {
        Authorization: `Bearer ${socialToken}`,
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/json',
      } as const

      // Node count probe.
      const nodes = await page.request.post('/api/v1/query', {
        headers,
        data: {
          statement: 'USE GRAPH social; MATCH (n:Person) RETURN count(n) AS c',
          page_size: 1,
          timeout_ms: 30_000,
        },
      })
      expect(nodes.status()).toBe(200)
      const nodesBody = await nodes.json()
      const nodeCount = Number(nodesBody.rows?.[0]?.[0] ?? 0)
      expect(nodeCount).toBeGreaterThanOrEqual(SOCIAL_NODES_MIN)
      expect(nodeCount).toBeLessThanOrEqual(SOCIAL_NODES_MAX)

      // Edge count probe.
      const edges = await page.request.post('/api/v1/query', {
        headers,
        data: {
          statement:
            'USE GRAPH social; MATCH ()-[r:FOLLOWS]->() RETURN count(r) AS c',
          page_size: 1,
          timeout_ms: 30_000,
        },
      })
      expect(edges.status()).toBe(200)
      const edgesBody = await edges.json()
      const edgeCount = Number(edgesBody.rows?.[0]?.[0] ?? 0)
      expect(edgeCount).toBeGreaterThanOrEqual(SOCIAL_EDGES_AT_LEAST)
    }
  )

  authedTest(
    'the default profile still serves its own movies fixture across the session',
    async ({ authedPage: page, authToken }) => {
      // Connect to social to confirm two profiles co-exist…
      await page.goto('/')
      await connectSocial(page)
      // …then query the original default upstream directly. The
      // fixture's authToken already carries the `default` profile
      // claim, so /api/v1/query routes to geode (not geode-b).
      const csrfRes = await page.request.get('/api/v1/csrf')
      const csrf = (await csrfRes.json()).csrf_token
      const res = await page.request.post('/api/v1/query', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-CSRF-Token': csrf,
          'Content-Type': 'application/json',
        },
        data: {
          statement: 'USE GRAPH movies; MATCH (n) RETURN count(n) AS c',
          page_size: 1,
          timeout_ms: 30_000,
        },
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      const count = Number(body.rows?.[0]?.[0] ?? 0)
      // 38 Movie + 133 Person from the Neo4j Movies dataset, mirrored
      // by deploy/geode/seed-bootstrap.sh's verify_graph movies 171.
      expect(count).toBe(171)
    }
  )
})

// Use the bare playwright `test` import so eslint doesn't trip on
// the unused symbol when the authed variant above does all the work.
test.skip('placeholder so the file is not empty for the loader', () => {})
