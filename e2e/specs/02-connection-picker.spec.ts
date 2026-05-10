import { test, expect } from '../fixtures'

// Post-Plan-C, the legacy free-text ConnectionPicker is replaced by
// ConnectionSwitcher: a header-mounted dropdown that lists active
// in-memory connections and offers switch/disconnect/+add affordances.
// The localStorage-keyed 'geode-ui.profile' cache that the legacy
// picker honoured is intentionally not consulted — the active session
// is the source of truth.
test.describe('connection switcher', () => {
  test('header trigger shows the active connection name', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    // The fixture seeds an active connection on profile 'default', so
    // the switcher trigger button should display that name.
    await expect(
      page.getByRole('button', { name: /default/i })
    ).toBeVisible()
  })

  test('opening the dropdown reveals the connection row + add affordance', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    // Click the switcher trigger button to expand the menu.
    const trigger = page
      .getByRole('button', { name: /default/i, exact: false })
      .first()
    await trigger.click()
    // Connection row uses role=menuitemradio per ConnectionSwitcher.tsx.
    await expect(
      page.getByRole('menuitemradio', { name: /default/i })
    ).toBeVisible()
    // Footer row offers adding another connection.
    await expect(page.getByText(/add another connection/i)).toBeVisible()
  })
})
