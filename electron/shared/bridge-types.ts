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
  // Operator-configured HTTP(S) origin of the geode-ui server the
  // desktop app talks to. The SPA's API client refuses geode:// (the
  // privileged scheme the renderer is hosted under) so we surface a
  // separate, http(s)-only origin here. Sourced from the
  // GEODE_SERVER_URL env var at main-process startup; defaults to
  // http://localhost:8080 to match the docker-compose stack a
  // developer runs locally beside the desktop build.
  readonly serverUrl: string
  // Process platform name (`'darwin' | 'linux' | 'win32' | string`)
  // read at preload time from process.platform. The renderer uses
  // this to gate per-OS behavior (e.g. window controls that should
  // not render on macOS where native traffic lights are present).
  readonly platform: string
  getVersion(): Promise<string>
  openExternal(url: string): Promise<boolean>
  getSystemTheme(): Promise<ThemeVariant>
  onSystemThemeChange(handler: (variant: ThemeVariant) => void): () => void
  getStoredConnections(): Promise<ConnectionRecord[]>
  storeConnections(list: ConnectionRecord[]): Promise<boolean>
  // APP-01 R2 (2026-05-24 appsec): saved-password reads require a
  // single-use unlock token issued by openUnlockWindow(). A renderer
  // compromise without a token gets null. Callers obtain the token
  // immediately after a successful login and pass it through; the
  // token expires after ~30 s on the main-process side.
  openUnlockWindow(): Promise<string>
  // APP-01 R3 (2026-05-24 appsec): opt-in OS-native re-auth pref.
  // When `getSavedPasswordBiometricPref()` returns true the
  // `getStoredPassword` IPC requires a successful biometric prompt
  // (Touch ID / Hello / polkit) before returning a stored password.
  // Settings UI for toggling the pref is a follow-up; the IPC pair is
  // exposed so a future settings panel (or a regression test) can set
  // the value without touching the secure-store schema directly.
  getSavedPasswordBiometricPref(): Promise<boolean>
  setSavedPasswordBiometricPref(enabled: boolean): Promise<boolean>
  getStoredPassword(
    profileName: string,
    username: string,
    unlockToken: string
  ): Promise<string | null>
  storeSavedPassword(
    profileName: string,
    username: string,
    password: string
  ): Promise<boolean>
  clearStoredPassword(profileName: string, username: string): Promise<boolean>
  pickPemFile(): Promise<string | null>
}
