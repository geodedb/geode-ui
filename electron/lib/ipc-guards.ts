// IPC trust-boundary guards (Phase 3 module C1).
//
// The Electron main process accepts strings, numbers, and JSON-shaped
// values from a contextIsolated, sandboxed renderer — but "isolated"
// is not "trusted". A renderer compromise (or any future feature that
// pipes user-controlled DOM content into a bridge call) can hand the
// main process anything: the wrong type, a giant token, a non-finite
// expiry, an absolute path that points at a symlink, etc.
//
// Pre-fix the main process trusted whatever shape the renderer sent
// and silently failed when crypto wasn't available — see SECURITY_GAP
// rows S3 / S4 / S8 (GitLab #116, #117, #121). This module centralises
// the validation + filesystem + safeStorage gates so each IPC handler
// in `electron/main.ts` becomes a one-line call into a tested guard.
//
// The helpers are stdlib-only (`node:fs/promises`, `node:fs`, `node:path`)
// so the test suite runs under the SPA jest config without needing
// `electron` in node_modules.

import crypto from 'node:crypto'
import fs, { constants as fsConstants } from 'node:fs/promises'
import nodeFs from 'node:fs'
import path from 'node:path'

import type { SafeStorageLike } from './secure-store'

// ---------------------------------------------------------------------
// S3 — pickPemFile TOCTOU + symlink + size cap.
// ---------------------------------------------------------------------

export interface SafeReadPemOptions {
  // Hard upper bound on file size in bytes. Real PEM material is
  // typically <10 KB; the existing 1 MiB cap is generous.
  maxBytes: number
}

// safeReadPemFile reads a PEM file from disk in a way that closes the
// CWE-367 (TOCTOU) gap in the pre-fix `pickPemFile` handler. The
// original code did `fs.stat(p)` and then `fs.readFile(p)` — two
// separate path-resolution syscalls that an attacker on a shared host
// could race (replace the inode between calls so the size check passes
// but the read returns a 4 GB log file).
//
// Hardening:
//
//   1. Open the path once via `fs.open(p, O_RDONLY | O_NOFOLLOW)` so a
//      symlink at the chosen path returns ELOOP up front. The dialog
//      already reports a real path, but the renderer cannot trust
//      that — the user's file picker may have been redirected by an
//      OS-level shim, and the path could refer to a symlink even when
//      the user picked a file by name.
//   2. fstat() the file descriptor — not the path — to size-check the
//      *same* inode we'll read from. No second path resolution.
//   3. Reject if size > maxBytes BEFORE reading any bytes.
//   4. Single `fhandle.readFile()` from the FD — no second open.
//   5. Validate the content looks PEM-shaped (`-----BEGIN .* -----` and
//      `-----END .* -----`). PEM material always carries those armor
//      lines; a binary blob or random log file does not.
//
// CWE-367 (TOCTOU) + CWE-22 (path traversal via symlink) + CWE-400
// (uncontrolled resource consumption). See SECURITY_GAP_ANALYSIS row
// S3 / GitLab #116.
export async function safeReadPemFile(
  filePath: unknown,
  opts: SafeReadPemOptions
): Promise<string> {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('safeReadPemFile: path must be a non-empty string')
  }
  if (
    typeof opts.maxBytes !== 'number' ||
    !Number.isFinite(opts.maxBytes) ||
    opts.maxBytes <= 0
  ) {
    throw new RangeError('safeReadPemFile: maxBytes must be a positive number')
  }

  // O_NOFOLLOW: refuse to open the path if the final component is a
  // symlink. POSIX returns ELOOP; node surfaces that as an error with
  // code === 'ELOOP'.
  const flags = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
  let handle: import('node:fs/promises').FileHandle
  try {
    handle = await fs.open(filePath, flags)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'ELOOP' || code === 'EMLINK') {
      throw new Error(
        `safeReadPemFile: refusing to follow symlink at ${filePath}`
      )
    }
    throw err
  }

  try {
    const stat = await handle.stat()
    if (stat.isSymbolicLink()) {
      // O_NOFOLLOW should have already rejected this, but belt-and-
      // suspenders for any platform whose libc maps the flag oddly.
      throw new Error(
        `safeReadPemFile: refusing to follow symlink at ${filePath}`
      )
    }
    if (!stat.isFile()) {
      throw new Error(`safeReadPemFile: not a regular file: ${filePath}`)
    }
    if (stat.size > opts.maxBytes) {
      throw new Error(
        `safeReadPemFile: file too large (${stat.size} bytes > ${opts.maxBytes} cap)`
      )
    }
    const text = (await handle.readFile({ encoding: 'utf8' })) as string
    if (!isPemShaped(text)) {
      throw new Error(
        `safeReadPemFile: file at ${filePath} is not PEM-formatted`
      )
    }
    return text
  } finally {
    await handle.close().catch(() => {
      // Closing the handle is best-effort; the fd will be reaped.
    })
  }
}

// PEM material always carries `-----BEGIN <label>-----` and
// `-----END <label>-----` armor lines (RFC 7468). A few permissive
// matches: we don't require the labels to match (so users can pick a
// `CERTIFICATE` *or* `PRIVATE KEY` *or* `EC PRIVATE KEY` etc.), but we
// do require both armor lines to be present.
const PEM_BEGIN = /-----BEGIN [A-Z0-9 ]+-----/
const PEM_END = /-----END [A-Z0-9 ]+-----/

function isPemShaped(text: string): boolean {
  return PEM_BEGIN.test(text) && PEM_END.test(text)
}

// ---------------------------------------------------------------------
// S4 — surface safeStorage unavailability instead of silently dropping
// data on the floor.
// ---------------------------------------------------------------------

export class SecureStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecureStoreUnavailableError'
  }
}

export type SafeStorageStatus =
  | { available: true }
  | { available: false; error: SecureStoreUnavailableError }

// requireSafeStorage gives callers a structured way to detect the "no
// encryption backing on this host" condition. Pre-fix the secure-store
// silently `return`ed on every read/write when safeStorage was
// unavailable, which meant the renderer thought a token had been
// persisted when in fact it had been dropped. Surfacing this as a
// typed error lets the IPC handler return a sensible failure to the
// renderer instead.
export function requireSafeStorage(safe: SafeStorageLike): SafeStorageStatus {
  let available = false
  try {
    available = safe.isEncryptionAvailable()
  } catch {
    available = false
  }
  if (available) return { available: true }
  return {
    available: false,
    error: new SecureStoreUnavailableError(
      'safeStorage is unavailable on this host; encrypted persistence disabled'
    ),
  }
}

// ---------------------------------------------------------------------
// S8 — typed, capped sanitisers for the IPC payloads that previously
// accepted any JSON shape from the renderer.
// ---------------------------------------------------------------------

export interface ConnectionRecord {
  connectionId: string
  token: string
  profileName: string
  expiresAt: number
}

export interface SanitizeConnectionsOptions {
  // Hard cap on the number of connections we will persist. Pre-fix
  // the renderer could submit an unbounded array which would inflate
  // the encrypted secure-store payload arbitrarily.
  maxLen: number
  // Per-field length caps. JWTs are typically <2 KB; the cap is
  // generous to allow refresh-token style credentials.
  maxTokenLen: number
  maxNameLen: number
  // Max forward-window for `expiresAt` measured from `now`. A token
  // that claims to expire 100 years from now is almost certainly the
  // wrong shape; we also reject expiresAt strictly in the past.
  maxExpiresMs: number
  // Injected clock for tests. Defaults to Date.now() at call time.
  now?: number
}

// sanitizeConnections returns a normalized ConnectionRecord[] or null
// if any element fails validation. Returning null forces the IPC
// handler to surface a hard error to the renderer instead of silently
// persisting the bad shape.
export function sanitizeConnections(
  raw: unknown,
  opts: SanitizeConnectionsOptions
): ConnectionRecord[] | null {
  if (!Array.isArray(raw)) return null
  if (raw.length > opts.maxLen) return null
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  const out: ConnectionRecord[] = []
  for (const item of raw) {
    if (!isPlainObject(item)) return null
    const rec = item as Record<string, unknown>
    if (!isBoundedString(rec.connectionId, 1, opts.maxNameLen)) return null
    if (!isBoundedString(rec.token, 1, opts.maxTokenLen)) return null
    if (!isBoundedString(rec.profileName, 1, opts.maxNameLen)) return null
    if (
      typeof rec.expiresAt !== 'number' ||
      !Number.isFinite(rec.expiresAt) ||
      !Number.isInteger(rec.expiresAt)
    ) {
      return null
    }
    if (rec.expiresAt < now) return null
    if (rec.expiresAt > now + opts.maxExpiresMs) return null
    // Strip everything except the four known fields. JSON.stringify
    // would serialise unknown fields, and the in-process memo would
    // round-trip them back to the renderer.
    out.push({
      connectionId: rec.connectionId as string,
      token: rec.token as string,
      profileName: rec.profileName as string,
      expiresAt: rec.expiresAt,
    })
  }
  return out
}

export interface SavedPasswordInput {
  profile: string
  username: string
  password: string
}

export interface SanitizeSavedPasswordOptions {
  maxNameLen: number
  maxUsernameLen: number
  maxPasswordLen: number
}

// sanitizeSavedPasswordInput validates the per-call payload of
// `geode:store-saved-password`. Pre-fix the handler accepted three
// raw `unknown`-typed args; this helper enforces:
//
//   • All three are strings.
//   • Each is non-empty (an empty profile or username collides with
//     other entries because pwKey() joins them with `\x00`).
//   • No null bytes inside profile or username (they would *also*
//     collide with the pwKey separator and could shadow another user's
//     stored password).
//   • Each is under its respective length cap.
export function sanitizeSavedPasswordInput(
  raw: unknown,
  opts: SanitizeSavedPasswordOptions
): SavedPasswordInput | null {
  if (!isPlainObject(raw)) return null
  const r = raw as Record<string, unknown>
  if (!isBoundedString(r.profile, 1, opts.maxNameLen)) return null
  if (!isBoundedString(r.username, 1, opts.maxUsernameLen)) return null
  if (typeof r.password !== 'string') return null
  if (r.password.length === 0 || r.password.length > opts.maxPasswordLen) {
    return null
  }
  // Null bytes inside profile / username would collide with the pwKey
  // separator (`${profile}\x00${username}`) — a renderer that sets
  // profile="alice\x00" username="" could overwrite alice/"" entirely.
  if ((r.profile as string).includes('\x00')) return null
  if ((r.username as string).includes('\x00')) return null
  return {
    profile: r.profile as string,
    username: r.username as string,
    password: r.password,
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) return false
  return true
}

function isBoundedString(v: unknown, min: number, max: number): v is string {
  if (typeof v !== 'string') return false
  if (v.length < min || v.length > max) return false
  return true
}

// ---------------------------------------------------------------------
// Helper: predictable temp-file randomization for secure-store.
// ---------------------------------------------------------------------

// randomTmpSuffix returns a short hex suffix suitable for `${storePath}.${suffix}.tmp`.
// The pre-fix secure-store used a fixed `${storePath}.tmp` which on a
// shared home would let an attacker symlink-race the rename. Adding
// 16 hex chars (8 random bytes) of entropy makes that race
// statistically infeasible.
export function randomTmpSuffix(bytes = 8): string {
  return crypto.randomBytes(bytes).toString('hex')
}

// Re-export the node:fs default for convenience (callers in main.ts).
export { nodeFs }
// Suppress "declared but unused" by re-exporting path through a
// helper. This keeps the import slot live for future helpers.
export function joinTmp(storePath: string, suffix: string): string {
  return path.join(
    path.dirname(storePath),
    `${path.basename(storePath)}.${suffix}.tmp`
  )
}
