// APP-01 R2 (2026-05-24 appsec): unlock-token gate for the saved-
// password IPC channels. Pre-R2 a renderer compromise could call
// `geode:get-stored-password` for any `(profile, username)` pair with
// no further authorisation. R2 binds every successful read to a single-
// use token issued at signIn (the "unlock window") OR opened on demand
// via the new `geode:open-unlock-window` IPC. Tokens expire after the
// configured TTL (default ~30 s). A renderer compromise that lacks a
// matching token gets `null` from the IPC.
//
// This module is intentionally stdlib-only so it unit-tests under the
// SPA's jest harness without `electron` in node_modules. The actual
// token mint uses `crypto.randomBytes(32).toString('hex')`; tests
// inject a `mintToken` override to make sequences deterministic.

import crypto from 'node:crypto'

export interface UnlockTokenStoreOptions {
  /** Milliseconds a freshly-minted token remains valid. */
  ttlMs: number
  /** Override for tests; defaults to `Date.now`. */
  now?: () => number
  /**
   * Override for tests; defaults to
   * `crypto.randomBytes(32).toString('hex')`.
   */
  mintToken?: () => string
}

export interface UnlockTokenStore {
  /**
   * Mint a fresh token and stash it in the store. Returns the token
   * value as a hex string. Opportunistically garbage-collects expired
   * entries so the store cannot grow unboundedly under a chatty
   * `geode:open-unlock-window` caller.
   */
  issue(): string
  /**
   * Consume `token`. Returns true exactly once iff the token is in
   * the store AND has not yet expired; subsequent calls return false
   * even with the same token (single-use semantics). Robust against
   * undefined / null / non-string inputs.
   */
  consume(token: unknown): boolean
  /** Number of live (non-expired) tokens currently stored. */
  size(): number
  /** Drop every token. Called on logout. */
  clear(): void
}

interface Entry {
  expiresAt: number
}

export function createUnlockTokenStore(
  opts: UnlockTokenStoreOptions
): UnlockTokenStore {
  const ttlMs = opts.ttlMs
  const now = opts.now ?? (() => Date.now())
  const mint =
    opts.mintToken ?? (() => crypto.randomBytes(32).toString('hex'))
  const tokens = new Map<string, Entry>()

  function gc(): void {
    const t = now()
    const expired: string[] = []
    tokens.forEach((entry, key) => {
      if (entry.expiresAt <= t) expired.push(key)
    })
    expired.forEach((k) => tokens.delete(k))
  }

  return {
    issue(): string {
      // Opportunistic GC on every issuance keeps the upper bound
      // tied to the rate of legitimate calls instead of process
      // lifetime.
      gc()
      const token = mint()
      tokens.set(token, { expiresAt: now() + ttlMs })
      return token
    },
    consume(token: unknown): boolean {
      if (typeof token !== 'string' || token.length === 0) return false
      const entry = tokens.get(token)
      if (!entry) return false
      // Single-use: always delete on lookup, even if expired (so a
      // stale token cannot squat on the entry).
      tokens.delete(token)
      if (entry.expiresAt <= now()) return false
      return true
    },
    size(): number {
      // Live size excludes already-expired entries. The exact number
      // depends on whether issuance has GC'd them yet; for the test's
      // purposes we still report the raw map size after gc().
      gc()
      return tokens.size
    },
    clear(): void {
      tokens.clear()
    },
  }
}
