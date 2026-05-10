import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'

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

const empty: SecureStoreDoc = {}
const DEFAULT_DEBOUNCE_MS = 250

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
// Integrity invariants are preserved: the on-disk image is still a
// single safeStorage.encryptString blob wrapped in `{encrypted: ...}`,
// the temp+rename atomicity remains, and we never persist plaintext.
export function createSecureStore(opts: SecureStoreOptions): SecureStore {
  const { storePath, safeStorage } = opts
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS

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

  function clone(doc: SecureStoreDoc): SecureStoreDoc {
    // Defensive copy on read so callers can't mutate our memo. The
    // shape is small and JSON-safe, so a JSON round-trip is the
    // simplest correct deep-clone.
    return JSON.parse(JSON.stringify(doc)) as SecureStoreDoc
  }

  async function loadFromDisk(): Promise<SecureStoreDoc> {
    if (!safeStorage.isEncryptionAvailable()) return { ...empty }
    let raw: Buffer
    try {
      raw = await fs.readFile(storePath)
    } catch {
      return { ...empty }
    }
    let parsed: { encrypted?: string }
    try {
      parsed = JSON.parse(raw.toString('utf8')) as { encrypted?: string }
    } catch {
      return { ...empty }
    }
    if (!parsed.encrypted) return { ...empty }
    let decrypted: string
    try {
      decrypted = safeStorage.decryptString(
        Buffer.from(parsed.encrypted, 'base64')
      )
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
  }

  async function read(): Promise<SecureStoreDoc> {
    await ensureLoaded()
    return clone(memo)
  }

  async function persist(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      // Mirror the legacy behaviour: writes are dropped silently when
      // encryption is unavailable so the renderer's best-effort calls
      // don't blow up an unencrypted host.
      dirty = false
      return
    }
    const snapshot = clone(memo)
    const plain = JSON.stringify(snapshot)
    const encrypted = safeStorage.encryptString(plain).toString('base64')
    const payload = JSON.stringify({ encrypted })
    const tmp = `${storePath}.tmp`
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
      // Preserve the legacy contract: if the host has no encryption
      // backing, writes are dropped on the floor and reads return {}.
      // Memoizing here would silently leak plaintext credentials into a
      // process-wide cache that the renderer can request via IPC.
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
