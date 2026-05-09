import fs from 'node:fs/promises'
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
}

export interface SecureStore {
  read(): Promise<SecureStoreDoc>
  write(doc: SecureStoreDoc): Promise<void>
  clear(): Promise<void>
}

const empty: SecureStoreDoc = {}

export function createSecureStore(opts: SecureStoreOptions): SecureStore {
  const { storePath, safeStorage } = opts

  async function read(): Promise<SecureStoreDoc> {
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

  async function write(doc: SecureStoreDoc): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) return
    const plain = JSON.stringify(doc)
    const encrypted = safeStorage.encryptString(plain).toString('base64')
    const payload = JSON.stringify({ encrypted })
    const tmp = `${storePath}.tmp`
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(tmp, payload, { mode: 0o600 })
    await fs.rename(tmp, storePath)
  }

  async function clear(): Promise<void> {
    try {
      await fs.unlink(storePath)
    } catch {
      // best-effort
    }
  }

  return { read, write, clear }
}
