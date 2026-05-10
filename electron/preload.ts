import { contextBridge, ipcRenderer } from 'electron'

// Geode UI — Electron preload.
//
// Exposes a tightly-scoped `window.geode` surface to the renderer via
// contextBridge. The renderer cannot reach into Node directly because
// `contextIsolation: true` and `nodeIntegration: false` are set in
// main.ts. Anything the SPA needs from the OS (open external links,
// app version, system theme) must funnel through an explicit IPC call
// here.

type ThemeVariant = 'light' | 'dark'

interface ConnectionRecord {
  connectionId: string
  token: string
  profileName: string
  expiresAt: number
}

interface GeodeBridge {
  isElectron: true
  getVersion(): Promise<string>
  openExternal(url: string): Promise<boolean>
  getSystemTheme(): Promise<ThemeVariant>
  onSystemThemeChange(handler: (variant: ThemeVariant) => void): () => void
  getStoredConnections(): Promise<ConnectionRecord[]>
  storeConnections(list: ConnectionRecord[]): Promise<boolean>
  getStoredPassword(
    profileName: string,
    username: string
  ): Promise<string | null>
  storeSavedPassword(
    profileName: string,
    username: string,
    password: string
  ): Promise<boolean>
  clearStoredPassword(profileName: string, username: string): Promise<boolean>
  pickPemFile(): Promise<string | null>
}

const bridge: GeodeBridge = {
  isElectron: true,
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
  getStoredPassword: (profileName, username) =>
    ipcRenderer.invoke(
      'geode:get-stored-password',
      profileName,
      username
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
}

contextBridge.exposeInMainWorld('geode', bridge)
