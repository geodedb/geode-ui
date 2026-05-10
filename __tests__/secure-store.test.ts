import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import {
  createSecureStore,
  SafeStorageLike,
} from '../electron/lib/secure-store'

interface CountingFake extends SafeStorageLike {
  encryptCount: number
  decryptCount: number
}

function fakeSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
  }
}

function countingFakeSafeStorage(): CountingFake {
  const fake = {
    encryptCount: 0,
    decryptCount: 0,
    isEncryptionAvailable: () => true,
    encryptString(s: string): Buffer {
      fake.encryptCount += 1
      return Buffer.from(`enc:${s}`, 'utf8')
    },
    decryptString(b: Buffer): string {
      fake.decryptCount += 1
      return b.toString('utf8').replace(/^enc:/, '')
    },
  }
  return fake
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

// ---------------------------------------------------------------------------
// F6 (#92) — in-process memo + debounced flush. The closures below cover the
// four behaviours called out in the gap entry: hot-read serves from memo,
// burst writes coalesce into a single flush, write-then-read is coherent,
// and `flushSync` drains pending state on the `before-quit` lifecycle.
// ---------------------------------------------------------------------------

test('F6: multiple reads after a single write decrypt only once (memo)', async () => {
  const dir = await tmpDir()
  const fake = countingFakeSafeStorage()
  const store = createSecureStore({
    storePath: path.join(dir, 'secure.json'),
    safeStorage: fake,
  })
  await store.write({
    connections: [
      { connectionId: 'c1', token: 't', profileName: 'p', expiresAt: 1 },
    ],
  })
  // Force the disk image to flush so we know the read path is exercising
  // the memo (not just an empty-file shortcut).
  await store.flushSync()
  const before = fake.decryptCount
  // Three back-to-back reads — fan out via Promise.all rather than a
  // sequential for-await so eslint's no-await-in-loop rule is happy.
  await Promise.all([store.read(), store.read(), store.read()])
  // The write populated the memo, so subsequent reads should not need to
  // decrypt at all. Pre-fix: 3 decrypts.
  expect(fake.decryptCount - before).toBe(0)
  await fs.rm(dir, { recursive: true })
})

test('F6: cold-start decrypt happens once across many reads', async () => {
  const dir = await tmpDir()
  const filePath = path.join(dir, 'secure.json')
  // Seed an existing encrypted file from a prior process.
  {
    const seedFake = fakeSafeStorage()
    const seedStore = createSecureStore({
      storePath: filePath,
      safeStorage: seedFake,
    })
    await seedStore.write({
      passwords: { 'a\x00b': 'pw' },
    })
    await seedStore.flushSync()
  }
  // Now open a fresh store (cold memo) and read repeatedly.
  const fake = countingFakeSafeStorage()
  const store = createSecureStore({
    storePath: filePath,
    safeStorage: fake,
  })
  await store.read()
  await store.read()
  await store.read()
  expect(fake.decryptCount).toBe(1)
  await fs.rm(dir, { recursive: true })
})

test('F6: multiple writes within debounce window encrypt only once', async () => {
  jest.useFakeTimers()
  try {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'secure-store-'))
    const fake = countingFakeSafeStorage()
    const store = createSecureStore({
      storePath: path.join(dir, 'secure.json'),
      safeStorage: fake,
    })
    await store.write({
      connections: [
        { connectionId: 'c1', token: 't1', profileName: 'p', expiresAt: 1 },
      ],
    })
    await store.write({
      connections: [
        { connectionId: 'c1', token: 't2', profileName: 'p', expiresAt: 1 },
      ],
    })
    await store.write({
      connections: [
        { connectionId: 'c1', token: 't3', profileName: 'p', expiresAt: 1 },
      ],
    })
    // Pre-fix: 3 encryptString calls + 3 file writes. Post-fix: 0
    // encryptString calls until the debounce window expires.
    expect(fake.encryptCount).toBe(0)
    // Advance past the 250ms debounce window; the flush is async, so we
    // must also let the resulting promise settle.
    jest.advanceTimersByTime(260)
    // Drain the debounce-triggered persist by calling flushSync, which
    // awaits the same writeChain the timer enqueues onto.
    await store.flushSync()
    expect(fake.encryptCount).toBe(1)
    await fs.rm(dir, { recursive: true })
  } finally {
    jest.useRealTimers()
  }
})

test('F6: write-then-immediate-read returns the new value (memo coherent)', async () => {
  const dir = await tmpDir()
  const fake = countingFakeSafeStorage()
  const store = createSecureStore({
    storePath: path.join(dir, 'secure.json'),
    safeStorage: fake,
  })
  await store.write({
    connections: [
      { connectionId: 'c1', token: 'first', profileName: 'p', expiresAt: 1 },
    ],
  })
  // No flush in between — memo should still reflect the latest value
  // synchronously (before the debounced disk write fires).
  const got = await store.read()
  expect(got.connections?.[0]?.token).toBe('first')
  await store.flushSync()
  await fs.rm(dir, { recursive: true })
})

test('F6: flushSync drains pending writes synchronously for before-quit', async () => {
  jest.useFakeTimers()
  try {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'secure-store-'))
    const filePath = path.join(dir, 'secure.json')
    const fake = countingFakeSafeStorage()
    const store = createSecureStore({
      storePath: filePath,
      safeStorage: fake,
    })
    await store.write({
      connections: [
        { connectionId: 'c1', token: 'tok', profileName: 'p', expiresAt: 1 },
      ],
    })
    // Without flushing, the file should not yet exist (debounce pending).
    expect(fsSync.existsSync(filePath)).toBe(false)
    await store.flushSync()
    expect(fsSync.existsSync(filePath)).toBe(true)
    expect(fake.encryptCount).toBe(1)
    // A second flushSync with no dirty state must be a no-op.
    await store.flushSync()
    expect(fake.encryptCount).toBe(1)
    await fs.rm(dir, { recursive: true })
  } finally {
    jest.useRealTimers()
  }
})

test('F6: clear resets memo and removes file', async () => {
  const dir = await tmpDir()
  const filePath = path.join(dir, 'secure.json')
  const fake = countingFakeSafeStorage()
  const store = createSecureStore({
    storePath: filePath,
    safeStorage: fake,
  })
  await store.write({ passwords: { 'a\x00b': 'pw' } })
  await store.flushSync()
  expect(fsSync.existsSync(filePath)).toBe(true)
  await store.clear()
  expect(fsSync.existsSync(filePath)).toBe(false)
  // Subsequent read sees an empty doc, not the cached one.
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
  const store = createSecureStore({
    storePath: filePath,
    safeStorage: unavailable,
  })
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
