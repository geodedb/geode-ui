// Single source of truth for the contextBridge surface.
//
// Pre-fix the same `ConnectionRecord` + `GeodeBridge` interfaces were
// declared verbatim in TWO places:
//   • electron/preload.ts  (the side that calls contextBridge.exposeInMainWorld)
//   • src/types/electron.d.ts  (the side the renderer imports via window.geode)
//
// First divergence between the two would silently break the renderer:
// preload would expose method X with arity N, the renderer would type
// it with arity M, and the call would compile cleanly while failing at
// runtime. (PSR-G07 / GitLab #84 + Q4 / GitLab #93.)
//
// This module is the canonical surface. Both sides re-export from here:
//   • electron/preload.ts: `import type { ... } from './shared/bridge-types'`
//   • src/types/electron.d.ts: `export type { ... } from
//     '../../electron/shared/bridge-types'`
//
// The renderer's tsconfig does not include `electron/**`, but tsc still
// resolves the file on disk through the relative import — it just
// doesn't type-check it as part of the renderer build. The renderer's
// type-correctness is therefore guaranteed by the electron tsconfig
// run (`npm run electron:tsc`) which DOES type-check this file as part
// of its rootDir.

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
  pickPemFile(): Promise<string | null>
}
