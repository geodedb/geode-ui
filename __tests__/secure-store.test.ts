import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import {
  createSecureStore,
  SafeStorageLike,
} from '../electron/lib/secure-store'
import { joinTmp, randomTmpSuffix } from '../electron/lib/ipc-guards'

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
      // The S4 HMAC envelope derives a per-store MAC key by encrypting
      // a constant label. That derivation runs once per store and must
      // not inflate the payload encrypt count tracked by the F6 perf
      // assertions (which pin the number of *payload* encrypts).
      if (s !== 'geode-ui-mac-key-v1') {
        fake.encryptCount += 1
      }
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

test('encryption unavailable (legacy surfaceUnavailable=false): write is silent no-op', async () => {
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
    surfaceUnavailable: false,
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

// ---------------------------------------------------------------------------
// S4 (#117) — secure-store integrity: HMAC envelope, surface unavailable
// instead of silent no-op, randomized tmp file. The four tests below
// pin the new on-disk envelope shape (v2 JSON), the tampered-MAC
// rejection, the SecureStoreUnavailableError surface, and the legacy
// `{encrypted}` envelope migration on next write.
// ---------------------------------------------------------------------------

test('S4: write emits a v2 envelope with hmac field', async () => {
  const dir = await tmpDir()
  const filePath = path.join(dir, 'secure.json')
  const store = createSecureStore({
    storePath: filePath,
    safeStorage: fakeSafeStorage(),
  })
  await store.write({ passwords: { 'a\x00b': 'pw' } })
  await store.flushSync()
  const raw = await fs.readFile(filePath, 'utf8')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  expect(parsed.v).toBe(2)
  expect(typeof parsed.ciphertext).toBe('string')
  expect(typeof parsed.hmac).toBe('string')
  // hmac is hex-encoded SHA256 → 64 hex chars.
  expect((parsed.hmac as string).length).toBe(64)
  await fs.rm(dir, { recursive: true })
})

test('S4: tampered ciphertext fails MAC and yields empty doc on read', async () => {
  const dir = await tmpDir()
  const filePath = path.join(dir, 'secure.json')
  const fake = fakeSafeStorage()
  // Seed a v2 envelope.
  {
    const seedStore = createSecureStore({
      storePath: filePath,
      safeStorage: fake,
    })
    await seedStore.write({ passwords: { 'a\x00b': 'pw' } })
    await seedStore.flushSync()
  }
  // Tamper: flip a bit in the ciphertext field.
  const raw = JSON.parse(
    await fs.readFile(filePath, 'utf8')
  ) as Record<string, unknown>
  const tampered = Buffer.from(raw.ciphertext as string, 'base64')
  tampered[0] = (tampered[0]! ^ 0x01) & 0xff
  raw.ciphertext = tampered.toString('base64')
  await fs.writeFile(filePath, JSON.stringify(raw))

  // Fresh store (cold memo) — must reject the tampered envelope.
  const store = createSecureStore({
    storePath: filePath,
    safeStorage: fakeSafeStorage(),
  })
  const got = await store.read()
  expect(got).toEqual({})
  await fs.rm(dir, { recursive: true })
})

test('S4: surfaceUnavailable=true throws SecureStoreUnavailableError on write', async () => {
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
    // Default is true; pinning explicitly for clarity.
    surfaceUnavailable: true,
  })
  await expect(
    store.write({
      connections: [
        { connectionId: 'c', token: 't', profileName: 'p', expiresAt: 0 },
      ],
    })
  ).rejects.toThrow(/safeStorage/i)
  await fs.rm(dir, { recursive: true })
})

test('S4: legacy {encrypted} envelope is migrated to v2 on next write', async () => {
  const dir = await tmpDir()
  const filePath = path.join(dir, 'secure.json')
  const fake = fakeSafeStorage()
  // Hand-craft a legacy envelope (pre-S4 shape).
  const plain = JSON.stringify({ passwords: { 'a\x00b': 'legacy' } })
  const legacy = {
    encrypted: fake.encryptString(plain).toString('base64'),
  }
  await fs.writeFile(filePath, JSON.stringify(legacy), 'utf8')

  const store = createSecureStore({
    storePath: filePath,
    safeStorage: fakeSafeStorage(),
  })
  // Cold read should still surface the legacy doc.
  const got = await store.read()
  expect(got.passwords?.['a\x00b']).toBe('legacy')

  // Trigger a write so the legacy envelope is migrated. The memo is
  // marked dirty by ensureLoaded() when it detects the legacy shape,
  // so even a no-op write triggers the migration.
  await store.write({ passwords: { 'a\x00b': 'legacy', new: 'now' } })
  await store.flushSync()

  // The on-disk envelope is now v2.
  const raw = JSON.parse(
    await fs.readFile(filePath, 'utf8')
  ) as Record<string, unknown>
  expect(raw.v).toBe(2)
  expect(raw.encrypted).toBeUndefined()
  expect(typeof raw.ciphertext).toBe('string')
  expect(typeof raw.hmac).toBe('string')
  await fs.rm(dir, { recursive: true })
})

test('S4: tmp file uses a randomized hex suffix (no predictable .tmp)', () => {
  // We cannot observe the tmp file directly because rename happens
  // synchronously from our perspective, but we CAN verify the helper
  // that names it returns distinct paths each call.
  const a = joinTmp('/var/secure.json', randomTmpSuffix())
  const b = joinTmp('/var/secure.json', randomTmpSuffix())
  expect(a).not.toBe(b)
  expect(a.endsWith('.tmp')).toBe(true)
  // Suffix is 16 hex chars + '.tmp' before basename of storePath.
  expect(a).toMatch(/secure\.json\.[0-9a-f]{16}\.tmp$/)
})
