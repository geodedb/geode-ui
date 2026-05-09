// Renderer-side type for the bridge that electron/preload.ts exposes
// via contextBridge. When the app is loaded in a regular browser
// (the Go-served SPA), `window.geode` is undefined and consumers
// should fall back to the web-native equivalent (window.open, etc.).

export type ThemeVariant = 'light' | 'dark'

export interface ConnectionRecord {
  connectionId: string
  token: string
  profileName: string
  expiresAt: number
}

export interface GeodeBridge {
  readonly isElectron: true
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
}

declare global {
  interface Window {
    geode?: GeodeBridge
  }
}

export {}
