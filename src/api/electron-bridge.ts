import type { ConnectionRecord, GeodeBridge } from '../types/electron'

/**
 * The on-disk shape of a saved-connection record. Re-exported here so
 * SPA callers can `import type { ConnectionRecord } from '@/api/electron-bridge'`
 * without reaching into `src/types/electron`.
 */
export type { ConnectionRecord }

/**
 * Internal helper. Returns the renderer-side `window.geode` contextBridge
 * if this build is running inside the Electron shell, or `undefined`
 * when the SPA is served as a plain web page (jest, dev server, browser
 * preview). Every public helper in this file goes through `bridge()` so
 * the web-fallback path is uniform.
 */
function bridge(): GeodeBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return window.geode
}

/**
 * Reports whether the SPA is currently running inside the Electron
 * desktop shell (contextBridge present and `isElectron === true`).
 *
 * Web fallback: returns `false` when `window.geode === undefined`
 * (browser, jest, or any non-Electron host).
 *
 * @returns `true` only when the contextBridge is wired and explicitly
 *   identifies itself as Electron.
 */
export function isElectron(): boolean {
  return bridge()?.isElectron === true
}

/**
 * Reads the persisted list of saved connections from the Electron
 * secure-store.
 *
 * IPC channel: `geode:get-stored-connections`.
 *
 * Web fallback: resolves to `[]` when not running in Electron. Also
 * resolves to `[]` if the IPC handler throws (e.g. the secure-store is
 * unavailable on this OS), so callers never have to handle a rejection.
 *
 * @returns The persisted connection records, or `[]` if unavailable.
 */
export async function getStoredConnections(): Promise<ConnectionRecord[]> {
  const b = bridge()
  if (!b) return []
  try {
    return await b.getStoredConnections()
  } catch {
    return []
  }
}

/**
 * Persists the full list of saved connections to the Electron
 * secure-store. The renderer-side contract is "replace the whole
 * persisted set with this list" — there is no per-record append/remove
 * API, mirroring the secure-store envelope shape.
 *
 * IPC channel: `geode:store-connections`. The main-process handler
 * runs the payload through `sanitizeConnections` (S8 / #121) before
 * accepting it, so a malformed payload is rejected with a typed error
 * but the SPA still resolves cleanly (catch below).
 *
 * Web fallback: resolves immediately as a no-op when not running in
 * Electron — there is no browser-side persistence layer for saved
 * connections.
 *
 * Best-effort: a write failure is swallowed (logged in the main
 * process) because persistence must never block the SPA's flow.
 */
export async function storeConnections(
  list: ConnectionRecord[]
): Promise<void> {
  const b = bridge()
  if (!b) return
  try {
    await b.storeConnections(list)
  } catch {
    // best-effort; persistence failures must never block the SPA
  }
}

/**
 * Reads a previously-saved password from the Electron secure-store,
 * keyed by `(profileName, username)`. Returns `null` when no password
 * is stored for that pair (the common case for first-time sign-in on a
 * given profile).
 *
 * IPC channel: `geode:get-stored-password`.
 *
 * Web fallback: returns `null` when not running in Electron, because
 * there is no browser-side equivalent of `safeStorage`. Callers must
 * still treat the saved password as best-effort and prompt for one if
 * `null` comes back.
 *
 * Errors (secure-store unavailable, decrypt failure, etc.) are
 * swallowed and reported as `null` so callers can treat the helper as
 * a simple "got one or didn't" lookup.
 */
export async function getStoredPassword(
  profileName: string,
  username: string
): Promise<string | null> {
  const b = bridge()
  if (!b) return null
  try {
    return await b.getStoredPassword(profileName, username)
  } catch {
    return null
  }
}

/**
 * Persists a password to the Electron secure-store, keyed by
 * `(profileName, username)`. The triple is validated by
 * `sanitizeSavedPasswordInput` (S8 / #121) in the main process before
 * it touches `safeStorage` — null bytes in `profileName` or `username`
 * are rejected because the underlying store key uses `\x00` as a
 * separator.
 *
 * IPC channel: `geode:store-saved-password`.
 *
 * Web fallback: resolves immediately as a no-op when not running in
 * Electron — browsers have their own password manager; the SPA does not
 * try to substitute one.
 *
 * Best-effort: write failures are swallowed because saved-password
 * persistence is a convenience, not part of the auth contract. Callers
 * (notably `AuthProvider.signIn`) deliberately fire-and-forget this
 * call to keep the login navigation off the IPC critical path
 * (PSR-F10).
 */
export async function storeSavedPassword(
  profileName: string,
  username: string,
  password: string
): Promise<void> {
  const b = bridge()
  if (!b) return
  try {
    await b.storeSavedPassword(profileName, username, password)
  } catch {
    // best-effort
  }
}

/**
 * Clears the previously-saved password for the given
 * `(profileName, username)` pair from the Electron secure-store. This
 * is the helper that backs the planned Settings → "Forget Saved
 * Password" affordance (S9 / #122 follow-up); `signOut` deliberately
 * does NOT call this so saved passwords persist across sessions, the
 * same way every browser password manager behaves.
 *
 * IPC channel: `geode:clear-stored-password`. Idempotent: clearing a
 * non-existent entry resolves successfully.
 *
 * Web fallback: resolves immediately as a no-op when not running in
 * Electron.
 *
 * Best-effort: failures are swallowed — there is nothing the SPA can
 * meaningfully do if the secure-store delete IPC fails, and the
 * affordance UX is "fire and report success" by design.
 */
export async function clearStoredPassword(
  profileName: string,
  username: string
): Promise<void> {
  const b = bridge()
  if (!b) return
  try {
    await b.clearStoredPassword(profileName, username)
  } catch {
    // best-effort
  }
}

/**
 * Opens the native file picker so the user can select a PEM file
 * (CA bundle, client cert, or key) for a TLS-enabled connection. The
 * main process reads the file under `safeReadPemFile`'s
 * TOCTOU-resistant guard (S3 / #116): the resolved path is opened by
 * file descriptor, then `fstat` confirms it's still a regular file
 * within the size cap before any bytes are read.
 *
 * IPC channel: `geode:pick-pem-file`.
 *
 * Web fallback: returns `null` when not running in Electron — PEM
 * pickers in the browser would have to rely on `<input type="file">`
 * and `FileReader`, which has its own UI contract; that path is not
 * supported here.
 *
 * @returns The decoded PEM contents (UTF-8 string), or `null` if the
 *   user cancelled the picker, the file fell outside the security
 *   guard, or the IPC handler rejected the payload.
 */
export async function pickPemFile(): Promise<string | null> {
  const b = bridge()
  if (!b) return null
  try {
    return await b.pickPemFile()
  } catch {
    return null
  }
}
