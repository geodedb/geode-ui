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
  session,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'

import {
  buildCspValue,
  buildPermissionHandlers,
  cacheControlFor,
  contentTypeFor,
  isAllowedExternal,
  resolveProtocolAsset,
  safeOpenExternal,
} from './lib/safety'
import { AssetCache, defaultCacheOptions } from './lib/cache'
import { createSecureStore, SecureStore } from './lib/secure-store'
import { resolveServerUrl } from './lib/server-url'
import {
  safeReadPemFile,
  sanitizeConnections,
  sanitizeSavedPasswordInput,
} from './lib/ipc-guards'

// Hard caps for IPC-supplied payloads (S8 — GitLab #121). Pre-fix the
// `geode:store-connections` and `geode:store-saved-password` handlers
// took whatever shape the renderer sent. A compromised renderer could
// submit an unbounded array, type-confused fields, or non-finite
// expiry timestamps; the secure-store would dutifully encrypt them.
//
// These caps are deliberately generous: 32 active connections per user
// is more than the connection switcher could plausibly enumerate,
// 4 KB tokens accommodate JWT + refresh-token style credentials, and
// 7-day forward expiry matches the JWT issuer's max lifetime.
const STORE_CONNECTIONS_MAX = 32
const STORE_TOKEN_MAX_LEN = 4096
const STORE_NAME_MAX_LEN = 128
const STORE_USERNAME_MAX_LEN = 256
const STORE_PASSWORD_MAX_LEN = 1024
const STORE_EXPIRES_FORWARD_MS = 7 * 24 * 60 * 60 * 1000
// 1 MiB cap on PEM material — real certs/keys are typically <10 KB; a
// file larger than this is almost certainly the wrong thing.
const PEM_FILE_MAX_BYTES = 1024 * 1024

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
// Load the SPA from the protocol root so `location.pathname` is `/`,
// which is what BrowserRouter expects as the initial route. Loading
// `geode://app/index.html` made the renderer's pathname `/index.html`,
// which React Router treats as an unknown route ("No routes matched
// location /index.html") — the SPA renders the catch-all instead of
// the Login page. The protocol handler falls back to index.html when
// the requested path doesn't resolve to a file on disk, so the root
// path still serves the SPA shell.
const APP_URL = `${PROTOCOL_NAME}://app/`

// SPA → geode-ui server origin. The renderer's window.location.origin
// is `geode://app` (the privileged custom scheme), which the SPA's
// generated API client rejects ("base URL must use http or https").
// Operators point at their geode-ui server via the GEODE_SERVER_URL
// env var; the http://localhost:8080 default matches the docker-
// compose stack a developer runs side-by-side with the desktop build.
// Read once at main-process startup and surfaced to the renderer
// through the preload (see `geode:get-server-url-sync`). The actual
// validation lives in ./lib/server-url.ts so it can be unit-tested
// without `electron` in the import graph.
const SERVER_URL = resolveServerUrl(process.env)

// APP-02 + APP-09 (2026-05-24 appsec): the locked CSP value applied to
// every `geode://` protocol response. Derived once at startup so the
// header bytes are stable across requests and so a future serverUrl
// rotation requires a process restart (which is the current operator
// contract for `GEODE_SERVER_URL`).
const CSP_VALUE = buildCspValue(SERVER_URL)

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
  } catch (err) {
    // PSR-G11 (#88): window-state persistence is best-effort -- a
    // failure here only means the user gets default sizing on next
    // launch -- but the silent swallow hid misconfigured AppData paths
    // and read-only volumes. Surface the error via console.warn so it
    // shows up in dev tools / electron-log forwarders without blocking
    // the close path.
    console.warn('[geode] saveWindowState failed:', err)
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
      // APP-02 + APP-09: every successful response carries the locked
      // CSP, the `nosniff` content-type pin, a no-referrer policy
      // (renderer must not leak privileged-scheme paths to a server
      // it just connected to), and an extension-keyed Cache-Control.
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': contentTypeFor(resolution.filePath),
          'Content-Security-Policy': CSP_VALUE,
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Cache-Control': cacheControlFor(resolution.filePath),
        },
      })
    } catch {
      // SPA fallback: any unknown path returns index.html so client-side
      // routes (/, /schema, /admin, /ops) work after a hard reload.
      try {
        const data = await fs.readFile(path.join(DIST_DIR, 'index.html'))
        // APP-02 + APP-09: SPA fallback inherits the same headers as
        // the success branch. `index.html` is `no-store` so the SPA
        // shell can never be stale, and the locked CSP applies even
        // to the fallback path.
        return new Response(data, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': CSP_VALUE,
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
            'Cache-Control': 'no-store',
          },
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

// Synchronous IPC: preload reads this at bridge construction time so
// `window.geode.serverUrl` is a plain string the SPA can consume from
// its synchronous bootstrap (resolveBaseUrl in src/api/client.ts).
// sendSync is intentional — the value is fixed at process start and
// the preload has no async window before contextBridge.exposeInMainWorld
// is called.
ipcMain.on('geode:get-server-url-sync', (evt) => {
  evt.returnValue = SERVER_URL
})
ipcMain.handle('geode:get-version', () => app.getVersion())
ipcMain.handle('geode:get-stored-connections', async () => {
  const doc = await secureStore().read()
  const now = Date.now()
  return (doc.connections ?? []).filter((c) => c.expiresAt > now)
})

ipcMain.handle('geode:store-connections', async (_evt, raw: unknown) => {
  // S8 (#121): validate the renderer-supplied list before persisting.
  // A compromised renderer can hand us anything, including arbitrary
  // JSON shapes or absurdly large arrays. Reject hard if validation
  // fails — pre-fix the bad shape would round-trip through encrypt +
  // disk + memo and return as `getStoredConnections()` later.
  const list = sanitizeConnections(raw, {
    maxLen: STORE_CONNECTIONS_MAX,
    maxTokenLen: STORE_TOKEN_MAX_LEN,
    maxNameLen: STORE_NAME_MAX_LEN,
    maxExpiresMs: STORE_EXPIRES_FORWARD_MS,
  })
  if (list === null) {
    // Surface a renderer-visible error so the caller can decide
    // whether to retry. We deliberately do NOT echo the offending
    // shape back — the renderer already has it.
    throw new Error('geode:store-connections: invalid payload shape')
  }
  const doc = await secureStore().read()
  await secureStore().write({ ...doc, connections: list })
  return true
})

ipcMain.handle(
  'geode:get-stored-password',
  async (_evt, profileName: unknown, username: unknown) => {
    // S8 (#121): the read path takes the same untrusted input shape;
    // validate to prevent type-confused lookups (e.g. `{}` colliding
    // with the empty-string key, or a number coerced via the pwKey
    // template literal into a key for an unrelated entry).
    if (
      typeof profileName !== 'string' ||
      typeof username !== 'string' ||
      profileName.length === 0 ||
      username.length === 0 ||
      profileName.length > STORE_NAME_MAX_LEN ||
      username.length > STORE_USERNAME_MAX_LEN ||
      profileName.includes('\x00') ||
      username.includes('\x00')
    ) {
      return null
    }
    const doc = await secureStore().read()
    return doc.passwords?.[pwKey(profileName, username)] ?? null
  }
)

ipcMain.handle(
  'geode:store-saved-password',
  async (_evt, profileName: unknown, username: unknown, password: unknown) => {
    // S8 (#121): validate the triple as a single object so the helper
    // can enforce per-field caps and the no-null-byte invariant
    // around the pwKey separator.
    const sanitized = sanitizeSavedPasswordInput(
      { profile: profileName, username, password },
      {
        maxNameLen: STORE_NAME_MAX_LEN,
        maxUsernameLen: STORE_USERNAME_MAX_LEN,
        maxPasswordLen: STORE_PASSWORD_MAX_LEN,
      }
    )
    if (sanitized === null) {
      throw new Error('geode:store-saved-password: invalid payload shape')
    }
    const doc = await secureStore().read()
    const passwords = { ...(doc.passwords ?? {}) }
    passwords[pwKey(sanitized.profile, sanitized.username)] = sanitized.password
    await secureStore().write({ ...doc, passwords })
    return true
  }
)

ipcMain.handle(
  'geode:clear-stored-password',
  async (_evt, profileName: unknown, username: unknown) => {
    // S8 (#121): same input gate as the read path. A malformed clear
    // request silently returns true (idempotent), avoiding an
    // observable error channel that could be used to probe key shape.
    if (
      typeof profileName !== 'string' ||
      typeof username !== 'string' ||
      profileName.length === 0 ||
      username.length === 0 ||
      profileName.length > STORE_NAME_MAX_LEN ||
      username.length > STORE_USERNAME_MAX_LEN ||
      profileName.includes('\x00') ||
      username.includes('\x00')
    ) {
      return true
    }
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
  // S3 (#116): drop the `extensions: ['*']` "All files" filter — pre-fix
  // the dialog let the user pick any pseudo-file (block device, FIFO,
  // device node) which the read-then-stat path would happily slurp
  // into the encrypted profile store.
  const result = await dialog.showOpenDialog(win, {
    title: 'Select a PEM file',
    properties: ['openFile'],
    filters: [
      { name: 'PEM files', extensions: ['pem', 'crt', 'key', 'cert', 'cer'] },
    ],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]!
  // S3 (#116): the read goes through `safeReadPemFile`, which:
  //   • opens the path with O_NOFOLLOW so symlinks are rejected;
  //   • fstats the descriptor (closing the TOCTOU window between the
  //     pre-fix `fs.stat` and `fs.readFile` calls);
  //   • caps the file at 1 MiB before any bytes are read;
  //   • validates the body is PEM-shaped (BEGIN/END armor lines).
  // Any failure returns null so the renderer surface stays unchanged
  // while the security contract tightens.
  try {
    return await safeReadPemFile(filePath, { maxBytes: PEM_FILE_MAX_BYTES })
  } catch {
    return null
  }
})
nativeTheme.on('updated', () => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(
      'geode:system-theme-changed',
      nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    )
  }
})

// APP-05 (2026-05-24 appsec): the allow-list for OS-integration
// permissions the privileged `geode://` scheme may request. The current
// SPA needs none, so the set is empty — the deny-by-default handler in
// `safety.ts/buildPermissionHandlers` will reject every prompt. To opt
// in a future feature, add the permission name here AND document it in
// `docs/ELECTRON.md`'s permission policy section.
const ALLOWED_PERMS: ReadonlySet<string> = new Set<string>()

void app.whenReady().then(() => {
  // APP-05: install the deny-by-default permission handlers BEFORE the
  // first window is created so the BrowserWindow inherits the policy
  // for its initial paint. Both the request handler (called when the
  // renderer triggers a prompt) and the check handler (called for
  // permission-state queries like `navigator.permissions.query`) reject
  // anything not in `ALLOWED_PERMS`.
  const { permissionRequestHandler, permissionCheckHandler } =
    buildPermissionHandlers(ALLOWED_PERMS)
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      permissionRequestHandler(webContents, permission, callback)
    }
  )
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission) => permissionCheckHandler(webContents, permission)
  )

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
