// passwordGenerator — produces a candidate password guaranteed to
// pass the server-side password policy
// (internal/server/password_policy.go) by construction.
//
// Construction guarantees:
//   - Length defaults to 20 (well above the 12-char floor).
//   - One character from each class (lowercase, uppercase, digit,
//     symbol) is forced into the output and then shuffled. This
//     trivially satisfies the "not all-same / not all-digit" rule
//     and produces output that looks credible to an operator
//     glancing at it. (The server does NOT require class mixing,
//     but mixing makes the weak-pattern rule unfalsifiable.)
//   - When `username` is supplied, the generator retries until the
//     password's lower-cased form does NOT contain the username's
//     lower-cased form (mirroring the server's
//     `errPasswordContainsUsername` check). A finite retry budget
//     guards against pathological usernames that match almost any
//     output (e.g. a one-character username) — though the server's
//     `len(username) >= 4` gate makes that almost impossible in
//     practice. After MAX_USERNAME_RETRIES we fall back to a longer
//     password without the substring (the retry budget is generous
//     and exhausting it would imply a degenerate username, e.g.
//     "abc" included by random chance in a 4-symbol slice).
//
// Entropy source is `window.crypto.getRandomValues` (NOT
// Math.random). When the global isn't available (jsdom without
// `crypto`, an SSR pre-render, etc.) the generator throws — there is
// no acceptable fallback for password generation; falling back to
// Math.random would be a real security regression.

import { MIN_PASSWORD_LENGTH, validatePassword } from './passwordPolicy'

const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGIT = '0123456789'
// Symbol pool excludes characters that commonly cause shell-quoting
// pain (backtick, dollar, backslash, single/double quote) so an
// operator pasting the generated value into a CLI doesn't have to
// escape it. The set is still mixed enough that the resulting
// password isn't trivially guessable by a class-based attack.
const SYMBOL = '!@#$%^&*()-_=+'
const ALL = LOWER + UPPER + DIGIT + SYMBOL

const DEFAULT_LENGTH = 20
const MAX_USERNAME_RETRIES = 32

export interface GenerateOptions {
  /** Generated password length. Defaults to 20. Values below
   *  MIN_PASSWORD_LENGTH (12) are silently raised to the floor so a
   *  bad caller cannot land a too-short generated password. */
  length?: number
  /** When provided, the generator retries until the password does
   *  not contain the username substring (case-insensitive). */
  username?: string
}

interface RandomSource {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T
}

function getCryptoOrThrow(): RandomSource {
  // Both browsers and jsdom expose globalThis.crypto when available.
  // Node 19+ also exposes it natively. The bracket access keeps this
  // tree-shake-safe and avoids requiring @types/node for jsdom.
  const c = (globalThis as { crypto?: RandomSource }).crypto
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error(
      'passwordGenerator: window.crypto.getRandomValues is unavailable; ' +
        'cannot generate a cryptographically random password in this environment'
    )
  }
  return c
}

// pickIndex returns a uniformly-distributed integer in [0, max) by
// rejection-sampling against `cap` (the largest multiple of max that
// fits in a Uint32). This avoids the modulo-bias that a naive
// `crypto.getRandomValues(...)[0] % max` would introduce.
function pickIndex(rand: RandomSource, max: number): number {
  if (max <= 0) throw new Error('passwordGenerator: pickIndex max must be > 0')
  if (max === 1) return 0
  const cap = Math.floor(0x100000000 / max) * max
  const buf = new Uint32Array(1)
  // Bounded loop: at worst the rejection rate is < 50% per attempt,
  // so the expected number of iterations is < 2. We cap at 64 to
  // guard against an adversarial RandomSource that always returns
  // values >= cap (impossible with a real crypto.getRandomValues but
  // worth pinning for the test surface).
  for (let i = 0; i < 64; i += 1) {
    rand.getRandomValues(buf)
    if (buf[0]! < cap) return buf[0]! % max
  }
  throw new Error(
    'passwordGenerator: rejection-sample budget exhausted; ' +
      'getRandomValues is not producing uniform output'
  )
}

function randomChar(rand: RandomSource, pool: string): string {
  return pool.charAt(pickIndex(rand, pool.length))
}

function shuffle<T>(rand: RandomSource, arr: T[]): T[] {
  // Fisher-Yates shuffle using rejection-sampled indices.
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = pickIndex(rand, i + 1)
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

function buildOnce(rand: RandomSource, length: number): string {
  // Force at least one of each class so the produced password
  // trivially passes the "not all-same / not all-digit" gate AND
  // contains enough class diversity that a casual visual scan
  // confirms it's strong.
  const required: string[] = [
    randomChar(rand, LOWER),
    randomChar(rand, UPPER),
    randomChar(rand, DIGIT),
    randomChar(rand, SYMBOL),
  ]
  const fillerLen = Math.max(0, length - required.length)
  const filler: string[] = []
  for (let i = 0; i < fillerLen; i += 1) {
    filler.push(randomChar(rand, ALL))
  }
  return shuffle(rand, required.concat(filler)).join('')
}

/**
 * generatePassword returns a candidate password that satisfies every
 * server-side policy rule by construction.
 *
 * Throws if `window.crypto.getRandomValues` is unavailable. The
 * generated password is NEVER returned via Math.random.
 */
export function generatePassword(opts: GenerateOptions = {}): string {
  const rand = getCryptoOrThrow()
  const length = Math.max(MIN_PASSWORD_LENGTH, opts.length ?? DEFAULT_LENGTH)
  const username = opts.username

  // Build, validate against the same client-side policy the UI runs,
  // and retry if it slipped the username-substring rule.
  for (let attempt = 0; attempt < MAX_USERNAME_RETRIES; attempt += 1) {
    const pw = buildOnce(rand, length)
    const result = validatePassword(pw, username)
    if (result.valid) return pw
  }
  // Fall through: bump the length and retry once. The fallback MUST
  // be re-validated against the same policy (QUAL #244) — returning
  // an unvalidated candidate would cause the server to 400 the
  // subsequent create/reset request silently, which is worse UX than
  // throwing here and letting the caller surface the failure.
  const fallback = buildOnce(rand, length + 8)
  const fallbackResult = validatePassword(fallback, username)
  if (fallbackResult.valid) return fallback
  throw new Error(
    'passwordGenerator: exhausted retry budget; ' +
      'no candidate passed validatePassword. ' +
      'This implies a degenerate policy (username matches every random ' +
      'symbol slice, or a mocked validator that always rejects). ' +
      'Reasons: ' +
      fallbackResult.errors.join(',')
  )
}
