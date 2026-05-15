import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

import {
  randomTmpSuffix,
  joinTmp,
  requireSafeStorage,
  SecureStoreUnavailableError,
} from './ipc-guards'

// SafeStorageLike is the subset of Electron's safeStorage we use,
// extracted as an interface so tests can inject a fake.
export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean
  encryptString: (plain: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}

export interface SecureStoreDoc {
  connections?: Array<{
    connectionId: string
    token: string
    profileName: string
    expiresAt: number
  }>
  passwords?: Record<string, string>
}

export interface SecureStoreOptions {
  storePath: string
  safeStorage: SafeStorageLike
  // debounceMs is exposed for tests; the production path uses the default
  // 250ms window which is short enough to feel synchronous to a user but
  // long enough to coalesce a burst of reducer-driven writes.
  debounceMs?: number
  // surfaceUnavailable: when true (S4 closure), `write()` rejects with
  // a SecureStoreUnavailableError if safeStorage is not available
  // instead of silently dropping data. When false (legacy), writes are
  // silently ignored and reads return {}. Default: true.
  surfaceUnavailable?: boolean
}

export interface SecureStore {
  read(): Promise<SecureStoreDoc>
  write(doc: SecureStoreDoc): Promise<void>
  clear(): Promise<void>
  // flushSync drains any pending debounced write synchronously. The
  // electron main process MUST call this from `app.before-quit` so a
  // user who quits inside the 250ms debounce window does not lose
  // freshly minted JWTs.
  flushSync(): Promise<void>
}

export { SecureStoreUnavailableError } from './ipc-guards'

const empty: SecureStoreDoc = {}
const DEFAULT_DEBOUNCE_MS = 250

// MAC_KEY_LABEL — derives a per-install MAC key by asking safeStorage
// to encrypt a constant tag. The OS-bound encryption blob is hashed to
// produce the symmetric MAC key. Two installations on the same machine
// each get a distinct key (because OSX Keychain / DPAPI / libsecret
// per-app secrets diverge); a copy of the file alone (without the OS
// keyring entry) cannot forge a valid HMAC.
const MAC_KEY_LABEL = 'geode-ui-mac-key-v1'

// On-disk envelope shape. `ciphertext` is the safeStorage-encrypted
// blob (base64). `hmac` is the hex-encoded HMAC-SHA256 of `ciphertext`
// (raw bytes, not the base64 string) under the install-bound MAC key.
//
// Legacy payloads (pre-S4) carry only `{ encrypted: <base64> }` with no
// `hmac` field. We detect that shape on read, emit a warning to the
// console, and re-encrypt + re-MAC on the next `write()` (one-shot
// migration). No data is dropped.
interface EnvelopeV2 {
  v: 2
  ciphertext: string // base64 of safeStorage.encryptString(plain)
  hmac: string // hex of HMAC-SHA256(macKey, base64-decoded(ciphertext))
}

interface EnvelopeLegacy {
  encrypted: string // legacy field; no MAC.
}

// PSR-F6 (#92) — secure-store decrypt+re-encrypt per IPC.
//
// Pre-fix every read/write performed: file read -> JSON.parse -> safe
// storage decrypt -> JSON.parse -> mutate -> JSON.stringify -> safe
// storage encrypt -> JSON.stringify -> writeFile(tmp) -> rename. With
// no in-process memo, the AddConnectionModal's per-keystroke
// `getStoredPassword` lookup paid that cost on every IPC, and the
// connections useEffect (PSR-F9) re-encrypted on every reducer tick.
//
// Post-fix this module:
//   1. Memoizes the decrypted document in-process so subsequent reads
//      are O(1) memory hits.
//   2. Debounces writes inside a 250ms window so a burst of reducer
//      ticks (or per-keystroke writes) collapses into a single
//      encrypt + atomic file rename.
//   3. Exposes `flushSync` so the main process can drain pending writes
//      from `app.before-quit` without losing data.
//
// S4 (#117) hardening additions:
//   - HMAC-SHA256 envelope around the encrypted payload using a MAC
//     key derived per-install via safeStorage. A tampered ciphertext
//     fails the MAC check before decrypt is attempted.
//   - Random hex suffix on the temp file (`${storePath}.${rand}.tmp`)
//     so a shared-home race against the rename is statistically
//     infeasible.
//   - Surface `SecureStoreUnavailableError` from `write()` when
//     safeStorage is unavailable instead of silently dropping data.
//   - One-shot migration of legacy `{ encrypted }` envelopes to the
//     new `{ v:2, ciphertext, hmac }` shape on the next write.
export function createSecureStore(opts: SecureStoreOptions): SecureStore {
  const { storePath, safeStorage } = opts
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const surfaceUnavailable = opts.surfaceUnavailable !== false

  // memo holds the latest decrypted view of the doc. `loaded` tracks
  // whether we've ever materialized it (cold start vs. hot memo).
  let memo: SecureStoreDoc = { ...empty }
  let loaded = false
  // dirty == true means the memo has unsaved mutations.
  let dirty = false
  // flushTimer is the in-flight debounced flush; replaced on each
  // write so the latest mutation always wins the race.
  let flushTimer: NodeJS.Timeout | null = null
  // writeChain serializes flush() invocations so two concurrent
  // flushes (e.g. timer + flushSync) cannot interleave file ops.
  let writeChain: Promise<void> = Promise.resolve()
  // macKey is lazily derived on first encrypted read/write so that
  // tests using a fake safeStorage can opt-in to HMAC verification by
  // passing a real-shaped fake.
  let macKey: Buffer | null = null

  function clone(doc: SecureStoreDoc): SecureStoreDoc {
    // Defensive copy on read so callers can't mutate our memo. The
    // shape is small and JSON-safe, so a JSON round-trip is the
    // simplest correct deep-clone.
    return JSON.parse(JSON.stringify(doc)) as SecureStoreDoc
  }

  function deriveMacKey(): Buffer {
    if (macKey) return macKey
    // safeStorage.encryptString returns a Buffer that is bound to the
    // OS keyring entry for this app+user. Hashing it gives a stable
    // 32-byte symmetric key for HMAC-SHA256.
    const seed = safeStorage.encryptString(MAC_KEY_LABEL)
    macKey = crypto.createHash('sha256').update(seed).digest()
    return macKey
  }

  function computeMac(ciphertext: Buffer): string {
    const key = deriveMacKey()
    return crypto.createHmac('sha256', key).update(ciphertext).digest('hex')
  }

  function isEnvelopeV2(o: unknown): o is EnvelopeV2 {
    if (o === null || typeof o !== 'object') return false
    const r = o as Record<string, unknown>
    return (
      r.v === 2 &&
      typeof r.ciphertext === 'string' &&
      typeof r.hmac === 'string'
    )
  }

  function isEnvelopeLegacy(o: unknown): o is EnvelopeLegacy {
    if (o === null || typeof o !== 'object') return false
    const r = o as Record<string, unknown>
    return typeof r.encrypted === 'string'
  }

  async function loadFromDisk(): Promise<SecureStoreDoc> {
    if (!safeStorage.isEncryptionAvailable()) return { ...empty }
    let raw: Buffer
    try {
      raw = await fs.readFile(storePath)
    } catch {
      return { ...empty }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString('utf8'))
    } catch {
      return { ...empty }
    }

    let cipherBuf: Buffer | null = null
    if (isEnvelopeV2(parsed)) {
      // Verify HMAC before attempting decrypt. A tampered ciphertext
      // (or a substituted file from another install) fails the MAC
      // and surfaces as an empty doc rather than mis-decrypted bytes.
      cipherBuf = Buffer.from(parsed.ciphertext, 'base64')
      const expected = computeMac(cipherBuf)
      // crypto.timingSafeEqual requires equal lengths.
      const got = parsed.hmac
      const expectedBuf = Buffer.from(expected, 'hex')
      const gotBuf = (() => {
        try {
          return Buffer.from(got, 'hex')
        } catch {
          return Buffer.alloc(0)
        }
      })()
      if (
        gotBuf.length !== expectedBuf.length ||
        !crypto.timingSafeEqual(expectedBuf, gotBuf)
      ) {
        // Mark dirty so the next write replaces the tampered file.
        return { ...empty }
      }
    } else if (isEnvelopeLegacy(parsed)) {
      // Legacy {encrypted} envelope — decrypt as-is, then mark the memo
      // dirty so the next `write()` re-emits the v2 envelope. We don't
      // re-write here because read() should be side-effect-free.
      cipherBuf = Buffer.from(parsed.encrypted, 'base64')
    } else {
      return { ...empty }
    }

    let decrypted: string
    try {
      decrypted = safeStorage.decryptString(cipherBuf)
    } catch {
      return { ...empty }
    }
    try {
      return JSON.parse(decrypted) as SecureStoreDoc
    } catch {
      return { ...empty }
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded) return
    memo = await loadFromDisk()
    loaded = true
    // If the on-disk image was a legacy envelope, mark the memo dirty
    // so the next persist() will re-emit it as v2.
    if (await isLegacyOnDisk()) {
      dirty = true
    }
  }

  async function isLegacyOnDisk(): Promise<boolean> {
    try {
      const raw = await fs.readFile(storePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      return isEnvelopeLegacy(parsed) && !isEnvelopeV2(parsed)
    } catch {
      return false
    }
  }

  async function read(): Promise<SecureStoreDoc> {
    await ensureLoaded()
    return clone(memo)
  }

  async function persist(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      if (surfaceUnavailable) {
        // S4 — surface the unavailable condition; the IPC handler will
        // turn this into a renderer-visible error.
        dirty = false
        throw new SecureStoreUnavailableError(
          'safeStorage is unavailable; refusing to persist secure-store payload'
        )
      }
      // Legacy contract: writes are dropped silently when encryption is
      // unavailable so the renderer's best-effort calls don't blow up
      // an unencrypted host.
      dirty = false
      return
    }
    const snapshot = clone(memo)
    const plain = JSON.stringify(snapshot)
    const cipherBytes = safeStorage.encryptString(plain)
    const hmac = computeMac(cipherBytes)
    const envelope: EnvelopeV2 = {
      v: 2,
      ciphertext: cipherBytes.toString('base64'),
      hmac,
    }
    const payload = JSON.stringify(envelope)
    // Random hex suffix on the tmp file: pre-fix `${storePath}.tmp`
    // was predictable, so on a shared home an attacker could symlink
    // the path before the rename. 8 bytes (16 hex chars) of entropy
    // makes the race statistically infeasible.
    const tmp = joinTmp(storePath, randomTmpSuffix())
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(tmp, payload, { mode: 0o600 })
    await fs.rename(tmp, storePath)
    dirty = false
  }

  function cancelTimer(): void {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  // scheduleFlush replaces any pending flush so only the latest memo
  // state is written. Callers should treat scheduling as fire-and-forget
  // — flushSync is the only synchronous drain.
  function scheduleFlush(): void {
    cancelTimer()
    flushTimer = setTimeout(() => {
      flushTimer = null
      // Chain the flush onto writeChain so a flushSync racing with the
      // timer cannot interleave file operations.
      writeChain = writeChain.then(() =>
        persist().catch(() => {
          // Persistence failure must not be fatal — the caller may be
          // about to quit and there's no UI to surface this. The next
          // write attempt will retry the encrypt+rename cycle.
        })
      )
    }, debounceMs)
    // Don't keep the event loop alive solely for a pending secure-store
    // flush; quitting the app will run flushSync via before-quit.
    flushTimer.unref?.()
  }

  async function write(doc: SecureStoreDoc): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      if (surfaceUnavailable) {
        // S4 — surface the unavailable condition synchronously to the
        // IPC handler. Pre-fix the renderer thought the JWT had been
        // persisted while in fact it was dropped on the floor.
        const status = requireSafeStorage(safeStorage)
        if (!status.available) throw status.error
      }
      // Legacy contract: drop the write silently and do not memoize
      // (otherwise plaintext credentials would live in a process-wide
      // cache the renderer can request via IPC).
      return
    }
    await ensureLoaded()
    memo = clone(doc)
    dirty = true
    scheduleFlush()
  }

  async function flushSync(): Promise<void> {
    cancelTimer()
    // Wait for any in-flight flush from a previous timer to settle so
    // the persisted file reflects the latest memo on shutdown.
    await writeChain
    if (!dirty) return
    writeChain = persist()
    await writeChain
  }

  async function clear(): Promise<void> {
    cancelTimer()
    await writeChain
    memo = { ...empty }
    loaded = true
    dirty = false
    try {
      await fs.unlink(storePath)
    } catch {
      // best-effort
    }
    // Handle the edge case where unlink silently failed — fall back to
    // sync unlink so a process about to quit still leaves the disk in
    // the expected state.
    if (fsSync.existsSync(storePath)) {
      try {
        fsSync.unlinkSync(storePath)
      } catch {
        // best-effort
      }
    }
  }

  return { read, write, clear, flushSync }
}
