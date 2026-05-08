import { defineConfig, devices } from '@playwright/test'

const UI_URL = process.env.UI_URL ?? 'http://localhost:8080'

export default defineConfig({
  testDir: './specs',
  testMatch: '**/*.spec.ts',
  globalSetup: require.resolve('./helpers/globalSetup'),

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Retry once locally too — the Schema Explorer + multi-request specs
  // flake occasionally under 4-worker parallel load against a single
  // upstream Geode driver. The tests are deterministic on rerun; this
  // absorbs the race without masking real regressions (a deterministic
  // failure would still fail twice).
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : 4,

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
