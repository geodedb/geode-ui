import { defineConfig } from '@playwright/test'

// Electron e2e config — separate from the main browser-based suite
// (e2e/playwright.config.ts) because:
//
//   • No globalSetup. The Electron app boots its own SPA from the
//     bundled internal/ui/dist/ via the geode:// protocol — there is
//     no :8080 HTTP server for the browser suite's /healthz probe to
//     wait on.
//
//   • Single worker. Playwright's _electron API spawns a real Electron
//     process per `electronApp.launch()`. Even in headless xvfb the
//     window state files (~/.config/Geode/window-state.json) collide
//     under concurrency, and there's only ever one production Electron
//     window on a user's desktop anyway — parallel doesn't model the
//     real product.
//
//   • Custom test dir. Specs that drive the Electron binary live under
//     e2e/electron-specs/ so they're invisible to the chromium / mobile
//     / tablet projects which `testDir: './specs'` enumerates.
//
// Run with: npx playwright test --config=e2e/electron.config.ts
// (CI: xvfb-run -a npx playwright test --config=e2e/electron.config.ts)
export default defineConfig({
  testDir: './electron-specs',
  testMatch: '**/*.spec.ts',

  // Electron tests build/launch the real app — they're inherently
  // slower than browser-only specs. 60s per test absorbs the cold
  // startup hit on the first spec without masking real hangs.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-electron', open: 'never' }],
  ],

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
