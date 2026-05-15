# Web Awesome Migration Playbook

This document describes how to migrate a UI surface from React + styled-components to Web Awesome components, based on lessons from the GraphToolbar spike (plan: `2026-05-14-web-awesome-foundation-and-toolbar-spike.md`).

## Foundation already in place

- `@awesome.me/webawesome@^3.7.0` is installed.
- `src/services/webawesome/index.ts` is the central registration module — import additional components here when migrating new surfaces. Each component module side-effect-registers its custom element via `customElements.define`.
- `src/services/webawesome/ThemeStyleSheet.tsx` is mounted in `src/App.tsx` (inside `<ThemeProvider>`, after `<GlobalStyle />`). It projects our styled-components theme into Web Awesome's CSS custom properties (`--wa-color-*`, etc.). All theme-aware visuals work out of the box.
- `src/services/webawesome/theme-bridge.ts` is the one-place-to-edit for token mappings. Add new mappings when migrations need vars we haven't bridged yet.
- `src/types/awesome-webawesome.d.ts` declares JSX intrinsic types for the components we use. Add new tags here when registering new components.
- `jest.config.cjs` already allows `@awesome.me/webawesome`, `lit`, `lit-html`, `lit-element`, `@lit`, `@floating-ui`, and `@shoelace-style` through the babel transform via `transformIgnorePatterns`. New WA-related packages with raw ESM may need appending to that alternation.

## Migration pattern (per surface)

1. **Pick a small surface** (a single component file or a tight cluster). Avoid migrating partial files — the friction of half-migrated files is high.
2. **Register the WA components** you need by appending imports to `src/services/webawesome/index.ts`. Add JSX type declarations to `src/types/awesome-webawesome.d.ts`.
3. **Replace native elements with WA tags one-for-one** (e.g. `<button>` → `<wa-button>`, `<select>` → `<wa-select>`). Preserve `data-testid`, `aria-*`, `title`, `onClick` attributes. Remove `type="button"` (irrelevant for custom elements).
4. **Map state-to-appearance**: toggle buttons use `appearance="filled"` (pressed) vs `appearance="outlined"` (unpressed). Form controls reflect their own value via the `value` attribute.
5. **For boolean aria-* attributes**, convert to explicit strings: `aria-pressed={isOn ? 'true' : 'false'}`. React 18 serializes booleans automatically for native elements, but being explicit avoids ambiguity at the React/web-components boundary.
6. **For React 18 custom events** (e.g. `wa-change`, `wa-input` on form components), use a ref + `useEffect` + `addEventListener` pattern. Do NOT use `onWaChange={...}` — React 18 doesn't forward custom events that way.
7. **Update tests**: `getByTestId` works unchanged. `getByRole('button', { name })` does NOT match `<wa-button>` because WA buttons don't expose an implicit ARIA role on the host. Switch those tests to `getByTestId` OR add `role="button"` to the WA element explicitly. If a test asserts on tag name (`tagName === 'BUTTON'`), update to `'WA-BUTTON'`.
8. **Run e2e** against a rebuilt container — visual regressions surface here, not in jest.

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

## Styling boundaries (shadow DOM)

Web Awesome components use shadow DOM. styled-components selectors do NOT reach into the shadow root. After migration, the parent surface's nested-CSS rules targeting `button` (or `input`, `select`, etc.) stop applying to the migrated element. Customize via:

1. **CSS custom properties** (preferred) — set `--wa-*` vars on a parent element or globally via the theme bridge (`src/services/webawesome/theme-bridge.ts`).
2. **`::part()` selectors** — many WA components expose internal parts (e.g. `wa-button::part(base)`). Use sparingly; less stable than CSS variables.
3. **Slotted content** — content you put inside `<wa-button>...</wa-button>` is in light DOM, fully styleable by your own styled-components.

The spike's `GraphToolbar` is the canonical example: the surrounding `Toolbar` styled-component's nested `button { ... }` rules no longer affect the migrated buttons. Visual consistency now comes from WA's defaults + the theme bridge.

## Test-pattern lessons from the spike

- `getByTestId(...)` matches the host element of a `<wa-button>` — no rewrite needed.
- `getByRole('button', { name })` does NOT match `<wa-button>` by default. Either:
  - Switch to `getByTestId(...)` (matches the file's existing convention in most cases).
  - Or add `role="button"` to the `<wa-button>` element.
- `toHaveAttribute('aria-pressed', 'true')` (string) works regardless of source — React serializes booleans, but the migrated `<wa-button>` already passes the string explicitly.
- `fireEvent.click(...)` still fires for `<wa-button>` — the WA button forwards the standard `click` event from its internal `<button>`.

## Don't migrate yet

Until React 19 is in place, defer migration of:

- Heavily interactive form controls (`<wa-input>`, `<wa-select>`, `<wa-checkbox>` with custom event handlers).
- Components that pair tightly with styled-components inner styles (popovers / cards / dialogs where you're styling their internals directly).

## Components ready for migration today

- `<wa-button>` — actions and toggles. Done (GraphToolbar spike).
- `<wa-spinner>` — loading indicators.
- `<wa-icon>` — if we move icons to the Web Awesome icon set.
- `<wa-tag>` — chips / badges (Note: our DOM-overlay badges in `GraphBadges` use position:absolute which a WA tag could replace, but the absolute positioning is what's load-bearing — defer).

## Next migrations (suggested order)

1. **App shell buttons** (Run query, Cancel, etc.) — same pattern as toolbar; widens the pattern footprint.
2. **Modal/dialog surfaces** — `<wa-dialog>` for the expand popover, confirmation modals.
3. **Form controls** — only after React 19 upgrade.
