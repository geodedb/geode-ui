// 37-dashboard-metrics.spec.ts
//
// End-to-end smoke for the Dashboard metrics surface (server-side
// proxy in d072d52 + cards in f843b6d). The test container's
// docker-compose.test.yml sets:
//
//   geode    : GEODE_METRICS_PORT=9090
//   geode-ui : GEODE_METRICS_URL=http://geode:9090/metrics
//
// so the SPA's first /api/v1/metrics fetch lands a real snapshot and
// the four metric cards render. With GEODE_METRICS_URL unset the cards
// drop out of the grid entirely (state='disabled' latch) — that branch
// is exercised by the DashboardPage jest suite; this spec only covers
// the metrics-enabled path that the e2e stack provides.

import { test, expect } from '../fixtures'

test.describe('dashboard metrics (geode prometheus proxy)', () => {
  test('renders all four metric cards when the metrics listener is enabled', async ({
    authedPage: page,
  }) => {
    await page.goto('/dashboard')

    // The first poll fires on mount; with the e2e stack's metrics
    // enabled it should land in under a second on the host. Wait for
    // the throughput card's testid to confirm the gate flipped.
    await expect(page.getByTestId('dashboard-metrics-throughput')).toBeVisible({
      timeout: 10_000,
    })

    // Every card from the plan's File-Structure table should be
    // mounted; the gate is all-or-nothing.
    await expect(
      page.getByTestId('dashboard-metrics-connections')
    ).toBeVisible()
    await expect(page.getByTestId('dashboard-metrics-storage')).toBeVisible()
    await expect(page.getByTestId('dashboard-metrics-server')).toBeVisible()

    // The throughput card's "queries total" numeric chip must show a
    // real number — the test seed exercises queries during setup, so
    // by the time the dashboard mounts the counter is >= 0 (we accept
    // 0 here because a freshly-seeded stack hasn't necessarily issued
    // an admin-tracked query yet; the assertion catches the "—" / NaN
    // failure mode which would mean the proxy didn't return data).
    const queriesTotal = page.getByTestId('metrics-queries-total')
    await expect(queriesTotal).toBeVisible()
    const text = (await queriesTotal.textContent()) ?? ''
    expect(text.trim()).toMatch(/^\d+(,\d{3})*$/)

    // Server health pill must read either "Healthy" or "Degraded" —
    // the "—" / "Probe error" branches would mean the proxy didn't
    // hand us a server family.
    const healthPill = page.getByTestId('metrics-server-health')
    await expect(healthPill).toBeVisible()
    const healthText = (await healthPill.textContent()) ?? ''
    expect(healthText.trim()).toMatch(/^(Healthy|Degraded)$/)

    // The sparkline SVGs render even before history accumulates — the
    // Sparkline component guarantees a same-sized SVG with a hidden
    // title for accessibility on the empty-series branch.
    await expect(
      page.locator('[data-testid="metrics-throughput-sparkline"]')
    ).toBeAttached()
    await expect(
      page.locator('[data-testid="metrics-connections-sparkline"]')
    ).toBeAttached()
  })
})
