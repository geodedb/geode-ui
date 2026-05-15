# Web Awesome Foundation + Toolbar Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Web Awesome 3.7.0, wire its CSS-variable theming to our existing styled-components theme tokens, and migrate the GraphToolbar's buttons as a proof-of-concept spike — establishing the migration pattern for future area-by-area plans.

**Architecture:** Web Awesome ships as web components (custom elements) with shadow DOM and CSS custom-property theming. The theme bridge writes our `theme/light.ts` / `theme/dark.ts` tokens into a `:root { --wa-* }` block so WA components inherit the project's visual identity automatically. The spike migrates a single surface (GraphToolbar) end-to-end so we discover real friction (shadow-DOM styling boundaries, jest custom-element handling, React 18 prop/attribute reflection) before committing to broader migration.

**Tech Stack:** React 18.2, TypeScript, `@awesome.me/webawesome@3.7.0` (web components via Lit), styled-components 6 (existing — stays for layout), Jest + Testing Library + jsdom, Playwright (e2e), webpack 5, Electron 42, react-i18next.

**Explicitly out of scope:**
- Migrating other surfaces (login, profiles, dashboard, admin, schema explorer, inspector, popovers) — those land in follow-up plans once the pattern is proven.
- React 19 upgrade — defer to its own plan; the spike works fine on React 18 for buttons (no custom-event pain).
- Web Awesome Pro components — use free-tier only.
- Autoloader — we use explicit per-component imports for smaller bundle + clearer dependency graph.

---

## File Structure

**New files:**
- `src/types/awesome-webawesome.d.ts` — ambient declarations for `@awesome.me/webawesome` JSX intrinsic elements (`wa-button`, etc.) so TypeScript accepts custom-element tags in TSX.
- `src/services/webawesome/index.ts` — central register-on-import module. The spike imports only `wa-button` here. Future migrations append more imports.
- `src/services/webawesome/theme-bridge.ts` — generates a `:root` CSS string from our styled-components theme tokens, mapping to WA's `--wa-color-*` / `--wa-font-*` / `--wa-radius-*` variables.
- `src/services/webawesome/theme-bridge.test.ts` — unit tests for the bridge output.
- `src/services/webawesome/ThemeStyleSheet.tsx` — small React component that injects the bridge output as a `<style>` tag in `<head>` and updates it when the theme variant flips.
- `src/services/webawesome/ThemeStyleSheet.test.tsx` — tests.
- `docs/web-awesome-migration.md` — short migration playbook for follow-up plans (which component types are safe to migrate on React 18, where shadow DOM bites, jest test patterns).

**Modified files:**
- `package.json` / `package-lock.json` — add `@awesome.me/webawesome@^3.7.0`.
- `src/App.tsx` (or whichever component is the app shell — find it; likely `src/components/Shell.tsx` or similar) — mount `<ThemeStyleSheet />` once near the root.
- `src/components/results/graph/GraphToolbar.tsx` — replace `<button>` elements with `<wa-button>`; preserve all `data-testid`, `aria-label`, `title`, `aria-pressed`, `onClick` attributes; convert the "pressed" visual via `appearance="filled"`/`appearance="outlined"`.
- `src/components/results/graph/GraphToolbar.test.tsx` (or wherever the toolbar's tests live — check first; may not exist as a dedicated file, in which case the toolbar's coverage is via `GraphView.test.tsx` and the existing e2e specs).
- `jest.config.cjs` — add a `customExportConditions` entry so Jest resolves `@lit/react` and Lit's package exports correctly; add `moduleNameMapper` for the WA CSS import if jest's default CSS stub doesn't catch it.
- `webpack.config.js` (or the project's webpack config — find it) — ensure no externalization of WA; the package ships ESM and webpack 5 handles it natively, so usually no config change is needed. Verify by running `npm run build`.

**Untouched (deliberate):**
- Existing GraphToolbar layout shell (`Toolbar` styled-component) keeps its grid/flex — only the `<button>` children change.
- All other UI surfaces — those are in scope for follow-up plans.
- The Cytoscape integration — unaffected by button styling.

---

## Phase 1 — Foundation

### Task 1: Install `@awesome.me/webawesome` + ambient types

**Files:**
- Modify: `package.json` / `package-lock.json`
- Create: `src/types/awesome-webawesome.d.ts`

- [ ] **Step 1: Install**

```bash
npm install @awesome.me/webawesome@^3.7.0
```

Expected: dep added under `dependencies`; transitive deps include `lit`, `@lit/react`, `@floating-ui/dom`. Peer warnings absent.

- [ ] **Step 2: Add ambient JSX declarations for the elements we use in the spike**

Create `src/types/awesome-webawesome.d.ts`:

```ts
// Web Awesome ships its components as custom elements (web components).
// TypeScript's JSX intrinsic-element catalogue doesn't know about them
// out of the box. This file declares the specific tags we use so TSX
// authors can write <wa-button> without a TS error.
//
// As more components are adopted in follow-up migration plans, add
// their tag names + prop shapes here. Keep prop types loose (any
// HTML attribute, plus the WA-specific ones we actually use) — the
// upstream package exports stronger types via @awesome.me/webawesome
// but they require React 19 wrappers. We're React 18.

import type { HTMLAttributes, MouseEventHandler, ReactNode } from 'react'

type WaButtonProps = HTMLAttributes<HTMLElement> & {
  appearance?: 'filled' | 'outlined' | 'plain'
  size?: 'small' | 'medium' | 'large'
  variant?: 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'neutral'
  disabled?: boolean
  loading?: boolean
  pill?: boolean
  // aria-pressed is already accepted as an aria-* prop by HTMLAttributes,
  // but listing it here makes the toggle pattern more discoverable.
  'aria-pressed'?: boolean | 'true' | 'false'
  onClick?: MouseEventHandler<HTMLElement>
  children?: ReactNode
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'wa-button': WaButtonProps
    }
  }
}

export {}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean. The custom-element tags don't appear anywhere yet, so the declaration is just available for future consumers.

Run: `npm run build`
Expected: webpack succeeds. No new bundles are produced because nothing imports WA yet.

Run: `npm test`
Expected: ALL pass (no consumer yet; install is a no-op for the test surface).

If jest OOMs, set `NODE_OPTIONS='--max-old-space-size=4096'`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/types/awesome-webawesome.d.ts
git commit -m "build(ui): add @awesome.me/webawesome with ambient JSX types"
```

### Task 2: Theme bridge (styled-components tokens → `--wa-*` CSS vars)

**Files:**
- Create: `src/services/webawesome/theme-bridge.ts`
- Create: `src/services/webawesome/theme-bridge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/webawesome/theme-bridge.test.ts
import type { Theme } from '../../theme/types'
import { buildWaCssVariables } from './theme-bridge'

// A minimal Theme stub matching the shape of theme/types.ts. The
// bridge only reads a subset of fields — the test pins those.
const stubTheme = {
  variant: 'light',
  colors: {
    primary: '#5b34c7',
    neutralScale: { 500: '#666666', 900: '#1a1a1a' },
    success: '#1d7f74',
    warning: '#d4a300',
    danger: '#b03030',
  },
  text: { primary: '#1a1a1a', secondary: '#444', onPrimary: '#fff' },
  bg: { canvas: '#ffffff', surface: '#f5f5f5' },
  border: { default: '#d0d0d0' },
  radii: { sm: '4px', md: '8px', pill: '999px' },
  font: { family: { body: 'Inter, sans-serif' }, sizes: { xs: '12px', sm: '14px' } },
} as unknown as Theme

describe('buildWaCssVariables', () => {
  it('emits a :root block with --wa-color-* variables sourced from theme.colors', () => {
    const css = buildWaCssVariables(stubTheme)
    expect(css).toMatch(/:root\s*\{/)
    expect(css).toContain('--wa-color-brand-fill-loud: #5b34c7;')
    expect(css).toContain('--wa-color-success-fill-loud: #1d7f74;')
    expect(css).toContain('--wa-color-warning-fill-loud: #d4a300;')
    expect(css).toContain('--wa-color-danger-fill-loud: #b03030;')
  })

  it('emits surface + text + neutral mappings', () => {
    const css = buildWaCssVariables(stubTheme)
    expect(css).toContain('--wa-color-surface-default: #ffffff;')
    expect(css).toContain('--wa-color-surface-raised: #f5f5f5;')
    expect(css).toContain('--wa-color-text-normal: #1a1a1a;')
    expect(css).toContain('--wa-color-text-quiet: #444;')
    expect(css).toContain('--wa-border-color-normal: #d0d0d0;')
  })

  it('emits border-radius mappings', () => {
    const css = buildWaCssVariables(stubTheme)
    expect(css).toContain('--wa-border-radius-s: 4px;')
    expect(css).toContain('--wa-border-radius-m: 8px;')
    expect(css).toContain('--wa-border-radius-pill: 999px;')
  })

  it('emits font-family + size mappings', () => {
    const css = buildWaCssVariables(stubTheme)
    expect(css).toContain('--wa-font-family-body: Inter, sans-serif;')
    expect(css).toContain('--wa-font-size-xs: 12px;')
    expect(css).toContain('--wa-font-size-s: 14px;')
  })

  it('respects dark variant by tagging the :root with [data-wa-theme="dark"]', () => {
    const dark = { ...stubTheme, variant: 'dark' } as unknown as Theme
    const css = buildWaCssVariables(dark)
    // Dark variant emits the same vars but under a data-wa-theme attribute
    // selector so WA's component palette switches automatically.
    expect(css).toMatch(/\[data-wa-theme="dark"\]\s*\{/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=webawesome/theme-bridge.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/services/webawesome/theme-bridge.ts
import type { Theme } from '../../theme/types'

// Map our styled-components theme tokens to Web Awesome's CSS custom
// properties. WA reads these from `:root` (light) or
// `[data-wa-theme="dark"]` (dark); components inside the shadow DOM
// inherit them via `var(...)`. Reference: Web Awesome 3.7 theming docs
// (CSS custom property naming follows `--wa-color-*`, `--wa-font-*`,
// `--wa-border-radius-*`, etc.).
export function buildWaCssVariables(theme: Theme): string {
  const variant = theme.variant
  const selector = variant === 'dark' ? '[data-wa-theme="dark"]' : ':root'
  const lines = [
    // Brand / status fills.
    `--wa-color-brand-fill-loud: ${theme.colors.primary};`,
    `--wa-color-success-fill-loud: ${theme.colors.success};`,
    `--wa-color-warning-fill-loud: ${theme.colors.warning};`,
    `--wa-color-danger-fill-loud: ${theme.colors.danger};`,
    // Surfaces.
    `--wa-color-surface-default: ${theme.bg.canvas};`,
    `--wa-color-surface-raised: ${theme.bg.surface};`,
    // Text.
    `--wa-color-text-normal: ${theme.text.primary};`,
    `--wa-color-text-quiet: ${theme.text.secondary};`,
    `--wa-color-on-loud: ${theme.text.onPrimary};`,
    // Border.
    `--wa-border-color-normal: ${theme.border.default};`,
    // Radii.
    `--wa-border-radius-s: ${theme.radii.sm};`,
    `--wa-border-radius-m: ${theme.radii.md};`,
    `--wa-border-radius-pill: ${theme.radii.pill};`,
    // Typography.
    `--wa-font-family-body: ${theme.font.family.body};`,
    `--wa-font-size-xs: ${theme.font.sizes.xs};`,
    `--wa-font-size-s: ${theme.font.sizes.sm};`,
  ]
  return `${selector} {\n  ${lines.join('\n  ')}\n}\n`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=webawesome/theme-bridge.test`
Expected: PASS — 5 specs.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/webawesome/theme-bridge.ts \
  src/services/webawesome/theme-bridge.test.ts
git commit -m "feat(webawesome): theme bridge maps tokens to --wa-* variables"
```

### Task 3: `ThemeStyleSheet` React component + global mount

**Files:**
- Create: `src/services/webawesome/ThemeStyleSheet.tsx`
- Create: `src/services/webawesome/ThemeStyleSheet.test.tsx`
- Modify: the app shell (find it via `grep -l "ThemeProvider" src/App.tsx src/components/Shell.tsx 2>/dev/null` — likely one of those) to mount `<ThemeStyleSheet />` once near the top.

- [ ] **Step 1: Write the failing test**

```tsx
// src/services/webawesome/ThemeStyleSheet.test.tsx
import { render, cleanup } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../test-utils/theme'
import { ThemeStyleSheet } from './ThemeStyleSheet'

afterEach(cleanup)

describe('ThemeStyleSheet', () => {
  it('injects a <style data-testid="wa-theme"> element with the bridge output', () => {
    render(
      <ThemeProvider theme={theme}>
        <ThemeStyleSheet />
      </ThemeProvider>
    )
    const styleEl = document.querySelector('style[data-wa-theme-sheet]')
    expect(styleEl).not.toBeNull()
    expect(styleEl?.textContent ?? '').toMatch(/--wa-color-brand-fill-loud:/)
  })

  it('removes the style element on unmount', () => {
    const { unmount } = render(
      <ThemeProvider theme={theme}>
        <ThemeStyleSheet />
      </ThemeProvider>
    )
    expect(document.querySelector('style[data-wa-theme-sheet]')).not.toBeNull()
    unmount()
    expect(document.querySelector('style[data-wa-theme-sheet]')).toBeNull()
  })

  it('updates the style element content when the theme variant changes', () => {
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <ThemeStyleSheet />
      </ThemeProvider>
    )
    const initialText =
      document.querySelector('style[data-wa-theme-sheet]')?.textContent ?? ''
    expect(initialText).toMatch(/^:root\s*\{/m)

    const dark = { ...theme, variant: 'dark' as const }
    rerender(
      <ThemeProvider theme={dark}>
        <ThemeStyleSheet />
      </ThemeProvider>
    )
    const next =
      document.querySelector('style[data-wa-theme-sheet]')?.textContent ?? ''
    expect(next).toMatch(/\[data-wa-theme="dark"\]\s*\{/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=webawesome/ThemeStyleSheet.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// src/services/webawesome/ThemeStyleSheet.tsx
import { useEffect } from 'react'
import { useTheme } from 'styled-components'
import { buildWaCssVariables } from './theme-bridge'

// Mount once in the app shell. Generates a <style> tag in <head>
// containing Web Awesome's CSS custom-property mappings, derived
// from the live styled-components theme. Updates on theme change
// (e.g. light ↔ dark variant flip).
//
// Returns null — this is a side-effect-only component.
export const ThemeStyleSheet = (): null => {
  const theme = useTheme()
  useEffect(() => {
    const styleEl = document.createElement('style')
    styleEl.setAttribute('data-wa-theme-sheet', '')
    styleEl.textContent = buildWaCssVariables(theme)
    document.head.appendChild(styleEl)
    return () => {
      styleEl.remove()
    }
  }, [theme])
  return null
}
```

- [ ] **Step 4: Mount in the app shell**

First locate the shell. Run from the repo root:

```bash
grep -rln "ThemeProvider" src/App.tsx src/components/Shell.tsx 2>/dev/null
```

Read whichever file resolves. The shell typically wraps the route tree in `<ThemeProvider theme={...}>`. Mount `<ThemeStyleSheet />` as the first child INSIDE the `ThemeProvider`:

```tsx
import { ThemeStyleSheet } from './services/webawesome/ThemeStyleSheet'
// adjust the import path to be relative to the actual shell file

// In the JSX:
<ThemeProvider theme={activeTheme}>
  <ThemeStyleSheet />
  {/* …existing shell tree… */}
</ThemeProvider>
```

If the project has more than one `ThemeProvider` (e.g. tests vs main), only the production one needs the mount. The test-utils `testTheme` setup doesn't need `<ThemeStyleSheet>` — components consuming the bridge in tests can read CSS vars from jsdom regardless.

- [ ] **Step 5: Run tests**

Run: `npm test -- --testPathPattern=webawesome`
Expected: PASS — 8 specs total (5 bridge + 3 ThemeStyleSheet).

Run: `npm test`
Expected: ALL pass.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/webawesome/ThemeStyleSheet.tsx \
  src/services/webawesome/ThemeStyleSheet.test.tsx \
  src/App.tsx
# (replace src/App.tsx with the actual shell file you modified)
git commit -m "feat(webawesome): mount ThemeStyleSheet at the app shell"
```

### Task 4: Register `wa-button` via central import module

**Files:**
- Create: `src/services/webawesome/index.ts`
- Modify: the app shell to import `./services/webawesome` for side effects.

- [ ] **Step 1: Create the central register module**

```ts
// src/services/webawesome/index.ts
// Web Awesome component registration. Importing a component module
// auto-registers its custom element via `customElements.define`. We
// use EXPLICIT imports rather than the autoloader so bundle size
// stays predictable and the dependency graph is grep-able.
//
// Add a new line here when migrating an additional component in a
// follow-up plan. Order doesn't matter — each component registers
// itself once on first import.
import '@awesome.me/webawesome/dist/components/button/button.js'
```

If the actual import path differs (the WA package's `dist/` layout may have changed in 3.7.0), find the correct path by inspecting:

```bash
ls node_modules/@awesome.me/webawesome/dist/components/button/
```

Use whichever entry the package exports — typically `button.js` or `button.es.js`.

- [ ] **Step 2: Wire the side-effect import into the shell**

In the same shell file as Task 3, add at the top of the imports:

```ts
import './services/webawesome' // side-effect: registers <wa-button> etc.
```

(Adjust the import path to be relative to the shell file's location.)

This must run BEFORE any JSX renders `<wa-button>`. Module imports at the top of the shell satisfy that ordering.

- [ ] **Step 3: Smoke-test in jest**

The existing tests don't need updates. Run them to confirm nothing broke:

Run: `npm test`
Expected: ALL pass. jsdom's `customElements.define` works; importing the WA button module registers the tag globally per-test-file. Jest's module-cache means it's re-registered per test file (idempotent — `customElements.define` throws on duplicate, but Web Awesome guards against this).

If a test fails with "Element 'wa-button' has already been defined", add a guard import:

```ts
// in src/services/webawesome/index.ts at the top:
if (typeof customElements !== 'undefined' && !customElements.get('wa-button')) {
  // dynamic import to avoid re-registration races
  import('@awesome.me/webawesome/dist/components/button/button.js')
}
```

But this is unlikely — the official WA package handles re-imports gracefully.

- [ ] **Step 4: Verify the dev/electron build still works**

Run: `npm run build`
Expected: webpack succeeds. The bundle now includes Lit + the WA button. Bundle size grows by ~20-40 KB gzipped — acceptable for the spike.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/webawesome/index.ts src/App.tsx
# (use the actual shell file)
git commit -m "feat(webawesome): register wa-button via central import module"
```

### Task 5: Jest config — handle WA CSS imports + Lit's package exports

**Files:**
- Modify: `jest.config.cjs`

This task is reactive — only do it if the prior task's `npm test` failed with a CSS-import or `@lit/react` resolution error. If the smoke ran clean, skip to Task 6.

- [ ] **Step 1: Inspect the current jest config**

Read `jest.config.cjs`. Note the existing `moduleNameMapper` (likely already stubs `\\.css$` → `style-mock.js`). Note `transformIgnorePatterns` — Jest by default ignores `node_modules`, but WA + Lit are ESM-only and need transpiling.

- [ ] **Step 2: Allowlist WA + Lit packages through the transform**

Modify `transformIgnorePatterns` so the WA + Lit packages are NOT ignored:

```js
transformIgnorePatterns: [
  // Default: ignore node_modules EXCEPT the WA / Lit ESM packages.
  '/node_modules/(?!(@awesome\\.me|lit|@lit|lit-element|lit-html|@floating-ui)/)',
],
```

(Preserve any other patterns the existing config has — append the WA/Lit exception to the negative-lookahead alternation.)

- [ ] **Step 3: Re-run tests**

Run: `npm test`
Expected: ALL pass. If a different package surfaces ESM-import errors, append its name to the negative-lookahead.

- [ ] **Step 4: Commit**

```bash
git add jest.config.cjs
git commit -m "build(test): transform @awesome.me/webawesome + lit ESM through jest"
```

---

## Phase 2 — Spike Migration: GraphToolbar Buttons

### Task 6: Migrate viewport buttons (zoom in/out, fit, reset) to `<wa-button>`

**Files:**
- Modify: `src/components/results/graph/GraphToolbar.tsx`

The current toolbar (`src/components/results/graph/GraphToolbar.tsx`) renders a row of `<button type="button">` elements inside a styled `Toolbar` container. The Toolbar's nested CSS selects on `select, button` — that styling won't reach `<wa-button>` (shadow DOM). We rely on the theme bridge (Task 2) to make WA buttons visually consistent.

- [ ] **Step 1: Locate the four viewport buttons**

In `GraphToolbar.tsx`, find the existing buttons with these test IDs:
- `graph-zoom-in` (label `+`)
- `graph-zoom-out` (label `−`)
- `graph-fit` (label from `t('graph.fit')`)
- `graph-reset-view` (label from `t('graph.resetView')`)

- [ ] **Step 2: Replace each with `<wa-button>`**

For each of the four, change:

```tsx
<button
  type="button"
  data-testid="graph-zoom-in"
  aria-label={t('graph.zoomIn')}
  title={t('graph.zoomIn')}
  onClick={onZoomIn}
>
  +
</button>
```

To:

```tsx
<wa-button
  appearance="outlined"
  size="small"
  data-testid="graph-zoom-in"
  aria-label={t('graph.zoomIn')}
  title={t('graph.zoomIn')}
  onClick={onZoomIn}
>
  +
</wa-button>
```

Do the same swap for `graph-zoom-out`, `graph-fit`, `graph-reset-view`. Preserve every attribute except `type="button"` (irrelevant for custom element). Keep `appearance="outlined"` + `size="small"` consistent across all four — these are action buttons (not toggles).

- [ ] **Step 3: Run jest to verify the existing assertions still pass**

The existing assertions look up these buttons via `getByTestId`. `data-testid` is a host-element attribute (lives on the `<wa-button>` itself, not in shadow DOM), so `getByTestId` continues to work. `aria-label` and `title` are also host attributes — Testing Library's accessibility queries still find them.

Run: `npm test -- --testPathPattern='results/graph|GraphView'`
Expected: PASS — no regression.

If any test fails because it asserts on the rendered tag name (`expect(toggle.tagName).toBe('BUTTON')`), update that single assertion to `'WA-BUTTON'`. Per Testing Library conventions, prefer `getByRole('button', { name: ... })` which works for both — and the WA button forwards `role="button"` from its internal `<button>`.

- [ ] **Step 4: Run the dev server briefly + spot-check visually**

Skip if you can't easily render — the e2e in Task 10 covers visual confirmation against a live stack.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/GraphToolbar.tsx
git commit -m "feat(graph): migrate viewport buttons (zoom/fit/reset) to wa-button"
```

### Task 7: Migrate toggle buttons (selection mode, cluster, path, minimap, lasso, dom-nodes, size, focus indicator) to `<wa-button>`

**Files:**
- Modify: `src/components/results/graph/GraphToolbar.tsx`

The toolbar's toggle buttons all use the `aria-pressed` pattern. We map the pressed/unpressed visual to `<wa-button>`'s `appearance` prop:
- `aria-pressed="true"` → `appearance="filled"`
- `aria-pressed="false"` → `appearance="outlined"`

- [ ] **Step 1: List the toggle buttons in the file**

Find every `<button>` with `aria-pressed={...}`. Likely list (verify against actual file content):
- `graph-selection-mode`
- `graph-cluster-toggle`
- `graph-path-mode`
- `graph-minimap-toggle`
- `graph-lasso-toggle`
- `graph-dom-nodes-toggle`
- `graph-size-toggle`

(Some may have been added in prior tasks; treat the actual file as authoritative.)

- [ ] **Step 2: Replace each toggle**

For each toggle, transform:

```tsx
<button
  type="button"
  data-testid="graph-lasso-toggle"
  aria-pressed={lasso}
  aria-label={t('graph.lassoLabel')}
  title={t('graph.lassoLabel')}
  onClick={onToggleLasso}
>
  {t('graph.lasso')}
</button>
```

To:

```tsx
<wa-button
  appearance={lasso ? 'filled' : 'outlined'}
  size="small"
  data-testid="graph-lasso-toggle"
  aria-pressed={lasso ? 'true' : 'false'}
  aria-label={t('graph.lassoLabel')}
  title={t('graph.lassoLabel')}
  onClick={onToggleLasso}
>
  {t('graph.lasso')}
</wa-button>
```

Two important details:
- `aria-pressed` MUST be a string (`'true'` / `'false'`) for web-components attribute reflection. React 18 serializes booleans as `'true'`/`'false'` for aria-* automatically, but being explicit avoids ambiguity.
- `appearance` flips visually between filled (pressed) and outlined (unpressed).

Apply the same transformation to every toggle.

- [ ] **Step 3: Run jest**

Existing tests assert `aria-pressed='true'` / `'false'` — both are now actual strings on the host. The asserts still pass.

Run: `npm test -- --testPathPattern='results/graph|GraphView'`
Expected: PASS.

If a test asserts `aria-pressed` as a boolean (`expect(toggle).toHaveAttribute('aria-pressed', false)`), update to `'false'`. The `toHaveAttribute` matcher treats values as strings.

- [ ] **Step 4: Commit**

```bash
git add src/components/results/graph/GraphToolbar.tsx
git commit -m "feat(graph): migrate toggle buttons to wa-button appearance"
```

### Task 8: Migrate the remaining toolbar action buttons (path-clear and sidebar-toggle) + Find input

**Files:**
- Modify: `src/components/results/graph/GraphToolbar.tsx`

The toolbar has a couple more `<button>` elements that aren't toggles:
- `graph-sidebar-toggle` — the chevron sidebar collapse button
- `graph-path-clear` — the "clear path" button (only renders when path mode is active)

The Find input (`<FindNodeInput>`) is a separate React component containing an `<input type="search">` — leave it alone for now. Migrating inputs to `<wa-input>` adds the React-18-custom-event complexity we deferred.

- [ ] **Step 1: Replace `graph-sidebar-toggle` and `graph-path-clear`**

For `graph-sidebar-toggle`:

```tsx
<wa-button
  appearance="outlined"
  size="small"
  data-testid="graph-sidebar-toggle"
  aria-pressed={sidebarCollapsed ? 'true' : 'false'}
  aria-label={
    sidebarCollapsed
      ? t('graph.expandSidebar')
      : t('graph.collapseSidebar')
  }
  title={
    sidebarCollapsed
      ? t('graph.expandSidebar')
      : t('graph.collapseSidebar')
  }
  onClick={onToggleSidebar}
>
  {sidebarCollapsed ? '⮜' : '⮞'}
</wa-button>
```

For `graph-path-clear`:

```tsx
<wa-button
  appearance="outlined"
  size="small"
  data-testid="graph-path-clear"
  onClick={onPathClear}
>
  {t('graph.pathClear')}
</wa-button>
```

- [ ] **Step 2: Confirm no `<button>` elements remain in `GraphToolbar.tsx`**

Run: `grep -c '<button' src/components/results/graph/GraphToolbar.tsx`
Expected: `0`.

(Any remaining `<button>` either belongs to a different test surface — like `<FindNodeInput>`'s inner input doesn't have one — or signals a missed conversion. Inspect manually.)

- [ ] **Step 3: Run jest + tsc**

Run: `npm test`
Expected: ALL pass.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/results/graph/GraphToolbar.tsx
git commit -m "feat(graph): migrate sidebar-toggle + path-clear to wa-button"
```

---

## Phase 3 — Documentation

### Task 9: Write the migration playbook

**Files:**
- Create: `docs/web-awesome-migration.md`

- [ ] **Step 1: Write the doc**

Create `docs/web-awesome-migration.md` with this content:

```markdown
# Web Awesome Migration Playbook

This document describes how to migrate a UI surface from React + styled-components to Web Awesome components, based on lessons from the GraphToolbar spike (plan: `2026-05-14-web-awesome-foundation-and-toolbar-spike.md`).

## Foundation already in place

- `@awesome.me/webawesome@^3.7.0` is installed.
- `src/services/webawesome/index.ts` is the central registration module — import additional components here when migrating new surfaces.
- `src/services/webawesome/ThemeStyleSheet` mounts at the app shell and projects our styled-components theme into Web Awesome's CSS custom properties (`--wa-color-*`, etc.). All theme-aware visuals work out of the box.
- `src/services/webawesome/theme-bridge.ts` is the one-place-to-edit for token mappings. Add new mappings when migrations need vars we haven't bridged yet.
- `src/types/awesome-webawesome.d.ts` declares JSX intrinsic types for the components we use. Add new tags here when registering new components.

## Migration pattern (per surface)

1. **Pick a small surface** (a single component file or a tight cluster). Avoid migrating partial files — the friction of half-migrated files is high.
2. **Register the WA components** you need by appending imports to `src/services/webawesome/index.ts`. Add JSX type declarations to `src/types/awesome-webawesome.d.ts`.
3. **Replace native elements with WA tags one-for-one** (e.g. `<button>` → `<wa-button>`, `<select>` → `<wa-select>`). Preserve `data-testid`, `aria-*`, `title`, `onClick` attributes.
4. **Map state-to-appearance**: toggle buttons use `appearance="filled"` (pressed) vs `appearance="outlined"` (unpressed). Form controls reflect their own value via the `value` attribute.
5. **For React 18 custom events** (e.g. `wa-change`, `wa-input` on form components), use a ref + `useEffect` + `addEventListener` pattern. Do NOT use `onWaChange={...}` — React 18 doesn't forward custom events that way.
6. **Update tests**: `getByTestId` and `getByRole('button', { name })` work unchanged. If a test asserts on tag name (`tagName === 'BUTTON'`), update to `'WA-BUTTON'` or switch to `getByRole`.
7. **Run e2e** against a rebuilt container — visual regressions surface here, not in jest.

## React 18 + Web Components — the one footgun

Web components fire custom events (`wa-change`, `wa-input`, `wa-click`, etc.). React 18 does NOT forward `onWaChange={handler}` style props for custom events. To listen, you need:

```tsx
const ref = useRef<HTMLElement | null>(null)
useEffect(() => {
  const el = ref.current
  if (!el) return
  const handler = (e: Event) => { /* ... */ }
  el.addEventListener('wa-change', handler)
  return () => el.removeEventListener('wa-change', handler)
}, [])

return <wa-input ref={ref} />
```

For buttons (which fire standard `click`), `onClick={handler}` works as expected.

Future React 19 migration: web component event handling becomes native (`onWaChange={...}` works directly). Plan to revisit this footgun then.

## Styling boundaries

Web Awesome components use shadow DOM. styled-components selectors do NOT reach into the shadow root. Customize via:

1. **CSS custom properties** (preferred) — set `--wa-*` vars on a parent element or globally via the theme bridge.
2. **`::part()` selectors** — many WA components expose internal parts (e.g. `wa-button::part(base)`). Use sparingly; less stable than CSS variables.
3. **Slotted content** — content you put inside `<wa-button>...</wa-button>` is in light DOM, fully styleable by your own styled-components.

## Don't migrate yet

Until React 19 is in place, defer migration of:
- Heavily interactive form controls (`<wa-input>`, `<wa-select>`, `<wa-checkbox>` with custom event handlers).
- Components that pair tightly with styled-components inner styles (popovers / cards / dialogs where you're styling their internals directly).

## Components ready for migration today

- `<wa-button>` — actions and toggles. ✅ Done (GraphToolbar spike).
- `<wa-spinner>` — loading indicators.
- `<wa-icon>` — if we move icons to the Web Awesome icon set.
- `<wa-tag>` — chips / badges (Note: our DOM-overlay badges in `GraphBadges` use position:absolute which a WA tag could replace, but the absolute positioning is what's load-bearing — defer).

## Next migrations (suggested order)

1. **App shell buttons** (Run query, Cancel, etc.) — same pattern as toolbar; widens the pattern footprint.
2. **Modal/dialog surfaces** — `<wa-dialog>` for the expand popover, confirmation modals.
3. **Form controls** — only after React 19 upgrade.
```

- [ ] **Step 2: Commit**

```bash
git add docs/web-awesome-migration.md
git commit -m "docs(webawesome): migration playbook from toolbar spike"
```

---

## Phase 4 — End-to-end Validation

### Task 10: Rebuild geode-ui + run full e2e

**Files:** none modified — verification only.

- [ ] **Step 1: Rebuild the geode-ui container**

```bash
docker compose -f deploy/docker-compose.test.yml build geode-ui
docker compose -f deploy/docker-compose.test.yml up -d geode-ui
until wget -qO- http://localhost:8080/healthz 2>/dev/null | grep -q ok; do sleep 2; done
```

Expected: build succeeds, container healthy.

- [ ] **Step 2: Run the graph e2e specs**

```bash
npx playwright test --config=e2e/playwright.config.ts e2e/specs/24-graph-power-features.spec.ts --reporter=list
```

Expected: all pass. `<wa-button>` tags forward `data-testid`, `aria-pressed`, `aria-label`, `title`, and `click` events normally — the existing specs continue to find the toolbar buttons and assert state changes.

If a spec fails:
- For "click didn't fire" — confirm the WA button is rendering (not stuck in an unregistered-element fallback). Check the network tab in Playwright trace for the WA module load.
- For "aria-pressed is wrong" — confirm the JSX expression renders the string `'true'`/`'false'` not boolean `true`/`false`.

- [ ] **Step 3: Run the full e2e suite**

```bash
npx playwright test --config=e2e/playwright.config.ts --reporter=list
```

Expected: green. Pre-existing flakes (e.g. `12-multi-request.spec.ts`) are acceptable.

- [ ] **Step 4: Run jest + tsc + lint**

```bash
npm test && npx tsc --noEmit && npm run lint
```

Expected: ALL green.

- [ ] **Step 5: Commit (verification artifact)**

This task doesn't produce new files. If `npm test` surfaces any pre-commit hook re-formatting (e.g. prettier auto-fix), commit that:

```bash
git status
# if anything is changed:
git add .
git commit -m "chore(webawesome): post-migration formatting + lock-file refresh"
```

Otherwise skip the commit.

---

## Self-Review Notes

- **Foundation reusable across all future migrations:** `src/services/webawesome/index.ts` is the single point to register new components; `theme-bridge.ts` is the single point to expose new tokens. Both are tiny modules — easy to extend incrementally.
- **Spike scope strict:** only GraphToolbar buttons. Inputs / forms / modals stay native. The migration playbook (Task 9) tells follow-up plans where the boundaries are.
- **React 18 vs 19 acknowledged:** the playbook flags the custom-event footgun and recommends deferring form-control migrations until React 19. Buttons are safe because they fire standard `click`.
- **Tests unchanged in shape:** `data-testid` + `aria-pressed` + `aria-label` all live on the host element. Existing assertions transfer without rewrites.
- **Bundle impact:** ~20-40 KB gzipped per WA component (Lit shared base). The spike adds only `<wa-button>` so the cost is bounded.
- **Out of scope, explicit:** 3D rendering, edge bundling, Pro components, autoloader, full UI migration, React 19 upgrade.

---

Plan complete. Total: 10 tasks across 4 phases, every task TDD where applicable (Tasks 2 + 3 follow the strict failing-test-first cycle; Tasks 1, 4, 5, 10 are install/config/verification; Tasks 6-8 are mechanical refactors guarded by the existing jest + e2e suites).
