// Re-export of the production dark theme for use in unit tests.
//
// Tests that previously inlined a stub `{ colors: {...}, spacing: {...} }`
// object should `import { testTheme } from '@/test-utils/theme'` and
// pass it to <ThemeProvider theme={testTheme}>. This keeps the test
// surface aligned with the real Theme contract — when a new token is
// added to `Theme`, every test exercises it without per-file edits.
export { darkTheme as testTheme } from '@geodedb/ui-core/theme'
