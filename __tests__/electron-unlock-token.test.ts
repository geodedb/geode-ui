// APP-01 R2 (2026-05-24 appsec): pure-function tests for the
// unlock-token map that gates `geode:get-stored-password`. The map
// lives in the electron main process under
// `electron/lib/unlock-tokens.ts` so it can be exercised without
// `electron` in node_modules — same pattern as `safety.ts`.
//
// Tokens are issued at signIn (R2 path) AND opened on demand via the
// new `geode:open-unlock-window` IPC. They are single-use and expire
// after the configured TTL (default ~30 s). A renderer compromise
// that lacks a matching token gets `null` from every
// `getStoredPassword` call.

import { createUnlockTokenStore } from '../electron/lib/unlock-tokens'

describe('unlock-token store (APP-01 R2)', () => {
  test('issued token validates exactly once then expires', () => {
    const store = createUnlockTokenStore({ ttlMs: 30_000 })
    const tok = store.issue()
    expect(typeof tok).toBe('string')
    // 64 hex chars (32 random bytes → hex).
    expect(tok).toMatch(/^[0-9a-f]{64}$/)
    // First consume succeeds.
    expect(store.consume(tok)).toBe(true)
    // Second consume fails — single-use semantics.
    expect(store.consume(tok)).toBe(false)
  })

  test('unknown / null tokens never validate', () => {
    const store = createUnlockTokenStore({ ttlMs: 30_000 })
    expect(store.consume('not-a-real-token')).toBe(false)
    expect(store.consume('')).toBe(false)
    expect(store.consume(undefined as unknown as string)).toBe(false)
    expect(store.consume(null as unknown as string)).toBe(false)
    expect(store.consume(42 as unknown as string)).toBe(false)
  })

  test('expired token does not validate (advances now())', () => {
    let fakeNow = 1_000_000
    const store = createUnlockTokenStore({
      ttlMs: 30_000,
      now: () => fakeNow,
    })
    const tok = store.issue()
    // Right at TTL boundary — must still be valid.
    fakeNow += 30_000 - 1
    expect(store.consume(tok)).toBe(true)

    // A fresh token, then we advance past TTL.
    const tok2 = store.issue()
    fakeNow += 30_001
    expect(store.consume(tok2)).toBe(false)
  })

  test('multiple issued tokens are independent', () => {
    const store = createUnlockTokenStore({ ttlMs: 30_000 })
    const a = store.issue()
    const b = store.issue()
    expect(a).not.toBe(b)
    expect(store.consume(a)).toBe(true)
    expect(store.consume(b)).toBe(true)
    expect(store.consume(a)).toBe(false)
    expect(store.consume(b)).toBe(false)
  })

  test('gc cleans up expired tokens (no unbounded growth)', () => {
    let fakeNow = 0
    const store = createUnlockTokenStore({
      ttlMs: 1_000,
      now: () => fakeNow,
    })
    // Issue 100 short-lived tokens, advance well past TTL, then issue
    // another — the store should never grow beyond the live tokens.
    const issued: string[] = []
    for (let i = 0; i < 100; i += 1) {
      issued.push(store.issue())
    }
    expect(store.size()).toBe(100)
    fakeNow = 5_000
    // Issue a fresh token; the issuance path opportunistically GCs.
    store.issue()
    // After the gc the store holds only the freshly-issued token.
    expect(store.size()).toBe(1)
    // The originals all fail to consume — expired AND evicted.
    issued.forEach((t) => {
      expect(store.consume(t)).toBe(false)
    })
  })

  test('clear() empties the store', () => {
    const store = createUnlockTokenStore({ ttlMs: 30_000 })
    const a = store.issue()
    const b = store.issue()
    store.clear()
    expect(store.consume(a)).toBe(false)
    expect(store.consume(b)).toBe(false)
    expect(store.size()).toBe(0)
  })
})
