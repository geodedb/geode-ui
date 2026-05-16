# Geode UI — Theme, Responsiveness, Styling Audit

**Date:** 2026-05-08
**Branch:** main @ `99ab113`
**Scope:** UI layer of `geode-ui` only. Backend, perf, and security domains intentionally out of scope.
**Baselines:**

- **Component patterns / theming / responsiveness:** `~/src/devnw/react/components` (`@devnw/components`)
- **Brand colors / typography / visual identity:** `../geodedb.com` (Hugo "ultra" theme)

## Status — 2026-05-08

All five phases of the remediation roadmap below have shipped. The
top ten findings now read:

| Phase | Status | Commit |
|-------|--------|--------|
| 1 — Theme foundation (light + dark, brand fonts) | ✅ shipped | `f83dd8c` |
| 2 — UI primitives (Button/Input/Field/DataTable/Modal/Stack) | ✅ shipped | `30f34de` + `5874d46` |
| 3 — Responsiveness (Shell drawer, GraphView stack, mobile/tablet projects) | ✅ shipped | `acf1a95` |
| 4 — A11y polish + theme enforcement scripts | ✅ shipped | `99468b1` |
| 5 — Electron desktop packaging | ✅ shipped | `0dc9199` |

Verification: 102/102 jest tests, tsc clean, eslint + prettier clean,
production webpack build emits all six brand woff2 assets,
`npm run lint:hardcoded-styles` returns zero hits, `npm run lint:contrast`
shows all 14 theme pairs ≥ WCAG AA in both modes.

> **TL;DR.** The UI is built on a clean styled-components v6 foundation, but it is **not aligned with either baseline**. Three structural problems dominate: (a) the palette is unrelated to the geodedb.com brand — primary `#1a56db` blue vs. brand `#601ca0` purple; (b) the app contains **zero `@media` queries** and is unusable below ~800 px viewport; (c) styling is duplicated per-page rather than centralized into shared primitives — 19 separate `styled.button` definitions, six `styled.table` re-implementations, ~69 production-code hex literals outside the theme. Light mode does not exist.

---

## 1. Repository Snapshot

| Property | Value |
|----------|-------|
| Framework | React 18 + TypeScript |
| Styling | styled-components v6 (exclusive — no Tailwind/CSS modules) |
| Theme provider | `App.tsx:64` (single `ThemeProvider`) |
| Theme tokens declared | `App.tsx:21–37` + `styled.d.ts:4–20` |
| Component dirs | `admin/`, `editor/`, `layout/`, `ops/`, `results/`, `schema/` |
| `.tsx` files | ~40 |
| `styled.*` declarations | ~97 |
| Viewport meta | present (`src/index.html:5`) |
| Light/dark toggle | none |
| `@media` query count | **0** |

---

## 2. Domain Results

### 2.1 Theme & Brand Alignment — **HIGH**

**Current tokens** (`App.tsx:21–37`):

```text
primary:       #1a56db   (blue)
background:    #0f172a   (slate-900)
surface:       #1e293b   (slate-800)
text:          #e2e8f0   (slate-200)
textSecondary: #94a3b8   (slate-400)
border:        #334155   (slate-700)

spacing.xs/sm/md/lg/xl = 4 / 8 / 16 / 24 / 32 px
```

**Brand tokens** (geodedb.com `assets/scss/_site-vars.scss`):

```text
primary:       #601ca0   (deep purple)
secondary:     #96929b
tertiary:      #b17bf6   (light purple)
body bg light: #f7f2ff
body bg dark:  #35046b
text primary:  #2a1f3a
text muted:    #7a7285
success/danger/warning/info: #6521b5 / #7420c8 / #b988f7 / #853bd5
```

**Baseline shape** (`@devnw/components` `src/theme/types.ts:12–137`):

The `ExtendedTheme` interface defines **eleven token groups** the geode-ui theme is missing entirely:
`text.{primary,secondary,muted,inverse,link}`, `bg.{canvas,surface,subtle,inverse}`, `font.{family,sizes,lineHeights,headings}`, `breakpoints`, `button.{bg,color,hover,active,disabled}`, `input.{bg,color,placeholder,border,focus,invalid}`, `icons`, `boxShadow`, `zIndex`, `transitions`, plus a `variant: "light" | "dark"` discriminator.

**Findings:**

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| THEME-01 | **High** | Primary color is unrelated to brand. Geode brand is purple (`#601ca0`); app is blue (`#1a56db`). Same applies to surface/background — slate vs. lavender/deep-purple. | `App.tsx:23` vs. `_site-vars.scss:15` |
| THEME-02 | **High** | No `text.*`, `bg.*`, `font.*`, `breakpoints`, `button`, `input`, `boxShadow`, `zIndex`, `transitions`, or semantic (success/warn/error) tokens. `~69` production hex literals live outside the theme as a result. | `App.tsx:21–37`; `grep -rEn '#[0-9a-fA-F]{3,8}' src/` (105 hits, ~36 in test fixtures) |
| THEME-03 | **High** | Status colors (`#ef4444`, `#10b981`) are inlined in components instead of being `theme.colors.danger / success`. Inconsistent across pages. | `SchemaExplorer.tsx:89`, `MigrationsPage.tsx:135,140`, `QueryPage.tsx:54`, `LoginPage.tsx:50` |
| THEME-04 | **High** | No light-mode theme. The app is hardcoded to a dark slate palette while the brand site supports light/dark via `data-bs-theme`. | `App.tsx:21` |
| THEME-05 | Medium | Spacing scale is `xs/sm/md/lg/xl` only — missing `xxs` and `xxl` that both the brand 8 px grid (`_design-system.scss:18–29`) and `@devnw/components` (`types.ts:67`) use. | `App.tsx:30–36` |
| THEME-06 | Medium | No font tokens. Brand uses Sora (display) + IBM Plex Mono (code); app inherits the system stack and doesn't load brand fonts. Monaco still uses `vs-dark`. | `index.html:1–20`, `GqlEditor.tsx:28` |
| THEME-07 | Medium | No radius / shadow / transition / z-index tokens. Each page reinvents these inline. | `App.tsx:21–37` |
| THEME-08 | Low | Theme typing (`styled.d.ts`) doesn't enforce a `variant` discriminator, so a future light theme can't be type-checked. | `styled.d.ts:4–20` |

---

### 2.2 Responsiveness, Mobile & Tablet — **CRITICAL**

The app declares the viewport meta tag but contains **no responsive design**. `grep -rn '@media' src/` returns **0 hits**. Every multi-column layout uses fixed-pixel grid tracks that overflow or collapse on small viewports:

| Layout | Track template | Smallest usable viewport |
|--------|----------------|--------------------------|
| `GraphView` (`GraphView.tsx:35–39`) | `1fr 280px` (canvas + sidebar) | ~640 px before canvas vanishes |
| `SchemaExplorer` (`SchemaExplorer.tsx:19–24`) | `200px 1fr 1fr` (3-pane) | ~800 px before horizontal scroll |
| `Shell` nav (`Shell.tsx:8–14`) | flex row, no collapse | links wrap into 3+ rows on mobile |
| `LoginPage` (`LoginPage.tsx:6–7`) | `max-width: 320px`, centered | works on mobile by accident |

**Baseline pattern** (`@devnw/components`):

- Named breakpoints `xs / sm / md / lg / xl / xxl` baked into `theme.breakpoints` (`types.ts:68`); typical values `0 / 576 / 768 / 992 / 1200 / 1400`.
- `Container` primitive owns the responsive rules (`Container.tsx:19–25`):

  ```ts
  @media (max-width:${md}px) { padding: theme.spacing.sm; }
  @media (max-width:${sm}px) { padding: theme.spacing.xs; }
  ```

- React Native sibling exposes `theme.touchTargets = { min:44, comfortable:48, large:56 }` — applied to every interactive primitive.

**Findings:**

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| RESP-01 | **Critical** | No breakpoints defined and zero `@media` queries in `src/`. App is desktop-only. | `grep '@media' src/` returns nothing |
| RESP-02 | **Critical** | `GraphView` uses `grid-template-columns: 1fr 280px`; the canvas collapses to ~0 px on mobile because the sidebar is fixed 280 px and there is no stacking rule. | `GraphView.tsx:35–39` |
| RESP-03 | **Critical** | `SchemaExplorer` uses `grid-template-columns: 200px 1fr 1fr` with no `flex-direction: column` fallback. | `SchemaExplorer.tsx:19–24` |
| RESP-04 | **High** | No drawer / hamburger pattern. `Shell` nav is 4 links + connection picker + logout in a flex row; this exceeds a 375 px viewport horizontally. | `Shell.tsx:8–14` |
| RESP-05 | **High** | Touch targets not enforced. Buttons inherit ad-hoc padding (often `4px 8px`) far below the 44 pt WCAG / `theme.touchTargets.min` baseline. | `MigrationsPage.tsx:84+`, `RolesPage.tsx:71+`, others |
| RESP-06 | High | `TableView` virtualized rows use `width: 100%` but column widths are content-driven without min-width or `overflow: hidden + text-overflow: ellipsis` — long IDs blow out the layout on narrow widths. | `TableView.tsx:33–68` |
| RESP-07 | Medium | No tablet-specific breakpoints. The app's natural break is "desktop or broken"; nothing addresses 600–1024 px. | structural |
| RESP-08 | Medium | `LoginPage` works on mobile by virtue of being 320 px max-width, but inputs and the submit button still lack 44 pt min-height. | `LoginPage.tsx:6–55` |

---

### 2.3 Component System & Styling — **HIGH**

geode-ui has no shared primitive layer. Every page builds its Buttons, Tables, Forms, and Selects from scratch via `styled.*`.

**Quantified duplication** (verified counts):

| Primitive | `styled.*` occurrences | Files affected |
|-----------|------------------------|----------------|
| `styled.button` | **19** | 13 |
| `styled.table` | 6 | `admin/{Users,Roles,Policies}Page`, `ops/{Backup,Migrations,AuditLog}Page` |
| `styled.td` (named `Empty`) | 6 | same as above |
| `styled.label` (named `Field`) | 4 | `LoginPage`, `RestorePage`, `AuditLogPage`, `GrantsPanel` |
| `styled.form` / `styled.select` / `styled.input` | several | scattered |

This means:

- Six "new record" buttons (`NewBtn` in `UsersPage:44`, `RolesPage:39`, `PoliciesPage:38`, `BackupPage:44`, `MigrationsPage:52`, plus `LoginPage:36 Button`) all do the same thing with subtly different hover/disabled rules.
- Six row-action buttons (`RowBtn` in the same admin/ops pages) likewise.
- Six admin/ops tables re-implement the same table chrome.

**Baseline pattern** (`@devnw/components`):

- One `Button` component with `variant`, `size`, `primary?`, `disabled` props (`src/components/base/Button.tsx:9–19`).
- Single source of truth per primitive; variants are props, **not new components**.
- `guard:hardcoded-styles` script enforces zero hex literals outside the theme; pre-commit hook blocks regressions.
- `audit:overlap`, `audit:contrast`, `audit:theme-props` scripts are wired into `husky`.

**Findings:**

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| COMP-01 | **High** | No `Button` primitive. 19 `styled.button` declarations diverge in padding, hover, focus, and disabled states. | `grep -rEn 'styled\.button' src/` |
| COMP-02 | **High** | No `Table` primitive. Six admin/ops pages reproduce the same `<table>` chrome with minor drift. | `Users/Roles/Policies/Backup/Migrations/AuditLog Page.tsx` |
| COMP-03 | **High** | No `Field` / form-row primitive. Form-label styling forked across 4 files. | `LoginPage.tsx:22`, `RestorePage.tsx:27`, `AuditLogPage.tsx:45`, `GrantsPanel.tsx:25` |
| COMP-04 | High | No `Modal`, `Dialog`, `Toast`, `Drawer`, or `Tooltip` primitives. Admin pages perform inline state+overlay patterns that lack focus traps. | repo-wide search (none found) |
| COMP-05 | Medium | No barrel-exported design system. Shared primitives could live under `src/components/ui/` and re-export through `src/components/ui/index.ts`. | `src/components/` has no `ui/` dir |
| COMP-06 | Medium | No Storybook or component playground. The baseline ships CSF stories for every component (see `Avatar.stories.tsx`). | `package.json` has no Storybook deps |
| COMP-07 | Medium | No `guard:hardcoded-styles` or `audit:contrast` script. Brand drift is unenforced. | `package.json` |
| COMP-08 | Low | Inconsistent transient-prop usage. Some files use the `$active` convention (good — `SchemaExplorer.tsx:61`); others would benefit from the same. | mixed |

---

### 2.4 Accessibility — **MEDIUM**

Foundation is there but uneven.

**Present:**

- Viewport meta (`index.html:5`).
- ARIA roles on `TableView` (`role="grid" / "row" / "columnheader" / "cell"` — `TableView.tsx:33–80`).
- `aria-label` on `ConnectionPicker` select (`ConnectionPicker.tsx:86`) and per-label/edge-type display selectors in `GraphView`.
- `role="tablist"` on `QueryPage` tabs (`QueryPage.tsx`).

**Missing or partial:**

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| A11Y-01 | High | `QueryPage` tablist has `role="tablist"` but tab buttons have no `role="tab"` or `aria-selected`. Screen readers can't navigate the tab group. | `QueryPage.tsx:45,61` |
| A11Y-02 | High | No skip-link in `Shell`. Keyboard users must tab through every nav link to reach main content. | `Shell.tsx`, `index.html` |
| A11Y-03 | High | Touch targets often `<44px` (see RESP-05) — fails WCAG 2.5.5 / 2.1.5. | `RowBtn` styles |
| A11Y-04 | Medium | No `:focus-visible` outline customization; default browser ring may be invisible against `#1e293b` surface for some users. Brand uses `outline: 2px solid var(--color-primary-500)` in `_design-system.scss:377–381`. | App-wide CSS |
| A11Y-05 | Medium | No contrast verification step. `#94a3b8` text on `#1e293b` surface measures 6.6:1 (AA pass) but ad-hoc colors elsewhere are unverified. Brand site builds on `audit:contrast` enforcement. | structural |
| A11Y-06 | Medium | `GraphView` controls (selects, buttons) lack consistent `aria-label` coverage. Some labelled, others not. | `GraphView.tsx` |
| A11Y-07 | Low | `JsonView` uses hardcoded GitHub-dark palette (`results/JsonView.tsx`) — reduced color blindness consideration vs. theme-driven syntax tokens. | `JsonView.tsx` |
| A11Y-08 | Low | No `prefers-reduced-motion` handling. Brand `_design-system.scss` defines transitions but the app has none, so this is preventative. | n/a |

---

## 3. Top Findings (cross-domain, ranked)

Severity is tier-based; "Score" is `Severity × Reach × Effort-to-fix-inverse` on a 1–10 scale where 10 = highest priority.

| # | ID | Domain | Finding | Severity | Score |
|---|----|--------|---------|----------|-------|
| 1 | RESP-01 | Responsiveness | Zero `@media` queries; app unusable <800 px | Critical | **9.5** |
| 2 | RESP-02 | Responsiveness | `GraphView` 1fr+280px sidebar collapses canvas on mobile | Critical | **9.0** |
| 3 | RESP-03 | Responsiveness | `SchemaExplorer` 3-pane fixed grid overflows tablets | Critical | **8.8** |
| 4 | THEME-01 | Theme | Primary palette is unrelated to brand (blue vs. brand purple) | High | **8.5** |
| 5 | COMP-01 | Components | 19 forked `styled.button` definitions; no shared `Button` primitive | High | **8.0** |
| 6 | THEME-04 | Theme | No light-mode theme — brand site is dual-mode | High | **7.5** |
| 7 | THEME-02 | Theme | ~69 hardcoded hex literals outside the theme; no enforcement | High | **7.5** |
| 8 | COMP-02 | Components | Six duplicated admin/ops table implementations | High | **7.0** |
| 9 | RESP-04 | Responsiveness | No drawer/hamburger; `Shell` nav exceeds mobile width | High | **6.8** |
| 10 | A11Y-01 | Accessibility | Tab buttons missing `role="tab"` / `aria-selected` | High | **6.5** |

---

## 4. Recommended Remediation Roadmap

The findings cluster into four shippable workstreams. Each is independently mergeable and unblocks the next.

### Phase 1 — Theme foundation (1 PR, ~1–2 days)

1. **Replace `Theme` interface in `styled.d.ts`** with a shape closer to `@devnw/components`'s `ExtendedTheme`:
   - `variant: 'light' | 'dark'`
   - `colors: { primary, secondary, tertiary, success, warning, danger, info }`
   - `text: { primary, secondary, muted, inverse }`
   - `bg: { canvas, surface, subtle, inverse }`
   - `font: { family: { display, body, mono }, sizes, weights, lineHeights }`
   - `spacing: { xxs, xs, sm, md, lg, xl, xxl }`
   - `breakpoints: { xs:0, sm:576, md:768, lg:992, xl:1200, xxl:1400 }`
   - `radii`, `shadows`, `transitions`, `zIndex`, `touchTargets: { min:44, comfortable:48, large:56 }`
2. **Author `theme/light.ts` and `theme/dark.ts`** seeded with the geodedb.com brand palette (`#601ca0` primary, `#f7f2ff` / `#35046b` canvases, `#2a1f3a` text). Wire a toggle into the user menu; default to `prefers-color-scheme`.
3. **Load Sora + IBM Plex Mono** via `@font-face` rules in the global style block; switch Monaco to a custom theme that consumes brand tokens.
4. **Delete the 6 dark hex literals in `App.tsx`**; eliminate per-page hex literals via a single `npm run lint:hardcoded-styles` script (port from `@devnw/components` `guard:hardcoded-styles`).

### Phase 2 — UI primitives (1–2 PRs, ~2–3 days)

Create `src/components/ui/` with single-source primitives consumed by every page:

| Primitive | Replaces | Notes |
|-----------|----------|-------|
| `<Button variant size loading disabled>` | the 19 `styled.button` instances | min-height 44 px |
| `<DataTable>` | the 6 admin/ops `styled.table`s | fixed header, `overflow:auto` |
| `<Field label hint error>` | the 4 form `styled.label`s | wraps `Input` / `Select` |
| `<Input>`, `<Select>`, `<Textarea>` | scattered raw inputs | brand focus ring |
| `<Modal>`, `<Drawer>` (with focus trap) | currently absent | required for COMP-04 |
| `<Stack>`, `<Inline>`, `<Container>` | inline `display: flex` repetition | uses `theme.spacing` |

Run a sweep PR to replace duplicates page-by-page; existing E2E tests (`e2e/specs/03–09`) provide the regression net.

### Phase 3 — Responsiveness (1 PR, ~2 days)

1. Add a `bp(key)` helper in `src/lib/breakpoints.ts` that emits `@media (max-width: ${theme.breakpoints[key]}px)` strings.
2. Convert each fixed-pixel grid:
   - `GraphView` → `grid-template-columns: 1fr` below `md`, with sidebar drawer triggered by a hamburger.
   - `SchemaExplorer` → stack the three panes vertically below `lg`.
   - `Shell` → collapse nav into a hamburger drawer below `md`.
3. Enforce 44 pt min-height on all interactive primitives via the `<Button>` primitive.
4. Add a Playwright project to `playwright.config.ts` that runs the existing specs at iPhone 12 (390 × 844) and iPad (1024 × 768) viewports.

### Phase 4 — Accessibility & enforcement (1 PR, ~1 day)

1. Add `role="tab"` + `aria-selected` to `QueryPage` tabs.
2. Add a skip-link to `Shell`.
3. Customize `:focus-visible` to a brand-purple outline.
4. Port `audit:contrast` from `@devnw/components` and run it against the new theme tokens in CI.
5. Add `prefers-reduced-motion` short-circuits to any new transitions added in Phase 2.

---

## 5. Out of Scope / Won't-do (this audit)

- **Backend, perf, security**: tracked separately under `GAP_ANALYSIS.md`, `PERF_GAP_ANALYSIS.md`, `SECURITY_GAP_ANALYSIS.md`.
- **Cytoscape graph styling beyond brand color tokens**: the canvas itself uses Cytoscape's stylesheet language (`results/cytoscapeStyle.ts`); a deeper visual refresh would happen after Phase 1 lands brand colors.
- **Storybook adoption** (COMP-06): captured as a finding but not in the 4-phase roadmap; revisit after primitives ship.
- **Mobile-native shell** (e.g., Capacitor wrapper): not a current product goal.

---

## 6. Reference Index

| File | Purpose | Lines cited |
|------|---------|-------------|
| `src/App.tsx` | Theme object, global CSS | 21–37, 39–55, 64 |
| `src/styled.d.ts` | Theme typing | 4–20 |
| `src/index.html` | Viewport meta | 5 |
| `src/components/layout/Shell.tsx` | App nav | 8–14, 33+ |
| `src/components/results/GraphView.tsx` | Graph canvas + sidebar | 35–39, 40+ |
| `src/components/results/TableView.tsx` | Virtualized data grid | 33–80 |
| `src/components/schema/SchemaExplorer.tsx` | 3-pane layout | 19–24, 61, 89 |
| `src/pages/LoginPage.tsx` | Form pattern | 6–55 |
| `src/pages/QueryPage.tsx` | Tabs, run button | 26, 45, 54, 61 |
| `src/components/admin/{Users,Roles,Policies}Page.tsx` | Admin tables | 38–129 |
| `src/components/ops/{Backup,Restore,Migrations,AuditLog}Page.tsx` | Ops tables | 27–144 |
| `~/src/devnw/react/components/src/theme/types.ts` | `ExtendedTheme` baseline | 12–137 |
| `~/src/devnw/react/components/src/theme/SpyderTheme.ts` | RN theme + touch targets | 6–162 |
| `~/src/devnw/react/components/src/components/layout/Container.tsx` | Responsive Container | 19–25 |
| `~/src/devnw/react/components/CLAUDE.md` | Anti-patterns codified | 218, 251–254, 288–295, 338, 488 |
| `../geodedb.com/assets/scss/_site-vars.scss` | Brand color variables | 3–24, 45–78 |
| `../geodedb.com/assets/scss/_design-system.scss` | Tokens, utilities, focus | 18–29, 51–85, 178–278, 332–381 |
| `../geodedb.com/layouts/index.html` | Hero copy / brand voice | 45–54 |

---

*Generated by `/codepros:audit` (UI scope, quality + gap domains only). Issue tracking step skipped per session decision; consolidated findings live in this single document.*
