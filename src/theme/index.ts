// Transitional re-export shim. The theme system has moved to @geodedb/ui-core/theme.
// This shim keeps the app compiling during the migration; it will be deleted in
// the "consume back" task (see docs/superpowers/plans/2026-05-20-ui-core-extraction-and-storybook.md).
export * from '@geodedb/ui-core/theme'
export { darkTheme as theme } from '@geodedb/ui-core/theme'
