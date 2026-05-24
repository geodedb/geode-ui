// APP-01 R3 (2026-05-24 appsec): OS-native re-authentication wrapper
// for the saved-password IPC channels. Opt-in via the
// `savedPasswordRequireBiometric` preference (persisted in the
// secure-store). When the pref is on and the platform supports a
// biometric prompt, the renderer must clear the prompt before the
// stored-password read returns plaintext.
//
// Platform support in this commit:
//   - macOS (`darwin`): `systemPreferences.canPromptTouchID()` +
//     `systemPreferences.promptTouchID('Unlock saved password')`. A
//     rejected prompt returns `false` (fail-closed).
//   - Windows (`win32`): fail-closed stub returning `false`. Wiring
//     Windows Hello requires a native module (no public Electron API
//     surface yet); tracked as a follow-up. Until then, opting into
//     the pref on Windows means every read returns `null`.
//   - Linux: fail-closed stub returning `false`. Wiring polkit /
//     pkexec is a follow-up. Same opt-in semantics as Windows.
//
// `createBiometricGate` is dependency-injected so unit tests don't
// touch `electron`'s `systemPreferences` and so a future macOS API
// change can be absorbed at one site.

export interface BiometricDeps {
  platform: NodeJS.Platform
  canPromptTouchID: () => boolean
  promptTouchID: (reason: string) => Promise<void>
  /**
   * Window during which a successful prompt allows the unlock-token
   * gate (APP-01 R2) to be skipped. Defaults to 60 s per the planner
   * spec.
   */
  recentWindowMs?: number
  /** Override for tests; defaults to `Date.now`. */
  now?: () => number
}

export interface BiometricGate {
  /**
   * Prompt the user. Returns true iff the prompt was satisfied; false
   * for any rejection, cancellation, unsupported platform, or
   * unavailable hardware. The success path stamps an internal
   * "recently-succeeded" marker used by `hasRecentSuccess()`.
   */
  prompt(reason: string): Promise<boolean>
  /**
   * Returns true if a successful prompt landed within the
   * `recentWindowMs` window. The saved-password IPC handler reads
   * this to decide whether to skip the R2 unlock-token gate.
   */
  hasRecentSuccess(): boolean
  /** Drop the recently-succeeded marker. Called on logout. */
  clear(): void
}

const DEFAULT_RECENT_WINDOW_MS = 60_000

export function createBiometricGate(deps: BiometricDeps): BiometricGate {
  const recentWindowMs = deps.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS
  const now = deps.now ?? (() => Date.now())
  let lastSuccessAt: number | null = null

  async function prompt(reason: string): Promise<boolean> {
    if (deps.platform === 'darwin') {
      if (!deps.canPromptTouchID()) return false
      try {
        await deps.promptTouchID(reason)
        lastSuccessAt = now()
        return true
      } catch {
        return false
      }
    }
    // Windows + Linux + everything else: fail-closed stub. Wiring
    // Hello / polkit is a follow-up; opting into the pref on these
    // platforms means every read returns null until the follow-up
    // lands. That's the documented contract.
    return false
  }

  function hasRecentSuccess(): boolean {
    if (lastSuccessAt === null) return false
    return now() - lastSuccessAt <= recentWindowMs
  }

  function clear(): void {
    lastSuccessAt = null
  }

  return { prompt, hasRecentSuccess, clear }
}
