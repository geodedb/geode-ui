// C1 module — coordinated tests for the IPC trust-boundary guards
// (S3 + S4 + S8 / GitLab #116 + #117 + #121).
//
// These tests cover three orthogonal helpers that share one rationale —
// the renderer is untrusted and every IPC payload must be sanitised
// before it reaches the secure-store / dialog / file-system layers:
//
//   • safeReadPemFile          — S3 (TOCTOU + symlink + size cap).
//   • sanitizeConnections      — S8 (typed, capped, finite array).
//   • sanitizeSavedPasswordIn  — S8 (typed, capped, finite triple).
//   • requireSafeStorage       — S4 (surface unavailable instead of
//                                 silent no-op).
//
// All helpers are stdlib-only so they run inside the SPA jest config
// without `electron` being installed.

import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'

import {
  requireSafeStorage,
  safeReadPemFile,
  sanitizeConnections,
  sanitizeSavedPasswordInput,
  SecureStoreUnavailableError,
} from '../electron/lib/ipc-guards'

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ipc-guards-'))
}

const PEM_HEADER = '-----BEGIN CERTIFICATE-----'
const PEM_FOOTER = '-----END CERTIFICATE-----'
const SAMPLE_PEM = `${PEM_HEADER}\nMIIBkTCB+wIJ...\n${PEM_FOOTER}\n`

describe('safeReadPemFile (S3 — pickPemFile TOCTOU + symlink + cap)', () => {
  test('reads a PEM file under the cap', async () => {
    const dir = await tmpDir()
    try {
      const file = path.join(dir, 'cert.pem')
      await fs.writeFile(file, SAMPLE_PEM, 'utf8')
      const got = await safeReadPemFile(file, { maxBytes: 1024 * 1024 })
      expect(got).toBe(SAMPLE_PEM)
    } finally {
      await fs.rm(dir, { recursive: true })
    }
  })

  test('rejects a file larger than maxBytes', async () => {
    const dir = await tmpDir()
    try {
      const file = path.join(dir, 'big.pem')
      // 4 KB body, cap of 1 KB → must reject without ever reading bytes.
      const body = `${PEM_HEADER}\n${'A'.repeat(4096)}\n${PEM_FOOTER}\n`
      await fs.writeFile(file, body, 'utf8')
      await expect(
        safeReadPemFile(file, { maxBytes: 1024 })
      ).rejects.toThrow(/too large/i)
    } finally {
      await fs.rm(dir, { recursive: true })
    }
  })

  test('rejects a symlink (does not follow)', async () => {
    const dir = await tmpDir()
    try {
      const real = path.join(dir, 'real.pem')
      const link = path.join(dir, 'link.pem')
      await fs.writeFile(real, SAMPLE_PEM, 'utf8')
      await fs.symlink(real, link)
      await expect(
        safeReadPemFile(link, { maxBytes: 1024 * 1024 })
      ).rejects.toThrow(/symlink|symbolic|loop/i)
    } finally {
      await fs.rm(dir, { recursive: true })
    }
  })

  test('rejects a file whose contents are not PEM-shaped', async () => {
    const dir = await tmpDir()
    try {
      const file = path.join(dir, 'garbage.pem')
      await fs.writeFile(file, 'this is not a pem file at all', 'utf8')
      await expect(
        safeReadPemFile(file, { maxBytes: 1024 * 1024 })
      ).rejects.toThrow(/PEM/i)
    } finally {
      await fs.rm(dir, { recursive: true })
    }
  })

  test('rejects a missing file', async () => {
    const dir = await tmpDir()
    try {
      await expect(
        safeReadPemFile(path.join(dir, 'nope.pem'), { maxBytes: 1024 })
      ).rejects.toThrow()
    } finally {
      await fs.rm(dir, { recursive: true })
    }
  })

  test('rejects non-string filePath', async () => {
    await expect(
      safeReadPemFile(42 as unknown as string, { maxBytes: 1024 })
    ).rejects.toThrow(/path/i)
  })
})

describe('sanitizeConnections (S8 — geode:store-connections input)', () => {
  const NOW = 2_000_000_000_000 // arbitrary fixed clock for determinism
  const opts = {
    maxLen: 32,
    maxTokenLen: 4096,
    maxNameLen: 128,
    maxExpiresMs: 7 * 86_400_000,
    now: NOW,
  } as const

  test('accepts a valid array', () => {
    const got = sanitizeConnections(
      [
        {
          connectionId: 'c1',
          token: 'tok',
          profileName: 'prod',
          expiresAt: NOW + 1000,
        },
      ],
      opts
    )
    expect(got).not.toBeNull()
    expect(got).toHaveLength(1)
    expect(got?.[0]?.connectionId).toBe('c1')
  })

  test('accepts an empty array', () => {
    expect(sanitizeConnections([], opts)).toEqual([])
  })

  test('rejects non-arrays', () => {
    expect(sanitizeConnections({} as unknown, opts)).toBeNull()
    expect(sanitizeConnections('x' as unknown, opts)).toBeNull()
    expect(sanitizeConnections(null, opts)).toBeNull()
    expect(sanitizeConnections(undefined, opts)).toBeNull()
    expect(sanitizeConnections(42 as unknown, opts)).toBeNull()
  })

  test('rejects oversized arrays (> maxLen)', () => {
    const oversized = Array.from({ length: opts.maxLen + 1 }, (_, i) => ({
      connectionId: `c${i}`,
      token: 't',
      profileName: 'p',
      expiresAt: NOW + 1000,
    }))
    expect(sanitizeConnections(oversized, opts)).toBeNull()
  })

  test('rejects element with non-string connectionId', () => {
    const bad = [
      {
        connectionId: 123,
        token: 't',
        profileName: 'p',
        expiresAt: NOW + 1000,
      },
    ]
    expect(sanitizeConnections(bad, opts)).toBeNull()
  })

  test('rejects element with non-string token', () => {
    const bad = [
      {
        connectionId: 'c',
        token: { secret: 'x' },
        profileName: 'p',
        expiresAt: NOW + 1000,
      },
    ]
    expect(sanitizeConnections(bad, opts)).toBeNull()
  })

  test('rejects element with oversized token', () => {
    const bad = [
      {
        connectionId: 'c',
        token: 'A'.repeat(opts.maxTokenLen + 1),
        profileName: 'p',
        expiresAt: NOW + 1000,
      },
    ]
    expect(sanitizeConnections(bad, opts)).toBeNull()
  })

  test('rejects element with oversized profileName', () => {
    const bad = [
      {
        connectionId: 'c',
        token: 't',
        profileName: 'p'.repeat(opts.maxNameLen + 1),
        expiresAt: NOW + 1000,
      },
    ]
    expect(sanitizeConnections(bad, opts)).toBeNull()
  })

  test('rejects element with non-finite expiresAt', () => {
    expect(
      sanitizeConnections(
        [
          {
            connectionId: 'c',
            token: 't',
            profileName: 'p',
            expiresAt: Number.NaN,
          },
        ],
        opts
      )
    ).toBeNull()
    expect(
      sanitizeConnections(
        [
          {
            connectionId: 'c',
            token: 't',
            profileName: 'p',
            expiresAt: Number.POSITIVE_INFINITY,
          },
        ],
        opts
      )
    ).toBeNull()
  })

  test('rejects expiresAt before now (already-expired tokens)', () => {
    expect(
      sanitizeConnections(
        [
          {
            connectionId: 'c',
            token: 't',
            profileName: 'p',
            expiresAt: NOW - 1,
          },
        ],
        opts
      )
    ).toBeNull()
  })

  test('rejects expiresAt past now + maxExpiresMs', () => {
    expect(
      sanitizeConnections(
        [
          {
            connectionId: 'c',
            token: 't',
            profileName: 'p',
            expiresAt: NOW + opts.maxExpiresMs + 1,
          },
        ],
        opts
      )
    ).toBeNull()
  })

  test('rejects non-object element', () => {
    expect(
      sanitizeConnections(['not-an-object'] as unknown, opts)
    ).toBeNull()
    expect(sanitizeConnections([null] as unknown, opts)).toBeNull()
  })

  test('strips unknown fields from the returned shape', () => {
    const got = sanitizeConnections(
      [
        {
          connectionId: 'c1',
          token: 'tok',
          profileName: 'prod',
          expiresAt: NOW + 1000,
          // Unknown fields the renderer might smuggle in.
          extraField: '__proto__',
          __proto__: { polluted: true },
        },
      ],
      opts
    )
    expect(got).not.toBeNull()
    const out = got?.[0] as Record<string, unknown>
    expect(out).toEqual({
      connectionId: 'c1',
      token: 'tok',
      profileName: 'prod',
      expiresAt: NOW + 1000,
    })
    expect(out.extraField).toBeUndefined()
  })
})

describe('sanitizeSavedPasswordInput (S8 — geode:store-saved-password)', () => {
  const opts = {
    maxNameLen: 128,
    maxUsernameLen: 256,
    maxPasswordLen: 1024,
  } as const

  test('accepts a valid triple', () => {
    const got = sanitizeSavedPasswordInput(
      { profile: 'prod', username: 'alice', password: 'p@ssw0rd' },
      opts
    )
    expect(got).toEqual({
      profile: 'prod',
      username: 'alice',
      password: 'p@ssw0rd',
    })
  })

  test('rejects non-object input', () => {
    expect(sanitizeSavedPasswordInput(null, opts)).toBeNull()
    expect(sanitizeSavedPasswordInput('x', opts)).toBeNull()
    expect(sanitizeSavedPasswordInput(42, opts)).toBeNull()
  })

  test('rejects when any field is not a string', () => {
    expect(
      sanitizeSavedPasswordInput(
        { profile: 1, username: 'a', password: 'b' },
        opts
      )
    ).toBeNull()
    expect(
      sanitizeSavedPasswordInput(
        { profile: 'p', username: null, password: 'b' },
        opts
      )
    ).toBeNull()
    expect(
      sanitizeSavedPasswordInput(
        { profile: 'p', username: 'a', password: { value: 'b' } },
        opts
      )
    ).toBeNull()
  })

  test('rejects oversized password', () => {
    expect(
      sanitizeSavedPasswordInput(
        {
          profile: 'p',
          username: 'a',
          password: 'x'.repeat(opts.maxPasswordLen + 1),
        },
        opts
      )
    ).toBeNull()
  })

  test('rejects oversized profile', () => {
    expect(
      sanitizeSavedPasswordInput(
        {
          profile: 'p'.repeat(opts.maxNameLen + 1),
          username: 'a',
          password: 'b',
        },
        opts
      )
    ).toBeNull()
  })

  test('rejects oversized username', () => {
    expect(
      sanitizeSavedPasswordInput(
        {
          profile: 'p',
          username: 'u'.repeat(opts.maxUsernameLen + 1),
          password: 'b',
        },
        opts
      )
    ).toBeNull()
  })

  test('rejects empty profile/username (null-byte-style key collision)', () => {
    expect(
      sanitizeSavedPasswordInput(
        { profile: '', username: 'a', password: 'b' },
        opts
      )
    ).toBeNull()
    expect(
      sanitizeSavedPasswordInput(
        { profile: 'p', username: '', password: 'b' },
        opts
      )
    ).toBeNull()
  })

  test('rejects null bytes in any string field (key separator collision)', () => {
    // `pwKey` uses `\x00` as the join separator; a renderer that puts
    // a null byte into either field could collide keys for a different
    // profile+username pair. Reject defensively.
    expect(
      sanitizeSavedPasswordInput(
        { profile: 'p\x00x', username: 'a', password: 'b' },
        opts
      )
    ).toBeNull()
    expect(
      sanitizeSavedPasswordInput(
        { profile: 'p', username: 'a\x00b', password: 'b' },
        opts
      )
    ).toBeNull()
  })
})

describe('requireSafeStorage (S4 — surface unavailable, do not silently no-op)', () => {
  test('returns available:true when isEncryptionAvailable is true', () => {
    const got = requireSafeStorage({
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    })
    expect(got.available).toBe(true)
  })

  test('returns available:false with a SecureStoreUnavailableError', () => {
    const got = requireSafeStorage({
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    })
    expect(got.available).toBe(false)
    if (!got.available) {
      expect(got.error).toBeInstanceOf(SecureStoreUnavailableError)
      expect(got.error.message).toMatch(/safeStorage/i)
    }
  })

  test('SecureStoreUnavailableError is throwable + identifiable', () => {
    const e = new SecureStoreUnavailableError('boom')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('SecureStoreUnavailableError')
    expect(e.message).toBe('boom')
  })
})
