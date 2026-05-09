import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { createSecureStore, SafeStorageLike } from '../electron/lib/secure-store'

function fakeSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
  }
}

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'secure-store-'))
}

test('write then read round-trips a typed document', async () => {
  const dir = await tmpDir()
  const store = createSecureStore({
    storePath: path.join(dir, 'secure.json'),
    safeStorage: fakeSafeStorage(),
  })
  await store.write({
    connections: [
      {
        connectionId: 'c1',
        token: 'tok',
        profileName: 'prod',
        expiresAt: 1700000000000,
      },
    ],
  })
  const got = await store.read()
  expect(got.connections?.[0]?.token).toBe('tok')
  expect(got.connections?.[0]?.profileName).toBe('prod')
  await fs.rm(dir, { recursive: true })
})

test('read on missing file returns empty document', async () => {
  const dir = await tmpDir()
  const store = createSecureStore({
    storePath: path.join(dir, 'secure.json'),
    safeStorage: fakeSafeStorage(),
  })
  const got = await store.read()
  expect(got).toEqual({})
  await fs.rm(dir, { recursive: true })
})

test('read on corrupted file returns empty document', async () => {
  const dir = await tmpDir()
  const filePath = path.join(dir, 'secure.json')
  await fs.writeFile(filePath, 'not-json')
  const store = createSecureStore({
    storePath: filePath,
    safeStorage: fakeSafeStorage(),
  })
  const got = await store.read()
  expect(got).toEqual({})
  await fs.rm(dir, { recursive: true })
})

test('encryption unavailable: read returns empty, write is a no-op', async () => {
  const dir = await tmpDir()
  const filePath = path.join(dir, 'secure.json')
  const unavailable: SafeStorageLike = {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('not available')
    },
    decryptString: () => {
      throw new Error('not available')
    },
  }
  const store = createSecureStore({ storePath: filePath, safeStorage: unavailable })
  await store.write({
    connections: [
      { connectionId: 'c', token: 't', profileName: 'p', expiresAt: 0 },
    ],
  })
  const got = await store.read()
  expect(got).toEqual({})
  // No file should have been written.
  await expect(fs.access(filePath)).rejects.toThrow()
  await fs.rm(dir, { recursive: true })
})
