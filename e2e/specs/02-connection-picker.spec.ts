import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'

test.describe('connection picker', () => {
  test('lists at least the default profile', async ({ authedPage: page }) => {
    await page.goto('/')
    await expect(sel.connection(page)).toBeVisible()
    const value = await sel.connection(page).inputValue()
    expect(value).toBe('default')
    const options = await sel
      .connection(page)
      .locator('option')
      .allTextContents()
    expect(options).toContain('default')
  })

  test('selecting a profile persists in localStorage', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await sel.connection(page).selectOption('default')
    const stored = await page.evaluate(() =>
      localStorage.getItem('geode-ui.profile')
    )
    expect(stored).toBe('default')
  })
})
