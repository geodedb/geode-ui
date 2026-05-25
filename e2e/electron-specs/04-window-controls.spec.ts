import { test, expect } from '@playwright/test'
import { launchElectron } from './helpers'

// Themed window-control buttons render in the SPA's Top nav on
// Linux + Windows. macOS keeps native traffic lights so the custom
// controls are deliberately suppressed there. Run the Electron
// binary, walk the SPA to the top nav, assert the three buttons
// are present + sit inside a no-drag region.
test.describe('Electron app — themed window controls', () => {
  test('three control buttons render and sit in a no-drag region', async () => {
    const app = await launchElectron()
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      const platform = await window.evaluate(
        () =>
          (globalThis as unknown as { geode?: { platform: string } }).geode
            ?.platform ?? 'unknown'
      )
      test.skip(
        platform === 'darwin',
        'macOS uses native traffic lights; custom controls are not rendered'
      )

      const minimize = window.getByTestId('window-control-minimize')
      const maximize = window.getByTestId('window-control-maximize')
      const fullscreen = window.getByTestId('window-control-fullscreen')
      const close = window.getByTestId('window-control-close')

      await expect(minimize).toBeVisible({ timeout: 10_000 })
      await expect(maximize).toBeVisible()
      await expect(fullscreen).toBeVisible()
      await expect(close).toBeVisible()

      // The buttons' wrapping Bar must opt out of the title-bar drag
      // region — otherwise clicks would slip through into the drag
      // handler instead of firing the IPC.
      const noDrag = await close.evaluate((el) =>
        getComputedStyle(el.parentElement as HTMLElement)
          .getPropertyValue('-webkit-app-region')
          .trim()
      )
      expect(noDrag).toBe('no-drag')
    } finally {
      await app.close()
    }
  })

  test('preload bridge surfaces every window-control method', async () => {
    const app = await launchElectron()
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      const methods = await window.evaluate(() => {
        const w = globalThis as unknown as { geode?: Record<string, unknown> }
        if (!w.geode) return null
        return [
          'windowMinimize',
          'windowToggleMaximize',
          'windowToggleFullscreen',
          'windowIsFullscreen',
          'onWindowFullscreenChange',
          'windowClose',
          'windowIsMaximized',
          'onWindowMaximizedChange',
        ].map((name) => ({ name, type: typeof w.geode?.[name] }))
      })

      expect(methods).not.toBeNull()
      methods!.forEach((m) => {
        expect(m.type, `${m.name} should be a function`).toBe('function')
      })
    } finally {
      await app.close()
    }
  })
})
