import { test, expect } from '@playwright/test'
import { launchElectron } from './helpers'

// Smoke: the compiled Electron entrypoint boots, a single BrowserWindow
// appears, and the SPA loads via the geode:// custom protocol without
// crashing the renderer.
test.describe('Electron app — launch', () => {
  test('opens exactly one window and reports Geode as its title', async () => {
    const app = await launchElectron()
    try {
      const window = await app.firstWindow()
      // SPA renders index.html via geode://app/index.html — the
      // <title> tag in dist/index.html is "Geode".
      await expect.poll(() => window.title()).toMatch(/Geode/i)

      const windows = app.windows()
      expect(windows.length).toBe(1)

      // The main process exposes app.getVersion() through evaluate().
      const version = await app.evaluate(({ app: a }) => a.getVersion())
      // electron-builder stamps package.json#version onto the packaged
      // build; in dev (running compiled main.js directly) electron's
      // app.getVersion() falls back to package.json#version, which is
      // the same string. Either way it must be non-empty.
      expect(version).toMatch(/^\d+\.\d+\.\d+/)
    } finally {
      await app.close()
    }
  })

  test('renderer reaches DOMContentLoaded under the geode:// origin', async () => {
    const app = await launchElectron()
    try {
      const window = await app.firstWindow()
      // waitForLoadState('domcontentloaded') is the cheapest possible
      // proof that protocol.handle resolved index.html — anything else
      // (404, electron unable to map the scheme, preload throwing) would
      // abort the load before this resolves.
      await window.waitForLoadState('domcontentloaded')

      const origin = await window.evaluate(() => globalThis.location.origin)
      expect(origin).toBe('geode://app')

      // SPA renders #root once React mounts; the bootstrap script in
      // index.html is synchronous-with-defer, so by DOMContentLoaded
      // the element is already in the tree.
      const hasRoot = await window.evaluate(
        () => !!document.getElementById('root')
      )
      expect(hasRoot).toBe(true)
    } finally {
      await app.close()
    }
  })
})
