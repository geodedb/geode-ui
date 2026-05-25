// Q4 / PSR-G07 (GitLab #93 + #84): structural pin for the dedup of
// `ConnectionRecord` / `GeodeBridge` between `electron/preload.ts`
// and `src/types/electron.d.ts`.
//
// Pre-fix the two files declared the interfaces verbatim. A future
// drift (preload exposes a method the renderer doesn't know about, or
// vice versa) would compile cleanly and fail at runtime — there was
// no mechanical guard.
//
// Post-fix both sides re-export from `electron/shared/bridge-types`.
// This test exercises both import paths and asserts they refer to the
// same shape via a TypeScript-level mutual-assignability check
// (variables typed from both sides cross-assign without error).

import type {
  ConnectionRecord as RendererConnectionRecord,
  GeodeBridge as RendererGeodeBridge,
} from '../types/electron'
import type {
  ConnectionRecord as SharedConnectionRecord,
  GeodeBridge as SharedGeodeBridge,
} from '../../electron/shared/bridge-types'

describe('GAP-Q4 / GAP-PSR-G07: bridge types are re-exported from a single source', () => {
  test('renderer ConnectionRecord is structurally identical to the shared one', () => {
    const fromShared: SharedConnectionRecord = {
      connectionId: 'cid',
      token: 'tok',
      profileName: 'default',
      expiresAt: 1,
    }
    // Compile-time assignability is the actual assertion. The
    // runtime check below is just to anchor the test execution.
    const fromRenderer: RendererConnectionRecord = fromShared
    expect(fromRenderer.connectionId).toBe('cid')

    const reverse: SharedConnectionRecord = fromRenderer
    expect(reverse.token).toBe('tok')
  })

  test('renderer GeodeBridge is structurally identical to the shared one', () => {
    // Allocate a stub satisfying the shared interface, then prove it
    // satisfies the renderer interface. If a future commit adds a
    // method on one side and not the other, this assignment fails
    // tsc on the test file even though the call sites compile.
    const stub: SharedGeodeBridge = {
      isElectron: true,
      serverUrl: 'http://localhost:8080',
      platform: 'linux',
      getVersion: async () => 'v',
      openExternal: async () => true,
      getSystemTheme: async () => 'light',
      onSystemThemeChange: () => () => undefined,
      getStoredConnections: async () => [],
      storeConnections: async () => true,
      // APP-01 R2: unlock-token gate. The stub satisfies the bridge
      // contract; runtime behaviour is irrelevant for the structural
      // assertion this test enforces.
      openUnlockWindow: async () => 'stub-token',
      // APP-01 R3: biometric pref read/write. Same stub pattern.
      getSavedPasswordBiometricPref: async () => false,
      setSavedPasswordBiometricPref: async () => true,
      getStoredPassword: async () => null,
      storeSavedPassword: async () => true,
      clearStoredPassword: async () => true,
      pickPemFile: async () => null,
    }
    const asRenderer: RendererGeodeBridge = stub
    expect(asRenderer.isElectron).toBe(true)

    const reverse: SharedGeodeBridge = asRenderer
    expect(typeof reverse.getVersion).toBe('function')
  })
})
