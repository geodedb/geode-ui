// APP-01 R3 (2026-05-24 appsec): pure-function tests for the OS-native
// re-auth wrapper. The wrapper lives in `electron/lib/biometric.ts`
// and gates `geode:get-stored-password` when the user opts in via the
// `savedPasswordRequireBiometric` preference.
//
// Per the planner spec:
//   - macOS: uses `systemPreferences.canPromptTouchID()` +
//     `promptTouchID('Unlock saved password')`. A rejected prompt
//     returns `false` (fail-closed).
//   - Windows: fail-closed stub returning `false` until Hello is
//     wired (follow-up).
//   - Linux: fail-closed stub returning `false` until polkit/pkexec
//     is wired (follow-up).
//
// The wrapper is platform-detected via an injectable `platform` to
// keep these unit tests deterministic.

import {
  createBiometricGate,
  type BiometricDeps,
} from '../electron/lib/biometric'

function deps(overrides: Partial<BiometricDeps> = {}): BiometricDeps {
  return {
    platform: 'linux',
    canPromptTouchID: () => false,
    promptTouchID: async () => {
      throw new Error('not wired in this fake')
    },
    ...overrides,
  }
}

describe('createBiometricGate (APP-01 R3)', () => {
  test('macOS: prompt succeeds → returns true', async () => {
    const gate = createBiometricGate(
      deps({
        platform: 'darwin',
        canPromptTouchID: () => true,
        promptTouchID: async () => undefined,
      })
    )
    await expect(gate.prompt('Unlock saved password')).resolves.toBe(true)
  })

  test('macOS: prompt rejects → returns false (fail-closed)', async () => {
    const gate = createBiometricGate(
      deps({
        platform: 'darwin',
        canPromptTouchID: () => true,
        promptTouchID: async () => {
          throw new Error('user-cancelled')
        },
      })
    )
    await expect(gate.prompt('Unlock saved password')).resolves.toBe(false)
  })

  test('macOS: canPromptTouchID returns false → fail-closed', async () => {
    const gate = createBiometricGate(
      deps({
        platform: 'darwin',
        canPromptTouchID: () => false,
        promptTouchID: async () => undefined, // would succeed if called
      })
    )
    await expect(gate.prompt('Unlock saved password')).resolves.toBe(false)
  })

  test('windows: fail-closed stub returns false', async () => {
    const gate = createBiometricGate(deps({ platform: 'win32' }))
    await expect(gate.prompt('Unlock saved password')).resolves.toBe(false)
  })

  test('linux: fail-closed stub returns false', async () => {
    const gate = createBiometricGate(deps({ platform: 'linux' }))
    await expect(gate.prompt('Unlock saved password')).resolves.toBe(false)
  })

  test('unknown platform: fail-closed', async () => {
    const gate = createBiometricGate(
      deps({ platform: 'aix' as unknown as NodeJS.Platform })
    )
    await expect(gate.prompt('Unlock saved password')).resolves.toBe(false)
  })

  test('recent-success cache: a successful prompt suppresses the gate for the configured window', async () => {
    let promptCount = 0
    let fakeNow = 1_000_000
    const gate = createBiometricGate(
      deps({
        platform: 'darwin',
        canPromptTouchID: () => true,
        promptTouchID: async () => {
          promptCount += 1
        },
        recentWindowMs: 60_000,
        now: () => fakeNow,
      })
    )
    await expect(gate.prompt('First')).resolves.toBe(true)
    expect(promptCount).toBe(1)
    // hasRecentSuccess() reports true within the window.
    expect(gate.hasRecentSuccess()).toBe(true)
    fakeNow += 59_999
    expect(gate.hasRecentSuccess()).toBe(true)
    fakeNow += 2
    expect(gate.hasRecentSuccess()).toBe(false)
  })

  test('clear() drops the recent-success state', async () => {
    const fakeNow = 1_000_000
    const gate = createBiometricGate(
      deps({
        platform: 'darwin',
        canPromptTouchID: () => true,
        promptTouchID: async () => undefined,
        now: () => fakeNow,
        recentWindowMs: 60_000,
      })
    )
    await gate.prompt('First')
    expect(gate.hasRecentSuccess()).toBe(true)
    gate.clear()
    expect(gate.hasRecentSuccess()).toBe(false)
  })
})
