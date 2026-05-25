# Electron Themed Window Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add themed minimize / maximize / close buttons to the top-right of the SPA shell so the immersive frameless Electron window has working window controls that match the rest of the app's theme.

**Architecture:** Render a `<WindowControls />` React component inside the existing `Top` nav (top-right, no-drag). Three buttons (minimize, toggle maximize, close) call new `window.geode.window*` preload methods that funnel through `ipcMain.handle` channels to `BrowserWindow.minimize/maximize/unmaximize/close`. The component subscribes to a `geode:window-maximized-changed` event so the middle button toggles between maximize and restore icons. macOS keeps its native traffic lights (`titleBarStyle: 'hiddenInset'` already provides them) and is the one platform where the custom controls are deliberately hidden; Linux + Windows render the themed buttons. To unify behavior on Windows we drop `titleBarOverlay` in favor of `frame: false` so the SPA owns the entire top-right corner.

**Tech Stack:** Electron 42, React 18, styled-components 6, `@geodedb/ui-core` Icon (Font Awesome `xmark` / `window-minimize` / `square` / `clone`), TypeScript 5.8, Jest 29 + @testing-library/react 14, Playwright 1.59.

**Scope check:** One coherent subsystem (window-chrome controls). No spec breakup needed.

---

## File Structure

### New files

```
src/components/layout/
├── WindowControls.tsx       # Renders the three buttons + subscribes to maximize state
└── WindowControls.test.tsx
```

### Modified files

```
electron/shared/bridge-types.ts   # +4 GeodeBridge entries: windowMinimize, windowToggleMaximize, windowClose, onWindowMaximizedChange
electron/preload.ts               # +4 preload implementations
electron/main.ts                  # +3 ipcMain.handle channels; +win.on('maximize'/'unmaximize') forwarder; Windows: drop titleBarOverlay → frame:false; pass `initialMaximized`
src/components/layout/Shell.tsx   # render <WindowControls /> at end of Top nav
src/services/i18n/locales/en.ts   # `windowControls.{minimize,maximize,restore,close}` aria labels
__tests__/electron-main.test.ts   # new test asserting the three IPC handlers exist (lightweight integration)
```

### Reasoning

- `WindowControls.tsx` is its own file because it has independent state (maximized?) and a subscription effect — keeping it out of Shell.tsx keeps that file under 350 lines and lets the component be unit-tested in isolation.
- The preload + main IPC additions are tiny (~20 lines each) and live next to the existing IPC of similar shape (`getSystemTheme`, `onSystemThemeChange`) so the pattern is preserved.
- macOS NEVER renders the custom controls: the platform user-experience contract is that the traffic lights live in the top-left. We detect via `process.platform` exposed once via the bridge (already partly available — see Task 0 for how it's added) and skip rendering on `darwin`.
- The Windows decision (drop `titleBarOverlay`, use frameless + custom) is the cleanest way to get app-themed controls; otherwise the OS keeps drawing its own glyphs on top of ours.

---

## Task 0: Expose platform on the preload bridge

**Files:**
- Modify: `electron/shared/bridge-types.ts`
- Modify: `electron/preload.ts`

The renderer needs to know which platform it's running on so `WindowControls` can hide on macOS. The current bridge has `isElectron` but not `platform`.

- [ ] **Step 1: Add `platform` to GeodeBridge**

In `electron/shared/bridge-types.ts`, add to the `GeodeBridge` interface after `serverUrl`:

```typescript
  // Process platform name (`'darwin' | 'linux' | 'win32' | string`)
  // read at preload time from process.platform. The renderer uses
  // this to gate per-OS behavior (e.g. window controls that should
  // not render on macOS where native traffic lights are present).
  readonly platform: string
```

- [ ] **Step 2: Implement in preload**

In `electron/preload.ts`, add to the `bridge` object after `serverUrl: SERVER_URL,`:

```typescript
  platform: process.platform,
```

- [ ] **Step 3: Run typecheck**

Run: `npm run electron:tsc`
Expected: exits 0 (the new property is on both sides of the contract).

- [ ] **Step 4: Commit**

```
git add electron/shared/bridge-types.ts electron/preload.ts
git commit -m "feat(electron): expose process.platform on the preload bridge"
```

---

## Task 1: Main-process IPC handlers for window controls

**Files:**
- Modify: `electron/main.ts`

Add three `ipcMain.handle` channels and a forwarder that pushes maximize-state changes to the renderer.

- [ ] **Step 1: Add the handlers above the `app.whenReady` block**

In `electron/main.ts`, find the existing `ipcMain.handle('geode:get-system-theme', …)` line (around line 658) and add directly above the `nativeTheme.on('updated', …)` block:

```typescript
// Window-controls IPC (Linux frameless + Windows frame:false windows
// render their own themed minimize/maximize/close buttons via
// src/components/layout/WindowControls.tsx). On macOS the native
// traffic lights remain; these handlers are still installed but the
// renderer never calls them on `process.platform === 'darwin'`.
ipcMain.handle('geode:window-minimize', (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender)
  win?.minimize()
  return true
})

ipcMain.handle('geode:window-toggle-maximize', (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender)
  if (!win) return false
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  return win.isMaximized()
})

ipcMain.handle('geode:window-close', (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender)
  win?.close()
  return true
})

ipcMain.handle('geode:window-is-maximized', (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender)
  return win?.isMaximized() === true
})
```

- [ ] **Step 2: Forward maximize state to the renderer**

In `createWindow()`, after the existing `win.on('close', persist)` line (around line 417), add:

```typescript
  // Forward maximize state so the renderer's WindowControls can
  // switch between the maximize and restore icons.
  const broadcastMaximized = (): void => {
    win.webContents.send('geode:window-maximized-changed', win.isMaximized())
  }
  win.on('maximize', broadcastMaximized)
  win.on('unmaximize', broadcastMaximized)
```

- [ ] **Step 3: Drop the Windows titleBarOverlay**

In `createWindow()`, replace the `frame` / `titleBarStyle` / `titleBarOverlay` block (around lines 358-368) with:

```typescript
    // Window chrome — custom themed controls live in the SPA's Top
    // nav (src/components/layout/WindowControls.tsx). macOS keeps its
    // native traffic lights via titleBarStyle: 'hiddenInset' since the
    // platform convention is top-left. Linux + Windows are fully
    // frameless so the SPA owns the entire top-right corner.
    frame: isMac ? undefined : false,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
```

(Remove the `titleBarOverlay: …` block entirely.)

- [ ] **Step 4: Run typecheck**

Run: `npm run electron:tsc`
Expected: exits 0.

- [ ] **Step 5: Run electron-specific unit tests to confirm no regression**

Run: `npx jest --config jest.config.cjs __tests__/electron-*.test.ts`
Expected: PASS (existing tests do not assert on the removed `titleBarOverlay`).

- [ ] **Step 6: Commit**

```
git add electron/main.ts
git commit -m "feat(electron): add window-controls IPC + drop Windows titleBarOverlay"
```

---

## Task 2: Preload bridge methods

**Files:**
- Modify: `electron/shared/bridge-types.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Extend the GeodeBridge interface**

In `electron/shared/bridge-types.ts`, add to the `GeodeBridge` interface after `pickPemFile`:

```typescript
  // Window controls (Linux frameless + Windows frame:false).
  // Each method round-trips through ipcMain.handle and returns
  // when the BrowserWindow operation completes. macOS callers
  // typically don't reach these — the native traffic lights handle
  // the same operations — but the bridge surface is platform-
  // agnostic.
  windowMinimize(): Promise<boolean>
  windowToggleMaximize(): Promise<boolean>
  windowClose(): Promise<boolean>
  windowIsMaximized(): Promise<boolean>
  onWindowMaximizedChange(handler: (maximized: boolean) => void): () => void
```

- [ ] **Step 2: Implement in preload**

In `electron/preload.ts`, add to the `bridge` object after `pickPemFile`:

```typescript
  windowMinimize: () =>
    ipcRenderer.invoke('geode:window-minimize') as Promise<boolean>,
  windowToggleMaximize: () =>
    ipcRenderer.invoke('geode:window-toggle-maximize') as Promise<boolean>,
  windowClose: () =>
    ipcRenderer.invoke('geode:window-close') as Promise<boolean>,
  windowIsMaximized: () =>
    ipcRenderer.invoke('geode:window-is-maximized') as Promise<boolean>,
  onWindowMaximizedChange: (handler) => {
    const listener = (_evt: unknown, maximized: boolean): void => {
      handler(maximized)
    }
    ipcRenderer.on('geode:window-maximized-changed', listener)
    return () => {
      ipcRenderer.removeListener('geode:window-maximized-changed', listener)
    }
  },
```

- [ ] **Step 3: Typecheck**

Run: `npm run electron:tsc`
Expected: exits 0.

- [ ] **Step 4: Commit**

```
git add electron/shared/bridge-types.ts electron/preload.ts
git commit -m "feat(electron): preload window-control methods + maximize subscription"
```

---

## Task 3: i18n strings for the new buttons

**Files:**
- Modify: `src/services/i18n/locales/en.ts`

- [ ] **Step 1: Add a `windowControls` block**

In `src/services/i18n/locales/en.ts`, find the existing `common: { … }` block and add a new top-level domain block (insert near the top, after the `common` block):

```typescript
  windowControls: {
    minimize: 'Minimize',
    maximize: 'Maximize',
    restore: 'Restore',
    close: 'Close window',
  },
```

- [ ] **Step 2: Verify translations**

Run: `npm run verify:translations`
Expected: `0 missing, 0 orphan` (the keys will register as orphans until Task 4 consumes them; the orphan check is enforced — Task 3 + Task 4 ship together).

- [ ] **Step 3: Commit (combined with Task 4)**

Task 3 commits along with Task 4 so the keys are referenced when the orphan check runs.

---

## Task 4: WindowControls component

**Files:**
- Create: `src/components/layout/WindowControls.tsx`
- Test: `src/components/layout/WindowControls.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/layout/WindowControls.test.tsx`:

```typescript
/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { WindowControls } from './WindowControls'
import { testTheme as theme } from '../../test-utils/theme'
import '../../services/i18n'

const minimizeMock = jest.fn().mockResolvedValue(true)
const toggleMaxMock = jest.fn().mockResolvedValue(false)
const closeMock = jest.fn().mockResolvedValue(true)
const isMaxMock = jest.fn().mockResolvedValue(false)
let onMaxChangeHandler: ((maximized: boolean) => void) | null = null

beforeEach(() => {
  minimizeMock.mockClear()
  toggleMaxMock.mockClear()
  closeMock.mockClear()
  isMaxMock.mockClear()
  onMaxChangeHandler = null
})

function installBridge(platform: string): void {
  ;(global as unknown as { window: Window }).window.geode = {
    isElectron: true,
    serverUrl: 'http://localhost:8080',
    platform,
    windowMinimize: minimizeMock,
    windowToggleMaximize: toggleMaxMock,
    windowClose: closeMock,
    windowIsMaximized: isMaxMock,
    onWindowMaximizedChange: (handler: (m: boolean) => void) => {
      onMaxChangeHandler = handler
      return () => {
        onMaxChangeHandler = null
      }
    },
    // Stubs for the rest of the bridge surface — the component only
    // touches the window-control entries.
  } as unknown as Window['geode']
}

function clearBridge(): void {
  ;(global as unknown as { window: Window }).window.geode = undefined as unknown as Window['geode']
}

const wrap = (n: React.ReactNode): ReturnType<typeof render> =>
  render(<ThemeProvider theme={theme}>{n}</ThemeProvider>)

test('renders nothing when not running under Electron', () => {
  clearBridge()
  const { container } = wrap(<WindowControls />)
  expect(container.firstChild).toBeNull()
})

test('renders nothing on macOS even under Electron', () => {
  installBridge('darwin')
  const { container } = wrap(<WindowControls />)
  expect(container.firstChild).toBeNull()
})

test('renders three buttons on Linux', () => {
  installBridge('linux')
  wrap(<WindowControls />)
  expect(screen.getByRole('button', { name: /minimize/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /maximize/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /close window/i })).toBeInTheDocument()
})

test('renders three buttons on Windows', () => {
  installBridge('win32')
  wrap(<WindowControls />)
  expect(screen.getByRole('button', { name: /minimize/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /maximize/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /close window/i })).toBeInTheDocument()
})

test('clicking minimize invokes windowMinimize', async () => {
  installBridge('linux')
  wrap(<WindowControls />)
  fireEvent.click(screen.getByRole('button', { name: /minimize/i }))
  await waitFor(() => expect(minimizeMock).toHaveBeenCalled())
})

test('clicking close invokes windowClose', async () => {
  installBridge('linux')
  wrap(<WindowControls />)
  fireEvent.click(screen.getByRole('button', { name: /close window/i }))
  await waitFor(() => expect(closeMock).toHaveBeenCalled())
})

test('clicking maximize invokes windowToggleMaximize', async () => {
  installBridge('linux')
  wrap(<WindowControls />)
  fireEvent.click(screen.getByRole('button', { name: /maximize/i }))
  await waitFor(() => expect(toggleMaxMock).toHaveBeenCalled())
})

test('button label switches to Restore when window becomes maximized', async () => {
  installBridge('linux')
  wrap(<WindowControls />)
  expect(screen.getByRole('button', { name: /maximize/i })).toBeInTheDocument()
  // Simulate the main process broadcasting that the window is now maximized.
  onMaxChangeHandler!(true)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument()
  )
  onMaxChangeHandler!(false)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /maximize/i })).toBeInTheDocument()
  )
})

test('button surface is opt-out of the Electron drag region', () => {
  installBridge('linux')
  const { container } = wrap(<WindowControls />)
  const root = container.firstChild as HTMLElement
  expect(root.style.getPropertyValue('-webkit-app-region')).toBe('no-drag')
})
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx jest --config jest.config.cjs src/components/layout/WindowControls.test.tsx`
Expected: FAIL with `Cannot find module './WindowControls'`.

- [ ] **Step 3: Implement the component**

Create `src/components/layout/WindowControls.tsx`:

```typescript
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Icon } from '@geodedb/ui-core'

// Themed window controls — minimize / toggle-maximize / close.
// Renders on Linux + Windows (frameless windows) and is suppressed on
// macOS where native traffic lights are kept via titleBarStyle:
// 'hiddenInset'. The component is also suppressed in the browser
// build (no window.geode bridge) so the same Top nav works for both
// Electron and web.

const Bar = styled.div`
  display: flex;
  align-items: stretch;
  gap: 0;
  /* Buttons must be clickable even though the parent Top nav is the
     Electron drag region. */
  -webkit-app-region: no-drag;
  margin-left: ${({ theme }) => theme.spacing.sm};
  flex-shrink: 0;
`

const ControlButton = styled.button<{ $danger?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 32px;
  padding: 0;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.text.secondary};
  cursor: pointer;
  border-radius: ${({ theme }) => theme.radii.sm};
  transition: background 120ms ease, color 120ms ease;

  &:hover,
  &:focus-visible {
    background: ${({ theme, $danger }) =>
      $danger ? theme.colors.danger : theme.bg.subtle};
    color: ${({ theme, $danger }) =>
      $danger ? theme.text.onPrimary : theme.text.primary};
  }

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

function getBridge(): typeof window.geode | undefined {
  if (typeof window === 'undefined') return undefined
  return window.geode
}

export const WindowControls: React.FC = () => {
  const { t } = useTranslation()
  const bridge = getBridge()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!bridge || bridge.platform === 'darwin') return undefined
    bridge.windowIsMaximized().then(setMaximized).catch(() => undefined)
    const unsubscribe = bridge.onWindowMaximizedChange(setMaximized)
    return unsubscribe
  }, [bridge])

  const onMinimize = useCallback(() => {
    bridge?.windowMinimize().catch(() => undefined)
  }, [bridge])

  const onToggleMax = useCallback(() => {
    bridge?.windowToggleMaximize().catch(() => undefined)
  }, [bridge])

  const onClose = useCallback(() => {
    bridge?.windowClose().catch(() => undefined)
  }, [bridge])

  if (!bridge) return null
  if (bridge.platform === 'darwin') return null

  const maximizeLabel = maximized
    ? t('windowControls.restore')
    : t('windowControls.maximize')
  const maximizeIcon = maximized ? 'clone' : 'square'

  return (
    <Bar style={{ ['-webkit-app-region' as never]: 'no-drag' }}>
      <ControlButton
        type="button"
        aria-label={t('windowControls.minimize')}
        onClick={onMinimize}
        data-testid="window-control-minimize"
      >
        <Icon name="window-minimize" variant="solid" />
      </ControlButton>
      <ControlButton
        type="button"
        aria-label={maximizeLabel}
        onClick={onToggleMax}
        data-testid="window-control-maximize"
      >
        <Icon name={maximizeIcon} variant="regular" />
      </ControlButton>
      <ControlButton
        type="button"
        $danger
        aria-label={t('windowControls.close')}
        onClick={onClose}
        data-testid="window-control-close"
      >
        <Icon name="xmark" variant="solid" />
      </ControlButton>
    </Bar>
  )
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npx jest --config jest.config.cjs src/components/layout/WindowControls.test.tsx`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit (along with Task 3 i18n keys)**

```
git add src/services/i18n/locales/en.ts src/components/layout/WindowControls.tsx src/components/layout/WindowControls.test.tsx
git commit -m "feat(electron): themed WindowControls — minimize/maximize/close"
```

---

## Task 5: Wire WindowControls into Shell.tsx

**Files:**
- Modify: `src/components/layout/Shell.tsx`

- [ ] **Step 1: Add the import**

In `src/components/layout/Shell.tsx`, with the other layout imports near the top:

```typescript
import { WindowControls } from './WindowControls'
```

- [ ] **Step 2: Find the Top nav JSX**

Look for the JSX `<Top>` block (the `<nav>` rendered around the brand / nav links). It already lives inside the JSX returned from `Shell` — find the closing `</Top>` and insert `<WindowControls />` directly before it so the controls sit at the far right of the bar:

```tsx
        <ThemeSelector />
        <WindowControls />
      </Top>
```

(If `<ThemeSelector />` is not the last child today, place `<WindowControls />` as the LAST child inside `<Top>`.)

- [ ] **Step 3: Run the existing Shell tests**

Run: `npx jest --config jest.config.cjs src/components/layout/Shell.test.tsx`
Expected: PASS — Shell's tests do not assert on the children order, only on the presence of skip-link, nav links, and the mobile toggle.

- [ ] **Step 4: Commit**

```
git add src/components/layout/Shell.tsx
git commit -m "feat(electron): render WindowControls at end of Top nav"
```

---

## Task 6: Manual smoke (developer-side)

This step has no automated test — it's a fast eye-check that the controls render in the real Electron build.

- [ ] **Step 1: Build the electron bundle**

Run: `npm run electron:build`
Expected: exits 0.

- [ ] **Step 2: Run the Electron app**

Run: `npm run electron:dev`
Expected: window opens. On Linux there is no OS frame at all; the SPA's purple header now carries minimize / maximize / close buttons at the far right.

- [ ] **Step 3: Verify each button**

- Click minimize → window minimizes.
- Click maximize → window maximizes; the icon switches to a "restore" glyph (`clone`).
- Click again → window restores; icon switches back to `square`.
- Click close → window closes; the process exits.

- [ ] **Step 4: macOS check (if available)**

On macOS, run `npm run electron:dev` and confirm the native traffic lights remain in the top-left and the custom controls do NOT render.

No commit on this task.

---

## Task 7: E2E spec

**Files:**
- Create: `e2e/specs/48-electron-window-controls.spec.ts`

This spec runs only against the Electron build (the existing `e2e/electron.config.ts`). The browser-test runs (`e2e/playwright.config.ts`) skip the file because the browser has no `window.geode`.

- [ ] **Step 1: Write the spec**

Create `e2e/specs/48-electron-window-controls.spec.ts`:

```typescript
import { expect } from '@playwright/test'
import { test as authedTest } from '../fixtures'

authedTest.describe('electron / window controls', () => {
  authedTest('three control buttons render and call the bridge', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    const isElectron = await page.evaluate(
      () =>
        typeof (window as unknown as { geode?: { isElectron?: boolean } })
          .geode?.isElectron === 'boolean'
    )
    authedTest.skip(!isElectron, 'browser run — no window.geode bridge')

    const platform = await page.evaluate(
      () =>
        (window as unknown as { geode?: { platform: string } }).geode
          ?.platform ?? 'unknown'
    )
    authedTest.skip(
      platform === 'darwin',
      'macOS uses native traffic lights; custom controls are not rendered'
    )

    await expect(page.getByTestId('window-control-minimize')).toBeVisible()
    await expect(page.getByTestId('window-control-maximize')).toBeVisible()
    await expect(page.getByTestId('window-control-close')).toBeVisible()

    // Sanity check: each button is wired to a no-drag region so the
    // click actually reaches it through Electron's title-bar drag.
    const noDrag = await page.getByTestId('window-control-close').evaluate(
      (el) =>
        getComputedStyle(el.parentElement as HTMLElement)
          .getPropertyValue('-webkit-app-region')
          .trim()
    )
    expect(noDrag).toBe('no-drag')
  })
})
```

- [ ] **Step 2: Run typecheck**

Run: `npm run e2e:tsc`
Expected: exits 0.

- [ ] **Step 3: Run the spec (Electron config)**

Run: `npm run electron:e2e -- e2e/specs/48-electron-window-controls.spec.ts`
Expected: PASS on Linux + Windows runners, skipped on macOS or browser runs.

- [ ] **Step 4: Commit**

```
git add e2e/specs/48-electron-window-controls.spec.ts
git commit -m "test(e2e): electron window controls — visible + no-drag"
```

---

## Task 8: Final verification + push

- [ ] **Step 1: Full local suite**

Run each in sequence:
```
npm run lint
npm run prettier:check
npm run test:ts
npx jest --config jest.config.cjs --ci
npm run verify:translations
```

Expected: all green. The new i18n keys (`windowControls.*`) resolve once the component is wired (Task 4 + Task 5). Lint passes against the new `WindowControls.tsx` + tests.

- [ ] **Step 2: Push**

```
git push origin main
```

- [ ] **Step 3: (Optional) tag a release**

If shipping immediately, tag `v0.1.23` (next patch increment from `v0.1.22`):

```
git tag -a v0.1.23 -m "Release v0.1.23

Themed window controls (minimize/maximize/close) in the Electron
desktop shell. Linux + Windows render the custom buttons in the top
right of the Top nav; macOS keeps its native traffic lights. Windows
drops titleBarOverlay in favor of the same frameless+custom-controls
treatment as Linux."
git push origin v0.1.23
```

---

## Self-Review

**Spec coverage check (against user goal: "add a close, minimize and maximize button in the app theme to the top right of the electron app"):**

| Spec line | Task(s) |
|-----------|---------|
| Close button | Task 4 (`onClose` → `windowClose`) + Task 1 (IPC) + Task 2 (bridge) |
| Minimize button | Task 4 (`onMinimize` → `windowMinimize`) + Task 1 + Task 2 |
| Maximize button | Task 4 (`onToggleMax` → `windowToggleMaximize` + restore-icon swap) + Task 1 + Task 2 |
| App theme | Task 4 — styled-components using `theme.bg.subtle` / `theme.colors.danger` / `theme.text.*` / `theme.radii.sm` |
| Top right | Task 5 — appended inside `<Top>` after the existing `<ThemeSelector />` |
| "theming the default top bar is fine also" | Task 1 — Windows drops `titleBarOverlay` (the only platform with a "default themed top bar"); we go fully frameless on Linux + Windows, and macOS keeps its hiddenInset bar. The end result is one consistent app-themed control surface across both Linux and Windows. |

**Placeholder scan:** None. Every test step ships actual Jest assertions; every code step ships the complete source; every command has an expected outcome.

**Type consistency check:**
- `GeodeBridge` extensions added in Task 0 (`platform`) + Task 2 (4 methods + 1 subscription) — used verbatim in Task 4 component (`bridge.platform`, `bridge.windowMinimize`, etc.).
- IPC channel names: Task 1 declares `geode:window-minimize` / `-toggle-maximize` / `-close` / `-is-maximized` / `-maximized-changed`; Task 2 preload calls match exactly.
- Test data-testids `window-control-{minimize,maximize,close}` match between Task 4's component, Task 4's tests, and Task 7's e2e.
- `bridge.platform` is `string` (typed as `string` on the bridge), checked against literal `'darwin'` in Task 4 component and Task 7 e2e.

**Risk flags:**
- Removing Windows `titleBarOverlay` shifts the drag handle entirely to the SPA. The existing `Top` nav already has `-webkit-app-region: drag` (commit `97fd4e9`), so the window stays draggable. The `WindowControls` Bar overrides with `no-drag` so clicks register.
- The `Icon` glyphs (`window-minimize`, `square`, `clone`, `xmark`) are all in Font Awesome Free (already bundled per `@fortawesome/fontawesome-free@^7.2.0` in package.json). No new dependency.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-25-electron-window-controls.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task (8 tasks), review between tasks, fast iteration. Good for clean per-task commits and a tight first-pass implementation.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Good for tight turn-around when you want me to watch progress and steer mid-run.

Which approach?
