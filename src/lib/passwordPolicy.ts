// passwordPolicy — client-side mirror of the geode server's
// password-policy validator (internal/server/password_policy.go).
//
// The server is the authoritative gatekeeper; this module exists so
// the SPA can:
//   1. Disable the Submit button + surface inline hints before the
//      request is fired, sparing the user a server round-trip + a
//      raw 400 error blob.
//   2. Generate a candidate password (lib/passwordGenerator.ts) that
//      is guaranteed to pass `validatePassword` by construction.
//
// IMPORTANT: when the server-side rules change, update this file in
// the same MR so the two sides stay aligned. The
// `passwordPolicy.test.ts` cases pin the rules and the matched i18n
// keys; the matching server tests live in `password_policy_test.go`.
//
// Server rules mirrored (internal/server/password_policy.go:80-112):
//   1. Minimum length: MIN_PASSWORD_LENGTH = 12.
//   2. Reject all-same-character passwords (e.g. "aaaaaaaaaaaa").
//   3. Reject all-digit passwords (ASCII 0-9 only; CJK digits NOT
//      flagged, matching the server's strict-ASCII rule).
//   4. When username is provided AND username.length >= 4, the
//      password must not contain the username substring
//      (case-insensitive).
//
// The optional HIBP k-anonymity check (server-side, off by default)
// is intentionally NOT mirrored on the client — it requires a
// network round-trip to api.pwnedpasswords.com which the SPA cannot
// shortcut. The server will surface its result via the 400 response.

/** Minimum password length in characters. Matches
 *  internal/server/password_policy.go::MinPasswordLength. */
export const MIN_PASSWORD_LENGTH = 12

/** Username-substring rule activates only when the username is at
 *  least this many characters. Matches the server-side guard at
 *  password_policy.go:93. */
export const USERNAME_SUBSTRING_MIN = 4

/** Discriminated set of policy violations. Each variant maps to an
 *  i18n key consumed by the UI; the helper `messageKeyFor` returns
 *  the key directly so callers don't repeat the switch. */
export type PolicyViolation = 'tooShort' | 'weakPattern' | 'containsUsername'

export interface ValidationResult {
  valid: boolean
  errors: PolicyViolation[]
}

function isAllSameChar(s: string): boolean {
  if (s.length === 0) return false
  const first = s[0]
  for (let i = 1; i < s.length; i += 1) {
    if (s[i] !== first) return false
  }
  return true
}

function isAllAsciiDigits(s: string): boolean {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i)
    if (c < 0x30 || c > 0x39) return false
  }
  return true
}

/**
 * validatePassword runs every policy rule against the candidate and
 * returns the full set of violations (NOT first-fail-only) so the UI
 * can surface multiple hints simultaneously when the user is editing
 * the field.
 *
 * @param pw       candidate password
 * @param username optional username; the substring check only fires
 *                 when `username.length >= USERNAME_SUBSTRING_MIN`.
 */
export function validatePassword(
  pw: string,
  username?: string
): ValidationResult {
  const errors: PolicyViolation[] = []
  if (pw.length < MIN_PASSWORD_LENGTH) errors.push('tooShort')
  if (isAllSameChar(pw) || isAllAsciiDigits(pw)) errors.push('weakPattern')
  if (
    username &&
    username.length >= USERNAME_SUBSTRING_MIN &&
    pw.toLowerCase().includes(username.toLowerCase())
  ) {
    errors.push('containsUsername')
  }
  return { valid: errors.length === 0, errors }
}

/** messageKeyFor returns the i18next key the UI should use to render
 *  the given violation. Centralised so callers don't drift on the
 *  key names. The matching keys live in
 *  src/services/i18n/locales/en.ts under `users.*`. */
export function messageKeyFor(v: PolicyViolation): string {
  switch (v) {
    case 'tooShort':
      return 'users.passwordTooShort'
    case 'weakPattern':
      return 'users.passwordWeakPattern'
    case 'containsUsername':
      return 'users.passwordContainsUsername'
    default:
      // The PolicyViolation union is closed; this branch only fires
      // if a new variant is added without updating the switch. Map
      // to a generic key so the UI still surfaces something.
      return 'users.passwordHintRequirements'
  }
}
