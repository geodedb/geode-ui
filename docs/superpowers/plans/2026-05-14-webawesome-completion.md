# Web Awesome Migration Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the visibility regression (WA buttons aren't rendering because the foundation CSS isn't imported), then migrate the top-traffic surfaces — Login, QueryPage, ResultPanel tabs, GraphInspector, ExpandQueryPopover, FindNodeInput — to Web Awesome components (button, dialog, input, select, tab-group).

**Architecture:** Import WA's `webawesome.css` (foundation) and `themes/default.css` (token defaults) once at the app shell. Add `@lit/react` `createComponent` wrappers for the WA components that fire custom events (`wa-change`, `wa-input`, `wa-show`, `wa-tab-show`, etc.) so React-18 consumers can use `onWaChange={handler}` prop syntax without manual `addEventListener` boilerplate. Migrate JSX one surface at a time using either bare custom elements (for click-only components like `<wa-button>`) or the React wrappers (for everything else). Each migration ships with its existing test surface intact.

**Tech Stack:** React 18.2 + TypeScript, `@awesome.me/webawesome@^3.7.0` already installed, `@lit/react@^1.0.8` already installed (transitive), Jest + Testing Library, Playwright, styled-components 6 (kept for layout shells).

**Explicitly out of scope:**
- Admin pages (users, roles, grants, policies) — separate plan
- Schema explorer — separate plan
- Profile editor modals + Add/Delete Connection modals — separate plan
- Workspace pane management — separate plan
- Dashboard cards — separate plan
- React 19 upgrade — separate plan

---

## File Structure

**New files:**
- `src/services/webawesome/components.ts` — `@lit/react` `createComponent` wrappers for the WA components used here: `Input`, `Select`, `Option`, `Dialog`, `TabGroup`, `Tab`, `TabPanel`. Each wrapper maps WA's custom events to `onWaXxx` React props.
- `src/services/webawesome/components.test.ts` — smoke tests that each wrapper renders + exposes its event prop names.

**Modified files:**
- `src/services/webawesome/index.ts` — add CSS imports (`dist/styles/webawesome.css`, `dist/styles/themes/default.css`) plus component-JS imports for the additional elements we're migrating (input, select, option, dialog, tab-group, tab, tab-panel).
- `src/types/awesome-webawesome.d.ts` — extend JSX intrinsic-element declarations for the new tags (when consumers use bare custom elements alongside the React wrappers).
- `src/pages/LoginPage.tsx` (and/or its sub-components) — migrate sign-in button, profile-pick buttons → `<wa-button>`; username, password, profile inputs → `<Input>`.
- `src/pages/QueryPage.tsx` — Run, Cancel, mode-toggle buttons → `<wa-button>`.
- `src/components/results/ResultPanel.tsx` — Table/Graph/Matrix/JSON tabs → `<TabGroup>` + `<Tab>` + `<TabPanel>`.
- `src/components/results/graph/GraphInspector.tsx` — Hide/Collapse/Explore/Pin/Focus action buttons → `<wa-button>`.
- `src/components/results/graph/ExpandQueryPopover.tsx` — modal shell → `<Dialog>`; direction radios stay native (radios aren't in WA), label-filter `<select>` → `<Select>`, limit input → `<Input>`.
- `src/components/results/graph/FindNodeInput.tsx` — `<input type="search">` → `<Input type="search">`.
- `src/components/layout/ConnectionSwitcher.tsx` — trigger button → `<wa-button>`. Keep the existing dropdown menu as native HTML (a `<wa-dropdown>` migration is a follow-up plan).
- `e2e/specs/24-graph-power-features.spec.ts` — add a smoke test that confirms `<wa-button>` is fully rendered (has a visible computed bounding box) after the CSS import lands.

**Untouched (deliberate):**
- Admin pages, schema explorer, dashboard, modals besides the expand popover — separate plans.
- Cytoscape integration — unaffected.
- Tests: existing assertions use `getByTestId` and `getByRole` patterns that mostly continue to work for `<wa-button>`. Where they don't (e.g. `getByRole('button')` on a wrapped element), update inline.

---

## Phase 1 — Foundation: import WA core CSS + register more components

### Task 1: Import WA core stylesheet + theme defaults; register more components

**Files:**
- Modify: `src/services/webawesome/index.ts`
- Modify: `src/types/awesome-webawesome.d.ts`

- [ ] **Step 1: Update `src/services/webawesome/index.ts`**

Replace the existing file content with:

```ts
// Web Awesome foundation + component registration.
//
// 1. Import the core stylesheet (provides resets, custom-property
//    defaults, and base utility classes WA components rely on).
// 2. Import the default theme stylesheet (provides the baseline
//    --wa-* token values that our ThemeStyleSheet then overrides
//    via the theme-bridge).
// 3. Side-effect imports for each component register the custom
//    elements via customElements.define().
//
// Components are imported EXPLICITLY (not via the autoloader) so
// bundle size stays predictable. Add new component imports here
// when migrating additional surfaces.

import '@awesome.me/webawesome/dist/styles/webawesome.css'
import '@awesome.me/webawesome/dist/styles/themes/default.css'

import '@awesome.me/webawesome/dist/components/button/button.js'
import '@awesome.me/webawesome/dist/components/input/input.js'
import '@awesome.me/webawesome/dist/components/select/select.js'
import '@awesome.me/webawesome/dist/components/option/option.js'
import '@awesome.me/webawesome/dist/components/dialog/dialog.js'
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js'
import '@awesome.me/webawesome/dist/components/tab/tab.js'
import '@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js'
```

If any of these `dist/components/<name>/<name>.js` paths don't resolve, check the actual layout:

```bash
ls /data/home/benji/src/devnw/codepros/geode/geode-ui/node_modules/@awesome.me/webawesome/dist/components/input/
```

Use whichever filename exists (e.g. `input.js` or `wa-input.js`).

- [ ] **Step 2: Extend ambient JSX declarations**

Update `src/types/awesome-webawesome.d.ts` to declare the new tags. Append BEFORE the trailing `export {}`:

```ts
type WaInputProps = HTMLAttributes<HTMLElement> & {
  type?: 'text' | 'password' | 'email' | 'search' | 'number' | 'tel' | 'url'
  value?: string
  defaultValue?: string
  label?: string
  placeholder?: string
  size?: 'small' | 'medium' | 'large'
  appearance?: 'filled' | 'outlined'
  disabled?: boolean
  required?: boolean
  hint?: string
  pill?: boolean
  clearable?: boolean
  children?: ReactNode
}

type WaSelectProps = HTMLAttributes<HTMLElement> & {
  value?: string
  defaultValue?: string
  label?: string
  placeholder?: string
  size?: 'small' | 'medium' | 'large'
  appearance?: 'filled' | 'outlined'
  disabled?: boolean
  pill?: boolean
  children?: ReactNode
}

type WaOptionProps = HTMLAttributes<HTMLElement> & {
  value?: string
  disabled?: boolean
  children?: ReactNode
}

type WaDialogProps = HTMLAttributes<HTMLElement> & {
  open?: boolean
  label?: string
  children?: ReactNode
}

type WaTabGroupProps = HTMLAttributes<HTMLElement> & {
  active?: string
  placement?: 'top' | 'bottom' | 'start' | 'end'
  children?: ReactNode
}

type WaTabProps = HTMLAttributes<HTMLElement> & {
  panel?: string
  active?: boolean
  closable?: boolean
  disabled?: boolean
  children?: ReactNode
}

type WaTabPanelProps = HTMLAttributes<HTMLElement> & {
  name?: string
  children?: ReactNode
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      // wa-button already declared above
      'wa-input': WaInputProps
      'wa-select': WaSelectProps
      'wa-option': WaOptionProps
      'wa-dialog': WaDialogProps
      'wa-tab-group': WaTabGroupProps
      'wa-tab': WaTabProps
      'wa-tab-panel': WaTabPanelProps
    }
  }
}
```

(Place this INSIDE the existing `declare global { namespace JSX { ... } }` block — append to the existing `IntrinsicElements` interface; don't open a new one.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run build`
Expected: webpack succeeds. The CSS files are included; bundle size grows.

Run: `npm test`
Expected: ALL pass.

If jest fails for a different ESM-only package surfaced by the new imports, append it to `jest.config.cjs`'s `transformIgnorePatterns` allowlist.

If jest OOMs, set `NODE_OPTIONS='--max-old-space-size=4096'`.

- [ ] **Step 4: Commit**

```bash
git add src/services/webawesome/index.ts src/types/awesome-webawesome.d.ts
git commit -m "feat(webawesome): import foundation CSS + register input/select/dialog/tabs"
```

### Task 2: React wrappers via `@lit/react` for custom-event components

**Files:**
- Create: `src/services/webawesome/components.ts`
- Create: `src/services/webawesome/components.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/webawesome/components.test.ts
import {
  Input,
  Select,
  Option,
  Dialog,
  TabGroup,
  Tab,
  TabPanel,
} from './components'

describe('webawesome React wrappers', () => {
  it('exports React-renderable wrappers for the migrated WA components', () => {
    // createComponent from @lit/react returns a React component
    // function. The displayName (or function name) matches the WA
    // tag name.
    expect(typeof Input).toBe('object') // forwardRef returns an object
    expect(typeof Select).toBe('object')
    expect(typeof Option).toBe('object')
    expect(typeof Dialog).toBe('object')
    expect(typeof TabGroup).toBe('object')
    expect(typeof Tab).toBe('object')
    expect(typeof TabPanel).toBe('object')
  })
})
```

(`createComponent`'s return value is a `forwardRef`-style React component; `typeof` is `'object'` because forwardRef returns `{ $$typeof, render }`.)

- [ ] **Step 2: Run test to verify fails**

Run: `npm test -- --testPathPattern=webawesome/components.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/services/webawesome/components.ts
// React adapter wrappers for the Web Awesome components that fire
// CUSTOM EVENTS. React 18 doesn't forward `onWaChange={...}` props
// for unknown events on bare custom elements, so we use
// @lit/react's createComponent to map each WA custom event to a
// matching `onWaXxx` React prop.
//
// Buttons are intentionally NOT wrapped — they fire standard
// `click`, which React forwards natively via `onClick`. Consumers
// can use `<wa-button onClick={handler}>` directly.

import * as React from 'react'
import { createComponent } from '@lit/react'

import { WaInput } from '@awesome.me/webawesome/dist/components/input/input.js'
import { WaSelect } from '@awesome.me/webawesome/dist/components/select/select.js'
import { WaOption } from '@awesome.me/webawesome/dist/components/option/option.js'
import { WaDialog } from '@awesome.me/webawesome/dist/components/dialog/dialog.js'
import { WaTabGroup } from '@awesome.me/webawesome/dist/components/tab-group/tab-group.js'
import { WaTab } from '@awesome.me/webawesome/dist/components/tab/tab.js'
import { WaTabPanel } from '@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js'

export const Input = createComponent({
  tagName: 'wa-input',
  elementClass: WaInput as never,
  react: React,
  events: {
    onWaChange: 'wa-change',
    onWaInput: 'wa-input',
    onWaBlur: 'wa-blur',
    onWaFocus: 'wa-focus',
  },
})

export const Select = createComponent({
  tagName: 'wa-select',
  elementClass: WaSelect as never,
  react: React,
  events: {
    onWaChange: 'wa-change',
    onWaBlur: 'wa-blur',
    onWaFocus: 'wa-focus',
  },
})

export const Option = createComponent({
  tagName: 'wa-option',
  elementClass: WaOption as never,
  react: React,
  events: {},
})

export const Dialog = createComponent({
  tagName: 'wa-dialog',
  elementClass: WaDialog as never,
  react: React,
  events: {
    onWaShow: 'wa-show',
    onWaAfterShow: 'wa-after-show',
    onWaHide: 'wa-hide',
    onWaAfterHide: 'wa-after-hide',
  },
})

export const TabGroup = createComponent({
  tagName: 'wa-tab-group',
  elementClass: WaTabGroup as never,
  react: React,
  events: {
    onWaTabShow: 'wa-tab-show',
    onWaTabHide: 'wa-tab-hide',
  },
})

export const Tab = createComponent({
  tagName: 'wa-tab',
  elementClass: WaTab as never,
  react: React,
  events: {
    onWaClose: 'wa-close',
  },
})

export const TabPanel = createComponent({
  tagName: 'wa-tab-panel',
  elementClass: WaTabPanel as never,
  react: React,
  events: {},
})
```

The `as never` casts are because the WA element classes don't perfectly match `@lit/react`'s `elementClass` typing; the cast is harmless because `createComponent` only uses the constructor at runtime.

If the WA component exports use different names (e.g. some packages export `default` instead of named), inspect:

```bash
grep -n "export" /data/home/benji/src/devnw/codepros/geode/geode-ui/node_modules/@awesome.me/webawesome/dist/components/input/input.d.ts | head -5
```

And adjust the import accordingly. The pattern is usually `import WaInput from '.../input.js'` (default) OR `import { WaInput } from '.../input.js'` (named). Both forms work with `createComponent`.

- [ ] **Step 4: Run test to verify passes**

Run: `npm test -- --testPathPattern=webawesome/components.test`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm test`
Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/webawesome/components.ts \
  src/services/webawesome/components.test.ts
git commit -m "feat(webawesome): @lit/react wrappers for Input/Select/Dialog/Tabs"
```

---

## Phase 2 — Migrate top-traffic surfaces

For each surface, the pattern is:
1. Read the current source.
2. Identify the elements to migrate.
3. Replace JSX one-for-one.
4. Run jest + tsc.
5. Commit.

Each task is self-contained.

### Task 3: QueryPage Run/Cancel/Mode buttons → `<wa-button>`

**Files:**
- Modify: `src/pages/QueryPage.tsx`

- [ ] **Step 1: Locate the buttons**

Read `src/pages/QueryPage.tsx`. Find every native `<button>` element. Likely: a Run button, a Cancel button (when streaming), and a stream-mode toggle. Note the existing `data-testid` and `aria-*` attributes — they must be preserved.

- [ ] **Step 2: Replace each native `<button>` with `<wa-button>`**

For a primary action button (e.g. Run):

```tsx
<wa-button
  appearance="filled"
  variant="brand"
  size="medium"
  data-testid="query-run-btn"
  onClick={onRun}
  disabled={running}
>
  {t('query.run')}
</wa-button>
```

For a secondary action (Cancel):

```tsx
<wa-button
  appearance="outlined"
  size="medium"
  data-testid="query-cancel-btn"
  onClick={onCancel}
>
  {t('query.cancel')}
</wa-button>
```

For toggle buttons (e.g. stream mode):

```tsx
<wa-button
  appearance={streamMode ? 'filled' : 'outlined'}
  size="small"
  aria-pressed={streamMode ? 'true' : 'false'}
  data-testid="query-stream-mode-toggle"
  onClick={onToggleStreamMode}
>
  {t('query.streamMode')}
</wa-button>
```

Preserve every `data-testid`, `aria-label`, `title`, `disabled`, `onClick`. Remove `type="button"`. Match the variant + appearance to the semantic role.

- [ ] **Step 3: Run jest**

Run: `npm test -- --testPathPattern='pages/QueryPage'`
Expected: PASS. Existing assertions use `getByTestId` or `getByRole('button', { name })` — `getByTestId` works; `getByRole` may not (see playbook). If `getByRole` queries fail, switch them to `getByTestId`.

Run: `npm test`
Expected: ALL pass.

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/pages/QueryPage.tsx
git commit -m "feat(query): migrate Run/Cancel/mode buttons to wa-button"
```

### Task 4: ResultPanel tabs → `<TabGroup>` + `<Tab>` + `<TabPanel>`

**Files:**
- Modify: `src/components/results/ResultPanel.tsx`

- [ ] **Step 1: Inspect the current tab implementation**

Read `src/components/results/ResultPanel.tsx`. The result panel renders multiple result modes: Table, Graph, Matrix, JSON, and a Close button. The current tabs are likely custom-styled `<button>` elements bound to a `tab` state variable.

- [ ] **Step 2: Replace the tab strip with `<TabGroup>` + `<Tab>` panels**

Add the import:

```ts
import { TabGroup, Tab, TabPanel } from '../../services/webawesome/components'
```

Replace the existing tab strip + content with:

```tsx
<TabGroup
  active={tab}
  onWaTabShow={(e) => {
    // wa-tab-show fires with detail.name as the new active panel
    const name = (e as CustomEvent<{ name: string }>).detail?.name
    if (name) setTab(name as TabName)
  }}
>
  <Tab slot="nav" panel="table" data-testid="result-tab-table">
    {t('result.tabs.table')}
  </Tab>
  <Tab slot="nav" panel="graph" data-testid="result-tab-graph">
    {t('result.tabs.graph')}
  </Tab>
  <Tab slot="nav" panel="matrix" data-testid="result-tab-matrix">
    {t('result.tabs.matrix')}
  </Tab>
  <Tab slot="nav" panel="json" data-testid="result-tab-json">
    {t('result.tabs.json')}
  </Tab>

  <TabPanel name="table"><TableView resp={resp} /></TabPanel>
  <TabPanel name="graph"><GraphView resp={resp} query={query} /></TabPanel>
  <TabPanel name="matrix"><MatrixView resp={resp} /></TabPanel>
  <TabPanel name="json"><JsonView resp={resp} /></TabPanel>
</TabGroup>
```

Important:
- `<Tab slot="nav">` — without `slot="nav"` the tab renders in the wrong area.
- `panel` prop on `<Tab>` must match `name` prop on `<TabPanel>`.
- `active` and `onWaTabShow` drive the controlled selection.

The "Close" button stays as `<wa-button>`:

```tsx
<wa-button
  appearance="plain"
  size="small"
  data-testid="result-close-btn"
  onClick={onClose}
>
  {t('result.close')}
</wa-button>
```

(Position it however the current layout positions the existing close affordance.)

- [ ] **Step 3: Run jest**

Run: `npm test -- --testPathPattern='results/ResultPanel'`
Expected: PASS.

If a test was asserting on the old tab-strip DOM (e.g. `getByRole('tab', { name: 'Graph' })`), WA tabs may not expose `role="tab"` by default — switch to `getByTestId('result-tab-graph')`.

Run: `npm test`
Expected: ALL pass.

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/results/ResultPanel.tsx
git commit -m "feat(result): migrate result tabs to wa-tab-group"
```

### Task 5: LoginPage buttons + inputs → `<wa-button>` and `<Input>`

**Files:**
- Modify: `src/pages/LoginPage.tsx` (or wherever the login form lives — verify)

- [ ] **Step 1: Inspect the login surface**

Read `src/pages/LoginPage.tsx`. Find: sign-in button, profile-pick buttons (list of clickable `<button>`s), username input, password input, optional profile fallback `<input>`.

- [ ] **Step 2: Migrate the buttons**

Sign-in button:

```tsx
<wa-button
  appearance="filled"
  variant="brand"
  size="medium"
  type="submit"
  data-testid="login-submit-btn"
  disabled={submitting}
  onClick={onSubmit}
>
  {t('login.submit')}
</wa-button>
```

Profile-pick buttons:

```tsx
<wa-button
  appearance="outlined"
  size="medium"
  data-testid={`login-profile-${profile.id}`}
  onClick={() => onPickProfile(profile.id)}
>
  {profile.name}
</wa-button>
```

- [ ] **Step 3: Migrate the inputs**

Add the import:

```ts
import { Input } from '../services/webawesome/components'
```

Username + password + profile fallback `<input>`s → `<Input>`. The wrapper forwards `onWaChange` and `onWaInput`. For controlled forms with React state, use `onWaInput` (fires per keystroke):

```tsx
<Input
  type="text"
  label={t('login.usernameLabel')}
  data-testid="login-username"
  value={username}
  onWaInput={(e) => setUsername((e.target as HTMLInputElement).value)}
  required
/>

<Input
  type="password"
  label={t('login.passwordLabel')}
  data-testid="login-password"
  value={password}
  onWaInput={(e) => setPassword((e.target as HTMLInputElement).value)}
  required
/>
```

(Adjust the prop names to match the existing component's state — `username`, `password`, `setUsername`, etc.)

NOTE: WA inputs use `value` (controlled) or `defaultValue` (uncontrolled). The `wa-input` event detail's `target` is the wa-input host; reading `.value` from it gives the current string.

- [ ] **Step 4: Run jest**

Run: `npm test -- --testPathPattern='pages/LoginPage|LoginPage'`
Expected: PASS. If tests use `getByLabelText('Username')`, that requires the `label` prop on `<Input>` (already set above). If tests use `getByPlaceholderText`, set `placeholder` instead.

Run: `npm test`
Expected: ALL pass.

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/LoginPage.tsx
git commit -m "feat(login): migrate buttons + inputs to wa-button + Input wrapper"
```

### Task 6: GraphInspector action buttons → `<wa-button>`

**Files:**
- Modify: `src/components/results/graph/GraphInspector.tsx`

- [ ] **Step 1: Locate the inspector buttons**

Read `src/components/results/graph/GraphInspector.tsx`. The inspector renders action buttons for the selected node: Hide, Collapse, Explore neighbours, Pin/Unpin, Focus, Clear focus. Plus per-neighbor chip-buttons in the neighbors list. Plus the inspector-view toggles (Properties/JSON).

- [ ] **Step 2: Migrate the action buttons**

For each action button (Hide, Collapse, Explore, Pin, Focus, etc.):

```tsx
<wa-button
  appearance="outlined"
  size="small"
  data-testid="graph-action-hide"
  onClick={() => onHide(id)}
>
  {t('graph.actionHide')}
</wa-button>
```

For toggle-state buttons (Pin/Unpin, Focus/Clear focus):

```tsx
<wa-button
  appearance={isPinned ? 'filled' : 'outlined'}
  size="small"
  aria-pressed={isPinned ? 'true' : 'false'}
  data-testid="graph-action-pin"
  onClick={() => onPin(id)}
>
  {isPinned ? t('graph.menuUnpin') : t('graph.menuPin')}
</wa-button>
```

For the inspector-view segmented control (Properties/JSON):

```tsx
<wa-button
  appearance={view === 'props' ? 'filled' : 'outlined'}
  size="small"
  data-testid="graph-inspector-view-props"
  aria-pressed={view === 'props' ? 'true' : 'false'}
  onClick={() => onSetView('props')}
>
  {t('graph.inspectorViewProps')}
</wa-button>
```

(Same for the JSON option.)

For neighbor chips, keep them as `<wa-button appearance="plain" size="small">` to match the chip look-and-feel.

- [ ] **Step 3: Run jest**

Run: `npm test -- --testPathPattern='graph/GraphInspector|results/GraphView'`
Expected: PASS.

Run: `npm test`
Expected: ALL pass.

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/results/graph/GraphInspector.tsx
git commit -m "feat(graph): migrate inspector action buttons to wa-button"
```

### Task 7: ExpandQueryPopover → `<Dialog>` + `<Input>` + `<Select>`

**Files:**
- Modify: `src/components/results/graph/ExpandQueryPopover.tsx`

- [ ] **Step 1: Inspect the popover**

Read `src/components/results/graph/ExpandQueryPopover.tsx`. It's currently a styled-components modal with a custom backdrop, direction radios, label-filter `<select>`, limit `<input type="number">`, Run + Cancel buttons.

- [ ] **Step 2: Migrate the shell to `<Dialog>`**

Add imports:

```ts
import { Dialog, Input, Select, Option } from '../../../services/webawesome/components'
```

Replace the existing modal shell:

```tsx
<Dialog
  open={open}
  label={t('graph.expandTitle', { id: nodeId })}
  data-testid="graph-expand-popover"
  onWaAfterHide={onCancel}
>
  {/* …existing direction radios stay as native radios… */}

  <Select
    label={t('graph.expandLabelFilter')}
    data-testid="graph-expand-label-filter"
    value={labelFilter}
    onWaChange={(e) => setLabelFilter((e.target as HTMLSelectElement).value)}
  >
    <Option value="">{t('graph.expandLabelAny')}</Option>
    {labelOptions.map((l) => (
      <Option key={l} value={l}>{l}</Option>
    ))}
  </Select>

  <Input
    type="number"
    label={t('graph.expandLimit')}
    data-testid="graph-expand-limit"
    value={limit}
    onWaInput={(e) => setLimit((e.target as HTMLInputElement).value)}
    min={1}
    max={10000}
  />

  <pre data-testid="graph-expand-preview">{preview}</pre>

  <wa-button
    slot="footer"
    appearance="plain"
    size="medium"
    data-testid="graph-expand-cancel"
    onClick={onCancel}
  >
    {t('graph.expandCancel')}
  </wa-button>

  <wa-button
    slot="footer"
    appearance="filled"
    variant="brand"
    size="medium"
    data-testid="graph-expand-run"
    disabled={runDisabled}
    onClick={() => onRun({
      direction,
      labelFilter: labelFilter || undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 100,
    })}
  >
    {t('graph.expandRun')}
  </wa-button>
</Dialog>
```

Key details:
- `<Dialog>` controls its own backdrop + portal — no `createPortal` needed.
- `slot="footer"` places the action buttons in WA's dialog footer slot.
- `onWaAfterHide` fires when the user closes via Escape or backdrop click — wire it to `onCancel` so the parent's `expandFor` state clears.
- The direction radio group stays as native radios (`<input type="radio">`) since WA's radio components aren't being introduced in this plan.

- [ ] **Step 3: Run jest**

Run: `npm test -- --testPathPattern='graph/ExpandQueryPopover|results/GraphView'`
Expected: PASS.

The existing test asserts the popover renders + Run/Cancel fire. If a test queried via a styled-components selector that's no longer present (e.g. `.Modal`), update to `data-testid="graph-expand-popover"`.

Run: `npm test`
Expected: ALL pass.

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/results/graph/ExpandQueryPopover.tsx
git commit -m "feat(graph): migrate ExpandQueryPopover to wa-dialog + Input + Select"
```

### Task 8: FindNodeInput → `<Input type="search">`

**Files:**
- Modify: `src/components/results/graph/FindNodeInput.tsx`

- [ ] **Step 1: Inspect FindNodeInput**

Read `src/components/results/graph/FindNodeInput.tsx`. It's a small toolbar component with `<input type="search">` + a match-count span.

- [ ] **Step 2: Replace the input**

Add the import:

```ts
import { Input } from '../../../services/webawesome/components'
```

Replace the `<input>` element:

```tsx
<Input
  type="search"
  size="small"
  data-testid="graph-find-input"
  placeholder={t('graph.findPlaceholder')}
  aria-label={t('graph.findAria')}
  value={q}
  onWaInput={(e) => setQ((e.target as HTMLInputElement).value)}
  onKeyDown={onKey}
  clearable
/>
```

The `clearable` prop adds a native clear-X button to the WA input — a nice UX bump.

The `onKey` handler still works because `keydown` is a standard event (not a WA custom event).

- [ ] **Step 3: Run jest**

Run: `npm test -- --testPathPattern='graph/FindNodeInput'`
Expected: PASS.

If a test uses `fireEvent.change` on the input, it'll fire the native `change` event NOT `wa-input`. The wrapper translates differently — if tests break, switch them to:

```ts
fireEvent.input(screen.getByTestId('graph-find-input'), { target: { value: 'Movie' } })
```

OR drive the underlying state directly via the controlled `value` prop's parent.

Run: `npm test`
Expected: ALL pass.

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/results/graph/FindNodeInput.tsx
git commit -m "feat(graph): migrate FindNodeInput to wa-input"
```

### Task 9: ConnectionSwitcher trigger → `<wa-button>`

**Files:**
- Modify: `src/components/layout/ConnectionSwitcher.tsx`

- [ ] **Step 1: Inspect the connection switcher**

Read `src/components/layout/ConnectionSwitcher.tsx`. It's a dropdown menu where the trigger is a `<button>` and the menu items are also `<button>`s with `role="menuitemradio"`.

- [ ] **Step 2: Migrate the trigger only**

The trigger button → `<wa-button appearance="outlined" size="small">`. Keep all the existing `aria-haspopup`, `aria-expanded`, `data-testid`, `onClick`, `aria-label` attributes.

```tsx
<wa-button
  appearance="outlined"
  size="small"
  data-testid="connection-trigger"
  aria-haspopup="menu"
  aria-expanded={open ? 'true' : 'false'}
  onClick={onToggle}
>
  {activeProfile?.name ?? t('connection.none')}
</wa-button>
```

The menu items (the `<button role="menuitemradio">` list) stay as native buttons for now — `<wa-dropdown>` / `<wa-menu>` migration is a follow-up plan.

- [ ] **Step 3: Run jest**

Run: `npm test -- --testPathPattern='layout/ConnectionSwitcher'`
Expected: PASS.

Run: `npm test`
Expected: ALL pass.

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/ConnectionSwitcher.tsx
git commit -m "feat(layout): migrate ConnectionSwitcher trigger to wa-button"
```

---

## Phase 3 — End-to-end validation

### Task 10: Rebuild geode-ui + run full e2e

**Files:** none modified — verification only.

- [ ] **Step 1: Rebuild the geode-ui container**

```bash
docker compose -f deploy/docker-compose.test.yml build geode-ui
docker compose -f deploy/docker-compose.test.yml up -d geode-ui
until wget -qO- http://localhost:8080/healthz 2>/dev/null | grep -q ok; do sleep 2; done
```

Expected: build succeeds, container healthy.

- [ ] **Step 2: Open the UI in a browser (manual smoke)**

Visit `http://localhost:8080`. Verify:
- Login page renders WA-styled inputs + button.
- After login, the query page shows WA Run/Cancel buttons.
- The result panel's tabs (Table/Graph/Matrix/JSON) are WA-styled.
- The graph toolbar buttons (already migrated in the spike) are visible (no longer invisible).
- Right-clicking a node opens the radial cxtmenu with readable text on light theme.
- Right-clicking → Expand opens a WA dialog with WA inputs.
- The find-node input is WA-styled with a clearable X.

Manual confirmation is a SANITY check — the real assertions live in e2e.

- [ ] **Step 3: Run the full e2e suite**

```bash
npx playwright test --config=e2e/playwright.config.ts --reporter=list
```

Expected: all pass. Pre-existing flakes (e.g. `12-multi-request.spec.ts`) are acceptable.

If a spec fails because a `getByRole('button', ...)` query no longer matches a migrated `<wa-button>`:
- Switch the query to `getByTestId(...)`.
- OR add `role="button"` explicitly on the WA element.

Document any selector updates in the commit message.

- [ ] **Step 4: Run jest + tsc + lint**

```bash
npm test && npx tsc --noEmit && npm run lint
```

Expected: ALL green.

- [ ] **Step 5: Commit any small selector adjustments**

If e2e specs needed minor updates:

```bash
git add e2e/specs/...
git commit -m "test(e2e): align selectors with migrated wa-button surfaces"
```

If nothing changed, skip the commit step.

- [ ] **Step 6: Add a visibility regression test**

Append to `e2e/specs/24-graph-power-features.spec.ts`:

```ts
test('wa-button renders with non-zero size after foundation CSS load', async ({
  authedPage: page,
}) => {
  // The toolbar contains multiple wa-button instances. If the foundation
  // CSS isn't loaded, they render as unstyled custom elements with
  // collapsed bounding boxes. Verify at least one toolbar button has
  // a positive bounding box.
  const button = page.getByTestId('graph-zoom-in')
  await expect(button).toBeVisible()
  const box = await button.boundingBox()
  expect(box).not.toBeNull()
  expect((box?.width ?? 0)).toBeGreaterThan(8)
  expect((box?.height ?? 0)).toBeGreaterThan(8)
})
```

Run: `npx playwright test --config=e2e/playwright.config.ts e2e/specs/24-graph-power-features.spec.ts --reporter=list`
Expected: PASS.

```bash
git add e2e/specs/24-graph-power-features.spec.ts
git commit -m "test(e2e): assert wa-button has non-zero bounding box (visibility regression)"
```

---

## Self-Review Notes

- **The visibility fix in Task 1 is the most impactful single change.** Without the foundation CSS import, every WA component renders invisible — the entire prior spike was non-functional in production.
- **`@lit/react` wrappers handle the React-18 custom-event gap.** For components that fire only standard events (button → click), bare custom elements are fine and stay as `<wa-button>`. For components that fire WA custom events, use the wrappers exported from `src/services/webawesome/components.ts`.
- **Buttons stay as bare custom elements** for simplicity + tighter HTML — they only need `onClick`, which React 18 forwards natively for any custom element.
- **Dialogs replace styled-components modals** — `<Dialog>` brings backdrop, focus trap, Escape-to-close, and ARIA wiring for free.
- **Tab-group replaces hand-built tab strips** — meaningful visual upgrade with built-in keyboard navigation.
- **Tests transitioning from `getByRole('button')` to `getByTestId`** is the recurring lesson from the spike. The playbook (Task 9 of the prior plan) already calls this out.
- **No new dependencies** — `@lit/react` is already a transitive dep of `@awesome.me/webawesome`.

---

Plan complete. Total: 10 tasks across 3 phases. TDD where applicable; visual confirmation via e2e and a rebuilt container.
