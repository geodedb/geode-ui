import { contextBridge, ipcRenderer } from 'electron'

// Q4 / PSR-G07: ConnectionRecord, ThemeVariant, and GeodeBridge live
// in `./shared/bridge-types`. Both this preload AND the renderer's
// `src/types/electron.d.ts` import from that single source so a
// future divergence (preload exposes method X, renderer types it with
// arity M) is impossible to introduce.
import type {
  ConnectionRecord,
  GeodeBridge,
  ThemeVariant,
} from './shared/bridge-types'

// Geode UI — Electron preload.
//
// Exposes a tightly-scoped `window.geode` surface to the renderer via
// contextBridge. The renderer cannot reach into Node directly because
// `contextIsolation: true` and `nodeIntegration: false` are set in
// main.ts. Anything the SPA needs from the OS (open external links,
// app version, system theme) must funnel through an explicit IPC call
// here.

// Synchronous handshake with main to fetch the configured HTTP(S)
// server origin. The SPA's `resolveBaseUrl` (src/api/client.ts) calls
// `new URL(baseUrl)` at module-import time, so the value must be a
// plain string sitting on the bridge by the time `contextBridge.expose
// InMainWorld` returns — there's no async window before bootstrap.
const SERVER_URL = ipcRenderer.sendSync('geode:get-server-url-sync') as string

const bridge: GeodeBridge = {
  isElectron: true,
  serverUrl: SERVER_URL,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('geode:get-version') as Promise<string>,
  openExternal: (url: string) =>
    ipcRenderer.invoke('geode:open-external', url) as Promise<boolean>,
  getSystemTheme: () =>
    ipcRenderer.invoke('geode:get-system-theme') as Promise<ThemeVariant>,
  onSystemThemeChange: (handler) => {
    const listener = (_evt: unknown, variant: ThemeVariant): void => {
      handler(variant)
    }
    ipcRenderer.on('geode:system-theme-changed', listener)
    return () => {
      ipcRenderer.removeListener('geode:system-theme-changed', listener)
    }
  },
  getStoredConnections: () =>
    ipcRenderer.invoke('geode:get-stored-connections') as Promise<
      ConnectionRecord[]
    >,
  storeConnections: (list) =>
    ipcRenderer.invoke('geode:store-connections', list) as Promise<boolean>,
  // APP-01 R2: opens a fresh single-use unlock token window on the
  // main side. Callers thread the returned token into getStoredPassword
  // immediately; the token expires after ~30 s.
  openUnlockWindow: () =>
    ipcRenderer.invoke('geode:open-unlock-window') as Promise<string>,
  // APP-01 R3: pref read/write so the renderer (a future settings
  // panel) can toggle biometric requirement. The IPC handlers
  // round-trip through secure-store; settings UI is out of scope this
  // commit.
  getSavedPasswordBiometricPref: () =>
    ipcRenderer.invoke(
      'geode:get-saved-password-biometric-pref'
    ) as Promise<boolean>,
  setSavedPasswordBiometricPref: (enabled) =>
    ipcRenderer.invoke(
      'geode:set-saved-password-biometric-pref',
      enabled
    ) as Promise<boolean>,
  getStoredPassword: (profileName, username, unlockToken) =>
    ipcRenderer.invoke(
      'geode:get-stored-password',
      profileName,
      username,
      unlockToken
    ) as Promise<string | null>,
  storeSavedPassword: (profileName, username, password) =>
    ipcRenderer.invoke(
      'geode:store-saved-password',
      profileName,
      username,
      password
    ) as Promise<boolean>,
  clearStoredPassword: (profileName, username) =>
    ipcRenderer.invoke(
      'geode:clear-stored-password',
      profileName,
      username
    ) as Promise<boolean>,
  pickPemFile: () =>
    ipcRenderer.invoke('geode:pick-pem-file') as Promise<string | null>,
  windowMinimize: () =>
    ipcRenderer.invoke('geode:window-minimize') as Promise<boolean>,
  windowToggleMaximize: () =>
    ipcRenderer.invoke('geode:window-toggle-maximize') as Promise<boolean>,
  windowClose: () =>
    ipcRenderer.invoke('geode:window-close') as Promise<boolean>,
  windowIsMaximized: () =>
    ipcRenderer.invoke('geode:window-is-maximized') as Promise<boolean>,
  onWindowMaximizedChange: (handler) => {
    const listener = (_evt: unknown, maximized: boolean): void => {
      handler(maximized)
    }
    ipcRenderer.on('geode:window-maximized-changed', listener)
    return () => {
      ipcRenderer.removeListener('geode:window-maximized-changed', listener)
    }
  },
}

contextBridge.exposeInMainWorld('geode', bridge)
