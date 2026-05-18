# Bootstrap 5.3 + Web Awesome — Migration Guide

Bootstrap 5.3 is now wired into the SPA alongside Web Awesome. Both
frameworks share the same theme tokens through `theme-bridge.ts` so a
`<button class="btn btn-primary">` paints in the same brand color as a
`<wa-button variant="brand">`.

## What's wired

- `bootstrap@5.3.3` and `@popperjs/core@2.11.8` are direct dependencies
  (`package.json`).
- `src/index.tsx` imports `bootstrap/dist/css/bootstrap.min.css` and the
  static override layer at `src/styles/bootstrap-bridge.css`.
- `src/services/webawesome/theme-bridge.ts` emits the full set of
  `--bs-*` CSS variables sourced from the active theme:
  - palette: `--bs-primary`, `--bs-primary-rgb`, `--bs-success`,
    `--bs-warning`, `--bs-danger`, `--bs-info` (and `*-rgb` siblings)
  - surfaces: `--bs-body-bg`, `--bs-body-color`, `--bs-secondary-bg`,
    `--bs-tertiary-bg`, `--bs-emphasis-color`
  - borders + radii: `--bs-border-color`, `--bs-border-radius`,
    `--bs-border-radius-sm`, `--bs-border-radius-lg`
  - typography: `--bs-font-sans-serif`, `--bs-font-monospace`,
    `--bs-body-font-family`, `--bs-body-font-size`
  - focus ring: `--bs-focus-ring-color`
- `src/services/bootstrap/Dropdown.tsx` is the canonical headless
  controlled-dropdown component. We **do not** import Bootstrap's JS
  bundle — Popper.js inflates the entry chunk and the data-bs-toggle
  initialiser races React effects. Use `BootstrapDropdown` instead of
  `bootstrap.Dropdown`.

## Migration pattern

When you reach for a Bootstrap class, decide which layer owns the
concern:

| Concern | Layer | Example |
|---|---|---|
| Layout (flex, grid, gap, spacing) | **Bootstrap utilities** | `class="d-flex flex-column gap-3"` |
| Responsive breakpoints | **Bootstrap utilities** | `class="d-none d-md-flex"` |
| Typography (heading sizes, small/muted text) | **Bootstrap utilities** | `class="small text-muted"` |
| Buttons (filled/outlined/sizes/disabled) | **Web Awesome** `<wa-button>` | `<wa-button variant="brand">` |
| Form inputs | **Web Awesome** `<wa-input>`, `<wa-checkbox>` | `<WaInput>` |
| Dropdowns | **`BootstrapDropdown`** (controlled, no BS JS) | see `GraphToolbar.tsx` |
| Dialogs | **Web Awesome** `<wa-dialog>` | existing modal pattern |
| Theme-token-aware surfaces (cards, surfaces, borders) | **styled-components** with theme tokens | `${({theme}) => theme.bg.surface}` |
| Brand color tints, gradients | **styled-components** | mixing theme.colors with alpha |

### Replacement rule

A styled-component that is **purely layout** (display, flex, grid,
gap, padding, margin) should be replaced with a `<div className="...">`
using Bootstrap utility classes. A styled-component that touches
**theme tokens** (`theme.bg.*`, `theme.text.*`, `theme.border.*`,
`theme.colors.*`, `theme.font.*`) should stay — those tokens live in
JS so they can switch with `data-theme="dark"`, which CSS-only
Bootstrap classes can't do unless the bridge already maps the
`--bs-*` variable.

### Example: LoginPage (canonical)

`src/pages/LoginPage.tsx` is the reference migration:

- `Form` — kept (surface, border, radius, shadow come from theme
  tokens). Bootstrap classes `p-4 d-flex flex-column gap-3` were added
  via `className` to handle the padding + inner flex stack.
- `LogoSlot` — deleted. Replaced with
  `<div className="d-flex justify-content-center mb-3">`.
- `ProfileList` — deleted. Replaced with
  `<ul className="list-unstyled m-0 p-0 d-flex flex-column gap-1">`.
- `ErrText` — deleted. Replaced with
  `<p role="alert" className="text-danger small m-0">`.
- `Title` — kept (font family/size/weight all from theme tokens).
- `ProfileDescription` — kept (`overflow-wrap: anywhere` is
  load-bearing; the equivalent Bootstrap utility `.text-break` would
  shadow the wa-theme color tokens under `data-theme="dark"`).

## Forbidden patterns

- **Do not** import `bootstrap` JS (e.g. `import { Dropdown } from
  'bootstrap'`). Use `BootstrapDropdown` or a controlled React
  alternative. Bootstrap JS races React's effect cycle and bundles
  Popper.js into the entry chunk.
- **Do not** mix Bootstrap form controls (`.form-control`) and
  Web Awesome inputs (`<wa-input>`) on the same form. WA inputs render
  in shadow DOM and Bootstrap classes don't pierce shadow boundaries.
- **Do not** rely on Bootstrap's `data-bs-*` attributes for behavior.
  Drive interactivity through React state.

## Testing notes

The `--bs-*` bridge is unit-tested in
`src/services/webawesome/theme-bridge.test.ts`. Add an assertion when
extending the bridge with a new Bootstrap variable so a future theme
refactor catches a regression instead of producing a silent visual
drift.

The `BootstrapDropdown` accepts options through a typed `items` prop;
spec writers should drive it by clicking the trigger then clicking the
`role=option` row matching the desired label. `e2e/helpers/selectors.ts`
exposes `selectGraphLayout()` and `expectGraphLayoutLabel()` helpers
for the graph layout picker as the canonical pattern.

## Future work

Remaining styled-components that are purely layout can be migrated
incrementally. Search for `display: flex` and `display: grid` in
`src/**/*.ts*` and apply the rule above. Each migration should be a
small atomic PR with the surrounding tests adjusted.
