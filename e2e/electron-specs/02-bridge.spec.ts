import { test, expect } from '@playwright/test'
import { launchElectron } from './helpers'

// The preload script exposes a tightly-scoped `window.geode` surface
// via contextBridge. This spec asserts the contract the SPA relies on:
// every IPC method the renderer reads must be defined as a function
// (not undefined, not a property on the prototype) and isElectron must
// resolve to true so the SPA's `isElectron` branch takes effect.
test.describe('Electron app — window.geode bridge', () => {
  test('exposes isElectron=true and the full IPC surface', async () => {
    const app = await launchElectron()
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      const bridge = await window.evaluate(() => {
        const w = globalThis as unknown as { geode?: Record<string, unknown> }
        if (!w.geode) return null
        return {
          isElectron: w.geode.isElectron,
          methods: Object.keys(w.geode)
            .filter((k) => typeof w.geode?.[k] === 'function')
            .sort(),
        }
      })

      expect(bridge, 'window.geode is not exposed').not.toBeNull()
      expect(bridge?.isElectron).toBe(true)
      // Lock in the IPC surface. Adding a method to the preload is a
      // deliberate decision (renderer's electron.d.ts must update in
      // lockstep) and this test acts as the contract test for that.
      expect(bridge?.methods).toEqual([
        'clearStoredPassword',
        'getSavedPasswordBiometricPref',
        'getStoredConnections',
        'getStoredPassword',
        'getSystemTheme',
        'getVersion',
        'onSystemThemeChange',
        'onWindowMaximizedChange',
        'openExternal',
        'openUnlockWindow',
        'pickPemFile',
        'setSavedPasswordBiometricPref',
        'storeConnections',
        'storeSavedPassword',
        'windowClose',
        'windowIsMaximized',
        'windowMinimize',
        'windowToggleMaximize',
      ])
    } finally {
      await app.close()
    }
  })

  test('getVersion() returns the app version via the main process', async () => {
    const app = await launchElectron()
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      const version = await window.evaluate(async () => {
        const w = globalThis as unknown as {
          geode: { getVersion: () => Promise<string> }
        }
        return w.geode.getVersion()
      })
      expect(version).toMatch(/^\d+\.\d+\.\d+/)
    } finally {
      await app.close()
    }
  })

  test('getSystemTheme() returns "light" or "dark"', async () => {
    const app = await launchElectron()
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      const theme = await window.evaluate(async () => {
        const w = globalThis as unknown as {
          geode: { getSystemTheme: () => Promise<string> }
        }
        return w.geode.getSystemTheme()
      })
      expect(['light', 'dark']).toContain(theme)
    } finally {
      await app.close()
    }
  })
})
