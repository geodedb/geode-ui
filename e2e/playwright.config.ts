import { defineConfig, devices } from '@playwright/test'

const UI_URL = process.env.UI_URL ?? 'http://localhost:8080'

export default defineConfig({
  testDir: './specs',
  testMatch: '**/*.spec.ts',
  globalSetup: require.resolve('./helpers/globalSetup'),

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
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

  timeout: 30_000,
  expect: { timeout: 8_000 },

  use: {
    baseURL: UI_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
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
  ],
})
