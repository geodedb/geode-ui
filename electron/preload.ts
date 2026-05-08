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

interface GeodeBridge {
  isElectron: true
  getVersion(): Promise<string>
  openExternal(url: string): Promise<boolean>
  getSystemTheme(): Promise<ThemeVariant>
  onSystemThemeChange(handler: (variant: ThemeVariant) => void): () => void
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
}

contextBridge.exposeInMainWorld('geode', bridge)
