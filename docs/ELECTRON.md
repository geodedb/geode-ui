# Geode UI — Electron desktop build

This is the Phase 5 deliverable from `docs/UI_AUDIT.md`. Geode UI now
ships as both a Go-served SPA (`internal/ui/dist/index.html`, embedded
into the `cmd/server` binary) and a packaged desktop application built
with [Electron](https://www.electronjs.org/) and
[electron-builder](https://www.electron.build/).

The same React tree powers both. The Electron renderer loads the
existing SPA bundle through a custom `geode://app/` privileged
protocol — there is no second build of the React tree, no second CSP,
and no second auth flow.

## Layout

```text
electron/
  main.ts        # Electron main process: BrowserWindow, menu, protocol
  preload.ts     # contextBridge surface: window.geode.{getVersion,…}
  tsconfig.json  # CommonJS Node16 build that emits to electron-dist/
electron-builder.yml
                 # Mac / Windows / Linux packaging config
src/types/electron.d.ts
                 # Renderer-side type for window.geode (optional)
```

## Architecture

### Main process (`electron/main.ts`)

- Registers a privileged scheme `geode://` so renderer code receives
  `secure: true`, `standard: true`, `supportFetchAPI: true`. This
  removes the need to relax CSP for `file://` (which has its own
  footguns: localStorage scoped per-path, fetch() to relative paths
  broken).
- Maps `geode://app/<path>` to `internal/ui/dist/<path>` via
  `protocol.handle`. SPA fallback: any unknown path returns
  `index.html` so client-side routes survive a hard reload.
- Path-traversal hardening: any request whose resolved path leaves
  the dist directory returns 403.
- Persists window position + size + maximized state to
  `<userData>/window-state.json` so the app reopens at the same
  dimensions.
- Forces external links (any URL outside `geode://`) into the OS
  default browser via `shell.openExternal`. `<a target="_blank">`
  cannot spawn another Electron window.
- Exposes a small IPC surface: `geode:get-version`,
  `geode:open-external`, `geode:get-system-theme`. The system-theme
  channel also pushes `geode:system-theme-changed` events when the OS
  theme flips, so the renderer's `ThemeProvider` can react in real
  time without polling.
- Application menu: standard mac/win/linux roles plus a "Help → Geode
  documentation" item that opens `https://geodedb.com/docs/`.

### Preload (`electron/preload.ts`)

- Runs with `contextIsolation: true` and `sandbox: true`. Cannot
  reach Node directly.
- Exposes `window.geode` via `contextBridge.exposeInMainWorld`. The
  surface is intentionally tiny:

  ```ts
  interface GeodeBridge {
    isElectron: true
    getVersion(): Promise<string>
    openExternal(url: string): Promise<boolean>      // https / mailto only
    getSystemTheme(): Promise<'light' | 'dark'>
    onSystemThemeChange(handler): () => void
  }
  ```

- The renderer detects Electron at runtime via `window.geode?.isElectron`
  and falls back to web-native equivalents (`window.open`,
  `window.matchMedia('(prefers-color-scheme: dark)')`) when running
  in a browser tab.

### Renderer (no source-level changes required)

The SPA does not need code changes to run under Electron. The brand
fonts are self-hosted (Phase 1), the styled-components theme already
honors `prefers-color-scheme` (Phase 1), and the responsiveness work
(Phase 3) means the desktop window can shrink to laptop / iPad-Mini
dimensions without breaking layouts.

For Electron-specific niceties (e.g., open external links via
`window.geode.openExternal` so the user's browser handles them), feature-detect:

```tsx
const openExternal = (url: string) => {
  if (window.geode?.isElectron) {
    void window.geode.openExternal(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
```

## Building locally

```bash
# 1. Install electron + electron-builder (devDependencies — see below)
pnpm add -D electron electron-builder

# 2. Build the SPA bundle (produces internal/ui/dist/)
pnpm build

# 3. Compile the electron main + preload to internal/ui/electron-dist/
pnpm electron:tsc

# 4. Combined build (SPA + main + preload) and launch a dev window
pnpm electron:dev

# 5. Produce a distributable .dmg / .AppImage / .exe under release/
pnpm electron:package
```

The Electron CLI is intentionally **not** added to `dependencies` /
`devDependencies` in this commit — Phase 5 ships the integration code
and packaging config, but leaves the heavy native build dep for the
release engineer to pull in when they're ready to publish a desktop
build. To enable locally:

```bash
pnpm add -D electron@^32 electron-builder@^25 @types/node
```

After that, all four `pnpm electron:*` scripts in `package.json` work.

## Security baseline

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- No `<webview>` tags.
- `setWindowOpenHandler` denies every opener and routes the URL to
  `shell.openExternal`.
- `will-navigate` blocks navigation outside the `geode://` origin.
- The SPA's existing CSP (`internal/server/security_headers.go`) does
  not need to relax for Electron — the privileged protocol scheme
  enables the same `'self'` semantics the browser sees.
- IPC handlers are explicit and validate input. `geode:open-external`
  whitelists `https:` and `mailto:` — file:// or custom schemes
  cannot be launched.

## Out of scope (this commit)

- Auto-updater. `electron-updater` integration would land in a follow-
  up; the `publish.provider: generic` block in `electron-builder.yml`
  positions us for it.
- Code signing / notarization. The `mac.hardenedRuntime: true` flag is
  set, but the actual signing certificates live in the release
  pipeline, not in source.
- App icons. Placeholders documented in `electron-builder.yml`. Drop a
  512×512 PNG into `build/icon.png` and `electron-builder` will build
  the .icns / .ico variants automatically.
