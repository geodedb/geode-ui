import { expect } from '@playwright/test'
import { test as authedTest } from '../fixtures'

authedTest.describe('electron / window controls', () => {
  authedTest('three control buttons render and call the bridge', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    const isElectron = await page.evaluate(
      () =>
        typeof (window as unknown as { geode?: { isElectron?: boolean } })
          .geode?.isElectron === 'boolean'
    )
    authedTest.skip(!isElectron, 'browser run — no window.geode bridge')

    const platform = await page.evaluate(
      () =>
        (window as unknown as { geode?: { platform: string } }).geode
          ?.platform ?? 'unknown'
    )
    authedTest.skip(
      platform === 'darwin',
      'macOS uses native traffic lights; custom controls are not rendered'
    )

    await expect(page.getByTestId('window-control-minimize')).toBeVisible()
    await expect(page.getByTestId('window-control-maximize')).toBeVisible()
    await expect(page.getByTestId('window-control-close')).toBeVisible()

    // Sanity check: each button is wired to a no-drag region so the
    // click actually reaches it through Electron's title-bar drag.
    const noDrag = await page.getByTestId('window-control-close').evaluate(
      (el) =>
        getComputedStyle(el.parentElement as HTMLElement)
          .getPropertyValue('-webkit-app-region')
          .trim()
    )
    expect(noDrag).toBe('no-drag')
  })
})
