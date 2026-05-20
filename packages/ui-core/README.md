# @geodedb/ui-core

Reusable presentational primitives and a theme system extracted from the
[geode-ui](https://gitlab.com/devnw/codepros/geode/geode-ui) application.

Live Storybook: <https://devnw.gitlab.io/codepros/geode/geode-ui/>

## Install

```bash
npm install @geodedb/ui-core styled-components
```

`@geodedb/ui-core` declares `react`, `react-dom`, and `styled-components` as
peer dependencies. Your host app provides them.

## Usage

```tsx
import {
  Button,
  Modal,
  ThemeProvider,
  lightTheme,
  darkTheme,
} from '@geodedb/ui-core'
import { ThemeProvider as StyledThemeProvider } from 'styled-components'

// Optional: import the Bootstrap variable bridge if you use Bootstrap 5.3.
import '@geodedb/ui-core/styles/bootstrap-bridge.css'

export function App() {
  return (
    <ThemeProvider>
      <StyledThemeProvider theme={lightTheme}>
        <Button variant="primary">Hello</Button>
      </StyledThemeProvider>
    </ThemeProvider>
  )
}
```

## Components

- **Layout:** `Stack`, `Inline`, `Container`, `Grid`, `Spacer`, `Card`,
  `CardHeader`, `CardTitle`, `CardSubtitle`
- **Forms:** `Button`, `Input`, `Textarea`, `Select`, `Field`,
  `DedupedDatalist`
- **Display:** `Icon`, `Logo`
- **Data:** `DataTable`, `TableScroll`, `EmptyCell`
- **Overlay:** `Modal`, `ConfirmModal`
- **Hooks:** `useUniqueValues`
- **Theme:** `ThemeProvider`, `useThemePreference`, `useThemeActions`,
  `lightTheme`, `darkTheme`, `spacing`, `breakpoints`, `radii`, `font`, etc.

## i18n

`@geodedb/ui-core` is intentionally i18n-agnostic. Components that render
button labels or aria-labels accept those strings as props with English
defaults — e.g. `<Modal closeLabel="Close">`. Wrap them in your app to inject
`t()` results.

## Theming

The light/dark themes are plain objects of the shape exported as `Theme` in
`@geodedb/ui-core`. Override colors by spreading and replacing token values:

```tsx
import { lightTheme, type Theme } from '@geodedb/ui-core'

const brandTheme: Theme = {
  ...lightTheme,
  accent: { ...lightTheme.accent, primary: '#7c3aed' },
}
```

## Development

```bash
# from the repo root
make stories          # boot Storybook dev server on :6006
make stories-build    # build static storybook to packages/ui-core/storybook-static/
make ui-core-build    # build the library to packages/ui-core/dist/
make ui-core-test     # run jest unit tests
```

## Contributing

Each component lives in its own directory under
`packages/ui-core/src/components/<Name>/` with three files:
`<Name>.tsx` (implementation), `<Name>.stories.tsx` (Storybook stories,
CSF3 + autodocs), and `index.ts` (barrel). Tests live as
`<Name>.test.tsx` next to the implementation.

Add new components in their own task on a feature branch — see
`docs/superpowers/plans/` for the canonical extraction pattern.

## License

Apache-2.0. Copyright © devnw.
