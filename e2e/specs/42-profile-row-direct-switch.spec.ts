// e2e/specs/42-profile-row-direct-switch.spec.ts
//
// 2026-05-22 bug report — the operator opens the chrome
// ConnectionSwitcher dropdown, clicks a CONFIGURED-but-not-active
// profile row directly (not via "Add another connection"), enters
// credentials, and submits. The new profile must become the active
// connection.
//
// Pre-fix the path landed in three follow-up commits:
//   1. ConnectionSwitcher's "configured profile row" branch routes to
//      AddConnectionModal with `initialProfile=<name>`.
//   2. The modal called `switchActive(newConnectionId)` after
//      connectMore resolved — but the running submit's closure had a
//      stale `conns.connections` Map (pre-`add`-dispatch), so the
//      guard read returned undefined and switchActive silently
//      no-op'd. (c82a613 / 04a52d6)
//   3. After (2) the activeId flipped, but the activate branch in
//      performAuth never reset useQueryPageStore — the chrome label
//      moved but the QueryPage kept rendering the previous profile's
//      submittedStmt + result. (c1e8701 / fix commit)
//
// The bleed-through fix is pinned by
// src/components/layout/AddConnectionModal.activation.test.tsx;
// this spec pins the chrome-visible flow.

import { expect } from '@playwright/test'
import { test as authedTest } from '../fixtures'
import { sel } from '../helpers/selectors'

const ADMIN_USER = process.env.ADMIN_USER ?? 'geode'
const ADMIN_PASS =
  process.env.ADMIN_PASSWORD ?? 'Geode E2E Bootstrap Password 2024'

authedTest.describe('chrome dropdown → configured profile row → submit', () => {
  authedTest(
    'clicking the social profile row directly opens the modal pre-selected and activates after submit',
    async ({ authedPage: page }) => {
      await page.goto('/')

      // Open the chrome dropdown and click the CONFIGURED-but-inactive
      // social row directly (the user's exact path — NOT the "Add
      // another connection" menu item).
      await sel.connectionTrigger(page).click()
      await page
        .getByTestId('connection-row-profile-social')
        .click({ force: true })

      // The modal must open with the profile picker pre-selected to
      // 'social' — pre-fix the public-profiles default 'default'
      // raced and overwrote.
      await expect(page.locator('#add-profile')).toHaveValue('social', {
        timeout: 5000,
      })

      await page.getByLabel('Username').fill(ADMIN_USER)
      await page.getByLabel('Password').fill(ADMIN_PASS)
      await sel.addConnectionSubmit(page).click()
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

      // RELEASE-BLOCKER: chrome label must now reflect the new active
      // profile. Pre-fix the activeId stayed at 'default' because
      // switchActive silently no-op'd against a stale reducer snapshot.
      // We address the trigger by test-id (not by name regex) because
      // the selector helper is hard-coded to /default/i and would no
      // longer match after the activation.
      const trigger = page.getByTestId('connection-trigger')
      await expect(trigger).toHaveText(/social/i, { timeout: 5000 })

      // Open the dropdown again — social must be the active radio.
      await trigger.click()
      await expect(
        page.getByRole('menuitemradio', { name: /social/i })
      ).toHaveAttribute('aria-checked', 'true', { timeout: 5000 })
    }
  )
})
