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

## Content-Security-Policy under the `geode://` origin

Closes GAP-010.

The SPA's CSP is emitted on HTML responses by
`internal/server/security_headers.go:51` and reads:

```text
default-src 'self';
script-src  'self' 'wasm-unsafe-eval';
style-src   'self' 'unsafe-inline';
worker-src  'self' blob:;
connect-src 'self' wss:;
img-src     'self' data:;
font-src    'self' data:;
frame-ancestors 'none';
base-uri 'none';
form-action 'self';
object-src 'none'
```

Under Electron, the SPA loads from `geode://app/index.html`. Chromium
resolves `'self'` to the **origin of the document** — `geode://app` —
not to a synthesised "Electron" pseudo-origin. Each directive
behaves as follows:

| Directive | Behaviour at `geode://app` |
|---|---|
| `script-src 'self'` | All bundle JS comes from `geode://app/*.js`; same-origin → allowed. |
| `script-src 'wasm-unsafe-eval'` | Required by Monaco's tokenizer; tied to the Chromium feature, not the origin. Works under Electron unchanged. |
| `style-src 'self'` | The minified CSS chunks load from `geode://app/*.css`; same-origin → allowed. |
| `style-src 'unsafe-inline'` | styled-components injects inline `<style>` per render; orthogonal to origin. |
| `worker-src 'self' blob:` | Monaco's worker bootstraps from a `blob:` URL on first edit; allowed. |
| `connect-src 'self' wss:` | The `/ws/query` upgrade goes to a backend server, not back to `geode://`. **In packaged builds the renderer must be configured to target the operator-supplied API origin**, otherwise `'self'` (which is `geode://app`) blocks the WS handshake. |
| `img-src 'self' data:` | Icons, logos, favicons all live under `geode://app/`. |
| `font-src 'self' data:` | Six brand woff2 files are served from `geode://app/<hash>.woff2` via `webpack`'s asset/resource loader. No CDN; Electron's offline-first posture is preserved. |
| `frame-ancestors 'none'` | Chromium honors this even under custom protocols. The packaged window is the only legitimate frame container. |

**Net:** the existing CSP works unchanged under `geode://`, except for
the `connect-src` boundary — that's an operator-configuration concern
(the API URL must be set at build/runtime), not a CSP wording problem.
The tightening opportunity in the desktop build is `script-src` —
Monaco doesn't need `'wasm-unsafe-eval'` once the bundled tokenizer is
swapped for a JS-only path. Tracked separately as a release-engineering
follow-up.

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
