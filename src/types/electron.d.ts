// Renderer-side type for the bridge that electron/preload.ts exposes
// via contextBridge. When the app is loaded in a regular browser
// (the Go-served SPA), `window.geode` is undefined and consumers
// should fall back to the web-native equivalent (window.open, etc.).
//
// Q4 / PSR-G07 (GitLab #93 + #84): the canonical interface lives in
// `electron/shared/bridge-types.ts`; this file is a thin re-export
// plus the Window augmentation. Keeping a single source ensures the
// preload and the renderer cannot drift out of sync silently.

import type { GeodeBridge } from '../../electron/shared/bridge-types'

export type {
  ConnectionRecord,
  GeodeBridge,
  ThemeVariant,
} from '../../electron/shared/bridge-types'

declare global {
  interface Window {
    geode?: GeodeBridge
  }
}

export {}
