import { defineConfig, devices } from '@playwright/test'

const UI_URL = process.env.UI_URL ?? 'http://localhost:8080'
const graphPerformanceSpecs = [
  '**/19-graph-bench.spec.ts',
  '**/20-graph-scale-degradation.spec.ts',
]

export default defineConfig({
  testDir: './specs',
  testMatch: '**/*.spec.ts',
  globalSetup: require.resolve('./helpers/globalSetup'),

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Report the first exhausted failure immediately so workflow cancellation
  // can release the other jobs. Keep the existing per-test retry policy.
  maxFailures: process.env.CI ? 1 : 0,
  // The Schema Explorer, responsive-data-table, and multi-request specs
  // each run a query against the single upstream Geode v0.5.11 driver,
  // which serialises those queries — so under the suite's parallel
  // workers one of them can occasionally lag past its timeout. The
  // specs are deterministic on rerun; two retries absorbs the race
  // without masking real regressions (a deterministic failure still
  // fails three times). The helper in 06-schema-explorer.spec.ts also
  // re-navigates-and-retries on a slow introspection, which keeps the
  // common case from ever reaching the retry path.
  retries: 2,
  // Local default lowered from 4 → 2 to match CI. The new profile-
  // CRUD specs (14-profiles-page, 15-profile-api) collectively burst
  // past the per-actor rate limit (30 req/min, burst 10) when 4
  // workers fire profile POSTs concurrently. helpers/profiles.ts
  // already retries on 429, but the inline PATCH/DELETEs in the
  // tests themselves don't, and the SPA's setAsDefault dance has no
  // server-side retry. workers=2 halves the burst pressure.
  workers: 2,

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
    ...((process.env.CI ? [['github'] as const] : []) as never),
  ],

  // CI runs the stack and the browser inside one dind job on a shared
  // autoscaler VM that other jobs keep CPU-bound. There the same specs
  // take 20-25 s each (1-2 s locally), so the browser-side waits, not the
  // backend (query_executed elapsed_ms stays in single digits), ran past
  // a 30 s budget. Give CI 3x the time; local runs keep the tight limits
  // so a real slowdown still shows up during development.
  timeout: process.env.CI ? 90_000 : 30_000,
  expect: { timeout: process.env.CI ? 20_000 : 8_000 },

  use: {
    baseURL: UI_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      testIgnore: graphPerformanceSpecs,
      use: { ...devices['Desktop Chrome'] },
    },
    // Mobile + tablet projects exercise the same suite at the
    // viewports we promise to support after Phase 3 of the UI audit.
    // The hamburger drawer, GraphView vertical-stack, and SchemaExplorer
    // 1-column layout are validated end-to-end here.
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      // Specs that depend on the desktop sidebar (Schema sidebar
      // selectors etc.) skip via test.skip when project.name matches.
      grep: /@mobile|@responsive|@auth/,
    },
    {
      // Chromium-based tablet emulation. The original `iPad (gen 7)`
      // device entry is webkit-backed, which requires extra system
      // libraries (libflite, libavif, libwebp …) that aren't part of
      // the chromium dependency closure. Sticking to chromium with an
      // iPad-sized viewport keeps the tablet sweep self-contained.
      name: 'tablet-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 810, height: 1080 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
      grep: /@tablet|@responsive|@auth/,
    },
    {
      name: 'chromium-graph-performance',
      testMatch: graphPerformanceSpecs,
      use: { ...devices['Desktop Chrome'] },
      // The 6,000-node degradation check and renderer benchmark shared the
      // software GPU with each other and the functional suite. Run them one
      // at a time after CI's functional projects, retaining every fixture,
      // assertion and timeout. Local focused benchmarks stay independent.
      workers: 1,
      dependencies: process.env.CI
        ? ['chromium', 'mobile-chrome', 'tablet-chrome']
        : [],
    },
  ],
})
