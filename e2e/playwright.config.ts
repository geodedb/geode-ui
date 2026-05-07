import { defineConfig, devices } from '@playwright/test'

const UI_URL = process.env.UI_URL ?? 'http://localhost:8080'

export default defineConfig({
  testDir: './specs',
  testMatch: '**/*.spec.ts',
  globalSetup: require.resolve('./helpers/globalSetup'),

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
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

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
