import {
  app,
  BrowserWindow,
  Menu,
  protocol,
  shell,
  ipcMain,
  nativeTheme,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'

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
  // Map geode://app/<path> to <DIST_DIR>/<path>. We resolve via path.join
  // and then verify the resolved path stays within DIST_DIR so a
  // crafted geode://app/../../etc/passwd request can't escape the
  // sandbox.
  protocol.handle(PROTOCOL_NAME, async (request) => {
    const url = new URL(request.url)
    const requested =
      decodeURIComponent(url.pathname.replace(/^\//, '')) || 'index.html'
    const resolved = path.normalize(path.join(DIST_DIR, requested))
    if (!resolved.startsWith(DIST_DIR + path.sep) && resolved !== DIST_DIR) {
      return new Response('forbidden', { status: 403 })
    }
    try {
      const data = await fs.readFile(resolved)
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': contentType(resolved) },
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

function contentType(p: string): string {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8'
  if (p.endsWith('.js') || p.endsWith('.mjs')) return 'text/javascript'
  if (p.endsWith('.css')) return 'text/css'
  if (p.endsWith('.json')) return 'application/json'
  if (p.endsWith('.svg')) return 'image/svg+xml'
  if (p.endsWith('.png')) return 'image/png'
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg'
  if (p.endsWith('.woff2')) return 'font/woff2'
  if (p.endsWith('.woff')) return 'font/woff'
  if (p.endsWith('.ttf')) return 'font/ttf'
  if (p.endsWith('.ico')) return 'image/x-icon'
  return 'application/octet-stream'
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
  // rather than a new electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Block in-process navigation to anything outside our protocol.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${PROTOCOL_NAME}://`)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  await win.loadURL(APP_URL)
}

ipcMain.handle('geode:get-version', () => app.getVersion())
ipcMain.handle('geode:open-external', async (_evt, url: string) => {
  if (typeof url !== 'string') return false
  // Whitelist to https / mailto only — never let the renderer ask the
  // OS to launch arbitrary file:// or custom-protocol URLs.
  if (!/^https:|^mailto:/.test(url)) return false
  await shell.openExternal(url)
  return true
})
ipcMain.handle('geode:get-system-theme', () =>
  nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
)
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
