import {
  app,
  BrowserWindow,
  Menu,
  protocol,
  shell,
  ipcMain,
  nativeTheme,
  safeStorage,
  dialog,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'

import {
  contentTypeFor,
  isAllowedExternal,
  resolveProtocolAsset,
  safeOpenExternal,
} from './lib/safety'
import { AssetCache, defaultCacheOptions } from './lib/cache'
import { createSecureStore, SecureStore } from './lib/secure-store'

// P-NEW-7: keep recently-served SPA assets in memory so a hard reload
// or a tight burst of subresource requests don't all hit the disk.
// Sized to comfortably hold the whole geode-ui dist (HTML + chunks +
// fonts + icons + manifest); evicts on LRU + byte-budget pressure.
const assetCache = new AssetCache(defaultCacheOptions())

// Geode UI — Electron main process.
//
// The renderer is the same React SPA that ships to the browser via the
// Go server's internal/ui/dist embed. We register a privileged
// `geode://` custom protocol so the SPA loads without needing to relax
// CSP for `file://` (which has its own footguns: localStorage scoped
// per-path, fetch() to relative paths broken, etc.). The protocol
// handler simply maps geode://app/<path> back to the on-disk dist
// folder produced by `pnpm build`.
//
// Security baseline:
//   - contextIsolation: true
//   - nodeIntegration:  false
//   - sandbox:          true
//   - preload exposes a small typed surface via contextBridge.
//   - external <a target="_blank"> opens in the OS browser, never in
//     a popup electron window (mitigates phishing inside the app).
//   - on `will-navigate`, prevent navigation to anything that isn't
//     under our custom geode:// origin.

// __dirname resolves to the compiled output directory under
// internal/ui/electron-dist/ at runtime; the SPA assets live at
// ../../internal/ui/dist/ relative to that.
const DIST_DIR = path.resolve(__dirname, '..', 'dist')
const PROTOCOL_NAME = 'geode'
const APP_URL = `${PROTOCOL_NAME}://app/index.html`

// Persist window state across launches. The store lives next to the
// userData dir so it travels with the user's profile.
interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

function statePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
}

let _store: SecureStore | null = null
function secureStore(): SecureStore {
  if (!_store) {
    _store = createSecureStore({
      storePath: path.join(app.getPath('userData'), 'secure-store.json'),
      safeStorage,
    })
  }
  return _store
}

function pwKey(profileName: string, username: string): string {
  return `${profileName}\x00${username}`
}

async function loadWindowState(): Promise<WindowState> {
  try {
    const raw = await fs.readFile(statePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<WindowState>
    return {
      width: typeof parsed.width === 'number' ? parsed.width : 1280,
      height: typeof parsed.height === 'number' ? parsed.height : 800,
      x: typeof parsed.x === 'number' ? parsed.x : undefined,
      y: typeof parsed.y === 'number' ? parsed.y : undefined,
      maximized: parsed.maximized === true,
    }
  } catch {
    return { width: 1280, height: 800 }
  }
}

async function saveWindowState(win: BrowserWindow): Promise<void> {
  const bounds = win.getBounds()
  const state: WindowState = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized: win.isMaximized(),
  }
  try {
    await fs.writeFile(statePath(), JSON.stringify(state, null, 2), 'utf8')
  } catch {
    // Window-state persistence is best-effort. Failure here would only
    // mean the user gets the default size on next launch.
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: PROTOCOL_NAME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      allowServiceWorkers: false,
    },
  },
])

function registerProtocol(): void {
  // Path-traversal containment + content-type derivation live in
  // ./lib/safety so they're testable without `electron` in deps —
  // see __tests__/electron-safety.test.ts (Q-NEW-1 closure).
  protocol.handle(PROTOCOL_NAME, async (request) => {
    const url = new URL(request.url)
    const requested = decodeURIComponent(url.pathname)
    const resolution = resolveProtocolAsset(DIST_DIR, requested)
    if (!resolution.ok) {
      return new Response(resolution.reason, {
        status: resolution.reason === 'forbidden' ? 403 : 400,
      })
    }
    try {
      const cached = assetCache.get(resolution.filePath)
      let data: Uint8Array
      if (cached) {
        data = cached
      } else {
        const buf = await fs.readFile(resolution.filePath)
        data = new Uint8Array(buf)
        assetCache.set(resolution.filePath, data)
      }
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': contentTypeFor(resolution.filePath) },
      })
    } catch {
      // SPA fallback: any unknown path returns index.html so client-side
      // routes (/, /schema, /admin, /ops) work after a hard reload.
      try {
        const data = await fs.readFile(path.join(DIST_DIR, 'index.html'))
        return new Response(data, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      } catch {
        return new Response('not found', { status: 404 })
      }
    }
  })
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' as const } : { role: 'quit' as const }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const },
            ]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      role: 'help' as const,
      submenu: [
        {
          label: 'Geode documentation',
          click: () => shell.openExternal('https://geodedb.com/docs/'),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function createWindow(): Promise<void> {
  const state = await loadWindowState()
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 480,
    minHeight: 540,
    backgroundColor: '#1c0f2e',
    title: 'Geode',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  if (state.maximized) win.maximize()

  win.once('ready-to-show', () => win.show())

  const persist = (): void => {
    void saveWindowState(win)
  }
  win.on('resize', persist)
  win.on('move', persist)
  win.on('close', persist)

  // Force any external link to open in the user's default browser
  // rather than a new electron window. Pre-S1 the URL was passed
  // straight to shell.openExternal; that bypassed the
  // `isAllowedExternal` whitelist and let a renderer compromise (or a
  // crafted anchor that survived CSP) ask the OS to launch
  // `file://`, `javascript:`, or arbitrary custom-scheme URLs. Both
  // hand-offs now funnel through `safeOpenExternal`, which mirrors
  // the gate the IPC handler `geode:open-external` already enforced.
  win.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url, (u) => {
      void shell.openExternal(u)
    })
    return { action: 'deny' }
  })

  // Block in-process navigation to anything outside our protocol.
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(`${PROTOCOL_NAME}://`)) return
    event.preventDefault()
    safeOpenExternal(url, (u) => {
      void shell.openExternal(u)
    })
  })

  await win.loadURL(APP_URL)
}

ipcMain.handle('geode:get-version', () => app.getVersion())
ipcMain.handle('geode:get-stored-connections', async () => {
  const doc = await secureStore().read()
  const now = Date.now()
  return (doc.connections ?? []).filter((c) => c.expiresAt > now)
})

ipcMain.handle(
  'geode:store-connections',
  async (
    _evt,
    list: Array<{
      connectionId: string
      token: string
      profileName: string
      expiresAt: number
    }>
  ) => {
    const doc = await secureStore().read()
    await secureStore().write({ ...doc, connections: list })
    return true
  }
)

ipcMain.handle(
  'geode:get-stored-password',
  async (_evt, profileName: string, username: string) => {
    const doc = await secureStore().read()
    return doc.passwords?.[pwKey(profileName, username)] ?? null
  }
)

ipcMain.handle(
  'geode:store-saved-password',
  async (_evt, profileName: string, username: string, password: string) => {
    const doc = await secureStore().read()
    const passwords = { ...(doc.passwords ?? {}) }
    passwords[pwKey(profileName, username)] = password
    await secureStore().write({ ...doc, passwords })
    return true
  }
)

ipcMain.handle(
  'geode:clear-stored-password',
  async (_evt, profileName: string, username: string) => {
    const doc = await secureStore().read()
    if (!doc.passwords) return true
    const passwords = { ...doc.passwords }
    delete passwords[pwKey(profileName, username)]
    await secureStore().write({ ...doc, passwords })
    return true
  }
)
ipcMain.handle('geode:open-external', async (_evt, url: string) => {
  if (typeof url !== 'string') return false
  // Whitelist to https / mailto only — never let the renderer ask the
  // OS to launch arbitrary file:// or custom-protocol URLs.
  if (!isAllowedExternal(url)) return false
  await shell.openExternal(url)
  return true
})
ipcMain.handle('geode:get-system-theme', () =>
  nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
)

ipcMain.handle('geode:pick-pem-file', async (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender)
  if (!win) return null
  const result = await dialog.showOpenDialog(win, {
    title: 'Select a PEM file',
    properties: ['openFile'],
    filters: [
      { name: 'PEM files', extensions: ['pem', 'crt', 'key', 'cert', 'cer'] },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]!
  // Cap at 1 MiB — PEM material is normally < 10 KB; anything larger
  // is almost certainly not a real cert.
  const stat = await fs.stat(filePath)
  if (stat.size > 1024 * 1024) return null
  return fs.readFile(filePath, 'utf8')
})
nativeTheme.on('updated', () => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(
      'geode:system-theme-changed',
      nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    )
  }
})

void app.whenReady().then(() => {
  registerProtocol()
  buildMenu()
  void createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// PSR-F6 (#92): drain any pending debounced secure-store writes before
// the process exits. Without this hook, a user who quits inside the
// 250ms coalescing window would lose freshly minted JWTs from the
// connection switcher (or saved passwords from a sign-in burst). The
// store only has work to do if it was lazily initialised, so we guard
// on `_store` to avoid forcing a cold-start decrypt on quit.
app.on('before-quit', (event) => {
  if (!_store) return
  // before-quit fires synchronously; flushSync is a Promise but we
  // can't `await` here without tearing the event semantics. The store's
  // own writeChain serialises file ops, so we kick the flush and let
  // electron's quit-deferral keep the process alive long enough for
  // the rename to finish (well under the OS-imposed quit timeout).
  event.preventDefault()
  _store
    .flushSync()
    .catch(() => {
      // Persistence failure here is best-effort; the user already
      // asked to quit and there's no UI surface to surface this on.
    })
    .finally(() => {
      // Re-enter the quit path once the disk image is consistent.
      app.exit(0)
    })
})
