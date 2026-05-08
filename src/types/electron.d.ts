// Renderer-side type for the bridge that electron/preload.ts exposes
// via contextBridge. When the app is loaded in a regular browser
// (the Go-served SPA), `window.geode` is undefined and consumers
// should fall back to the web-native equivalent (window.open, etc.).

export type ThemeVariant = 'light' | 'dark'

export interface GeodeBridge {
  readonly isElectron: true
  getVersion(): Promise<string>
  openExternal(url: string): Promise<boolean>
  getSystemTheme(): Promise<ThemeVariant>
  onSystemThemeChange(handler: (variant: ThemeVariant) => void): () => void
}

declare global {
  interface Window {
    geode?: GeodeBridge
  }
}

export {}
