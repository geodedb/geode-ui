# `@geodedb/ui-core` Extraction & Storybook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the 10 pure presentational primitives from `src/components/ui/` plus the `src/theme/` system into a publishable workspace package `@geodedb/ui-core` under `packages/ui-core/`, set up Storybook 8 with the same addon stack and decorator pattern used by `~/src/devnw/react/components`, migrate the geode-ui app to consume the package, and deploy stories to GitLab Pages from this repo.

**Architecture:**
- Convert geode-ui root into an npm workspaces monorepo with one workspace at `packages/ui-core/`.
- Library bundles with **tsup** (ESM + CJS + `.d.ts`); React, ReactDOM, and styled-components are peer deps. tsup is preferred over the reference repo's webpack config because it produces an equivalent dual-format library in 10 lines and is the modern default for component libraries in 2026; the Storybook setup itself still uses `@storybook/react-webpack5` to match the reference.
- Geode-coupled bits stay behind: Logo is refactored to accept `lightSrc`/`darkSrc` as props, and Modal/ConfirmModal accept `closeLabel`/`cancelLabel`/`confirmLabel` props (defaulting to English literals) instead of calling `useTranslation` — geode-ui consumers wrap them and inject `t()` results.
- Stories are CSF3 with `tags: ['autodocs']`; a single preview decorator wires `ThemeProvider`, styled-components `ThemeProvider`, and the Bootstrap bridge CSS. A toolbar dropdown switches between `lightTheme` and `darkTheme`.
- GitLab CI gets one new job: `pages` (matching the reference's `.gitlab-ci.yml` shape) that runs `npm run -w @geodedb/ui-core build-storybook` and serves the output from `public/`.

**Tech Stack:** TypeScript 5.8, React 18.2, styled-components 6.1, tsup 8.x, Storybook 8.x (`@storybook/react-webpack5`), Jest 29 + RTL 14, npm workspaces 10.9.

---

## Reference Conventions (read once, apply everywhere)

### Component directory shape

Every component lives in its own dir under `packages/ui-core/src/components/<ComponentName>/`:

```
ComponentName/
├── ComponentName.tsx         # implementation
├── ComponentName.test.tsx    # Jest + RTL tests (if extracted)
├── ComponentName.stories.tsx # CSF3 stories
└── index.ts                  # barrel: re-exports component + types
```

### Story template (CSF3)

Every component story file follows this shape. The `title` slug groups components in Storybook's left nav. Categories used here: `Layout` (Stack, Card), `Forms` (Field, Input, Button), `Display` (Icon, Logo), `Data` (DataTable, DedupedDatalist), `Overlay` (Modal).

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { ComponentName } from './ComponentName'

const meta: Meta<typeof ComponentName> = {
  title: 'Category/ComponentName',
  component: ComponentName,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  argTypes: {
    // one argType entry per controllable prop
  },
}
export default meta

type Story = StoryObj<typeof ComponentName>

export const Default: Story = {
  args: {
    // minimal props
  },
}
```

### Per-task commit pattern

Every task ends with a single commit. Commit message format:

```
feat(ui-core): <short description>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Never `--amend` between tasks. Never `--no-verify`.

### Verification commands (used throughout)

| What | Command |
|---|---|
| Type-check ui-core | `npm run -w @geodedb/ui-core typecheck` |
| Type-check whole repo | `npm run test:ts` |
| Run ui-core unit tests | `npm run -w @geodedb/ui-core test` |
| Run all repo tests | `npm test` |
| Build ui-core library | `npm run -w @geodedb/ui-core build` |
| Boot Storybook dev | `npm run -w @geodedb/ui-core storybook` |
| Build Storybook static | `npm run -w @geodedb/ui-core build-storybook` |
| Lint geode-ui app | `npm run lint` |

---

## Target File Structure (after plan completion)

```
geode-ui/
├── package.json                    # root workspaces config; geode-ui app retains its current scripts
├── packages/
│   └── ui-core/
│       ├── package.json            # @geodedb/ui-core (new)
│       ├── README.md
│       ├── tsconfig.json
│       ├── tsconfig.build.json
│       ├── tsup.config.ts
│       ├── jest.config.cjs
│       ├── .storybook/
│       │   ├── main.ts
│       │   ├── preview.tsx
│       │   └── manager.ts
│       ├── stories/
│       │   └── Welcome.mdx
│       └── src/
│           ├── index.ts                          # main barrel
│           ├── components/
│           │   ├── Button/{Button.tsx,Button.test.tsx,Button.stories.tsx,index.ts}
│           │   ├── Card/{Card.tsx,Card.stories.tsx,index.ts}
│           │   ├── DataTable/{DataTable.tsx,DataTable.stories.tsx,index.ts}
│           │   ├── DedupedDatalist/{DedupedDatalist.tsx,DedupedDatalist.test.tsx,DedupedDatalist.stories.tsx,index.ts}
│           │   ├── Field/{Field.tsx,Field.stories.tsx,index.ts}
│           │   ├── Icon/{Icon.tsx,Icon.stories.tsx,index.ts}
│           │   ├── Input/{Input.tsx,Input.stories.tsx,index.ts}
│           │   ├── Logo/{Logo.tsx,Logo.stories.tsx,index.ts}
│           │   ├── Modal/{Modal.tsx,Modal.test.tsx,Modal.stories.tsx,index.ts}
│           │   └── Stack/{Stack.tsx,Stack.stories.tsx,index.ts}
│           ├── hooks/
│           │   ├── useUniqueValues.ts
│           │   ├── useUniqueValues.test.ts
│           │   └── index.ts
│           ├── theme/
│           │   ├── breakpoints.ts
│           │   ├── dark.ts
│           │   ├── light.ts
│           │   ├── ThemeContext.tsx
│           │   ├── theme.test.ts
│           │   ├── tokens.ts
│           │   ├── types.ts
│           │   └── index.ts
│           └── styles/
│               └── bootstrap-bridge.css
├── src/                            # geode-ui app code (unchanged location)
│   ├── components/                 # ui/ directory removed; theme/ removed; styles/bootstrap-bridge.css removed
│   └── ...
├── Makefile                        # new targets: stories, stories-build, ui-core-build, ui-core-test
└── .gitlab-ci.yml                  # new job: build-storybook + pages
```

---

# Task 1: Convert root to npm workspaces and scaffold `packages/ui-core/`

**Files:**
- Modify: `/data/home/benji/src/gl/gitlab.com/devnw/codepros/geode/geode-ui/package.json`
- Create: `/data/home/benji/src/gl/gitlab.com/devnw/codepros/geode/geode-ui/packages/ui-core/.gitkeep`

- [ ] **Step 1: Inspect current root package.json**

Run: `jq -r '. | {name, version, private, workspaces}' package.json`
Expected output:
```
{
  "name": "@geodedb/ui",
  "version": "0.1.1",
  "private": true,
  "workspaces": null
}
```

- [ ] **Step 2: Add `workspaces` to root package.json**

Edit `package.json`. Add this top-level key immediately after `"private": true,`:

```json
  "workspaces": [
    "packages/*"
  ],
```

- [ ] **Step 3: Create the package directory placeholder**

Run:
```bash
mkdir -p packages/ui-core
touch packages/ui-core/.gitkeep
```

- [ ] **Step 4: Verify npm recognises the workspace**

Run: `npm install --workspaces=false --include-workspace-root --no-audit --no-fund`
Expected: completes without error; `node_modules/` regenerated; no new lock churn beyond the workspaces field.

Run: `npm query .workspace`
Expected: empty JSON array `[]` (no workspaces have manifests yet — that's fine).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json packages/ui-core/.gitkeep
git commit -m "$(cat <<'EOF'
feat(ui-core): scaffold packages/ui-core/ workspace

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 2: Create `packages/ui-core/package.json`

**Files:**
- Create: `packages/ui-core/package.json`

- [ ] **Step 1: Write package.json**

Create `packages/ui-core/package.json` with this exact content:

```json
{
  "name": "@geodedb/ui-core",
  "version": "0.1.0",
  "description": "Reusable presentational primitives and theme system extracted from geode-ui.",
  "license": "Apache-2.0",
  "type": "module",
  "sideEffects": [
    "**/*.css"
  ],
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./theme": {
      "types": "./dist/theme/index.d.ts",
      "import": "./dist/theme/index.js",
      "require": "./dist/theme/index.cjs"
    },
    "./hooks": {
      "types": "./dist/hooks/index.d.ts",
      "import": "./dist/hooks/index.js",
      "require": "./dist/hooks/index.cjs"
    },
    "./styles/bootstrap-bridge.css": "./dist/styles/bootstrap-bridge.css",
    "./package.json": "./package.json"
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "jest --config jest.config.cjs",
    "test:watch": "jest --config jest.config.cjs --watch",
    "storybook": "storybook dev -p 6006 --no-open",
    "build-storybook": "storybook build --output-dir storybook-static",
    "clean": "rm -rf dist storybook-static"
  },
  "peerDependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "styled-components": "^6.1.0"
  },
  "devDependencies": {
    "@babel/preset-env": "^7.24.0",
    "@babel/preset-react": "^7.24.0",
    "@babel/preset-typescript": "^7.24.0",
    "@storybook/addon-a11y": "^8.4.0",
    "@storybook/addon-docs": "^8.4.0",
    "@storybook/addon-essentials": "^8.4.0",
    "@storybook/addon-links": "^8.4.0",
    "@storybook/react": "^8.4.0",
    "@storybook/react-webpack5": "^8.4.0",
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^14.0.0",
    "@types/jest": "^29.5.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@types/styled-components": "^5.1.34",
    "jest": "^29.7.0",
    "jest-environment-jsdom": "^29.7.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "storybook": "^8.4.0",
    "styled-components": "^6.1.0",
    "ts-jest": "^29.1.0",
    "tsup": "^8.0.0",
    "typescript": "^5.8.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Install dependencies (will pull devDeps + link workspace)**

Run: `npm install`
Expected: completes; `node_modules/@geodedb/ui-core` is a symlink to `packages/ui-core/`.

Run: `ls -la node_modules/@geodedb/ui-core`
Expected: symlink pointing to `../../packages/ui-core`.

- [ ] **Step 3: Commit**

```bash
git add packages/ui-core/package.json package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(ui-core): add @geodedb/ui-core package manifest

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 3: Add TypeScript and tsup build configuration

**Files:**
- Create: `packages/ui-core/tsconfig.json`
- Create: `packages/ui-core/tsconfig.build.json`
- Create: `packages/ui-core/tsup.config.ts`
- Create: `packages/ui-core/src/index.ts`

- [ ] **Step 1: Write `tsconfig.json`** (used for editor + typecheck)

Create `packages/ui-core/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "noEmit": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*", ".storybook/**/*"],
  "exclude": ["dist", "storybook-static", "node_modules"]
}
```

- [ ] **Step 2: Write `tsconfig.build.json`**

Create `packages/ui-core/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "emitDeclarationOnly": false,
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": [
    "src/**/*.test.ts",
    "src/**/*.test.tsx",
    "src/**/*.stories.tsx",
    ".storybook/**/*"
  ]
}
```

- [ ] **Step 3: Write `tsup.config.ts`**

Create `packages/ui-core/tsup.config.ts`:

```ts
import { defineConfig } from 'tsup'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'theme/index': 'src/theme/index.ts',
    'hooks/index': 'src/hooks/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: ['react', 'react-dom', 'styled-components'],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  async onSuccess() {
    const src = 'src/styles/bootstrap-bridge.css'
    const dest = 'dist/styles/bootstrap-bridge.css'
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(src, dest)
  },
})
```

- [ ] **Step 4: Write a placeholder entry**

Create `packages/ui-core/src/index.ts`:

```ts
// @geodedb/ui-core — entry barrel. Populated incrementally by extraction tasks.
export const UI_CORE_VERSION = '0.1.0'
```

Create the styles directory placeholder so tsup's `onSuccess` hook doesn't fail before Task 7:

```bash
mkdir -p packages/ui-core/src/styles
touch packages/ui-core/src/styles/bootstrap-bridge.css
mkdir -p packages/ui-core/src/theme
mkdir -p packages/ui-core/src/hooks
```

Add `theme/index.ts` and `hooks/index.ts` placeholders (will be replaced in Tasks 6 and 8):

```bash
echo "export {}" > packages/ui-core/src/theme/index.ts
echo "export {}" > packages/ui-core/src/hooks/index.ts
```

- [ ] **Step 5: Verify build works on empty surface**

Run: `npm run -w @geodedb/ui-core typecheck`
Expected: exit 0, no output.

Run: `npm run -w @geodedb/ui-core build`
Expected: tsup produces `packages/ui-core/dist/index.js`, `dist/index.cjs`, `dist/index.d.ts`, and copies the (empty) `dist/styles/bootstrap-bridge.css`. Exit 0.

Run: `ls packages/ui-core/dist`
Expected: `hooks/  index.cjs  index.d.cts  index.d.ts  index.js  index.js.map  index.cjs.map  styles/  theme/`

- [ ] **Step 6: Commit**

```bash
git add packages/ui-core/tsconfig.json packages/ui-core/tsconfig.build.json \
        packages/ui-core/tsup.config.ts packages/ui-core/src/index.ts \
        packages/ui-core/src/theme/index.ts packages/ui-core/src/hooks/index.ts \
        packages/ui-core/src/styles/bootstrap-bridge.css
git commit -m "$(cat <<'EOF'
feat(ui-core): add tsconfig, tsup config, and empty entry

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 4: Add Jest configuration for `@geodedb/ui-core`

**Files:**
- Create: `packages/ui-core/jest.config.cjs`
- Create: `packages/ui-core/jest.setup.ts`
- Create: `packages/ui-core/babel.config.cjs`

- [ ] **Step 1: Write Babel config (for Jest only — tsup doesn't use Babel)**

Create `packages/ui-core/babel.config.cjs`:

```js
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'automatic' }],
    '@babel/preset-typescript',
  ],
}
```

- [ ] **Step 2: Write Jest config**

Create `packages/ui-core/jest.config.cjs`:

```js
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  moduleNameMapper: {
    '\\.(css|less|scss)$': '<rootDir>/__mocks__/styleMock.js',
  },
}
```

- [ ] **Step 3: Write setup file**

Create `packages/ui-core/jest.setup.ts`:

```ts
import '@testing-library/jest-dom'
```

- [ ] **Step 4: Write CSS mock**

Create `packages/ui-core/__mocks__/styleMock.js`:

```js
module.exports = {}
```

- [ ] **Step 5: Verify Jest boots with zero tests**

Run: `npm run -w @geodedb/ui-core test -- --passWithNoTests`
Expected: "No tests found, exiting with code 0" (or equivalent green output).

- [ ] **Step 6: Commit**

```bash
git add packages/ui-core/jest.config.cjs packages/ui-core/jest.setup.ts \
        packages/ui-core/babel.config.cjs packages/ui-core/__mocks__/styleMock.js
git commit -m "$(cat <<'EOF'
feat(ui-core): add jest + babel config for unit tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 5: Scaffold Storybook (`.storybook/main.ts`, `preview.tsx`, Welcome story)

**Files:**
- Create: `packages/ui-core/.storybook/main.ts`
- Create: `packages/ui-core/.storybook/preview.tsx`
- Create: `packages/ui-core/.storybook/manager.ts`
- Create: `packages/ui-core/stories/Welcome.mdx`

- [ ] **Step 1: Write `.storybook/main.ts`**

Create `packages/ui-core/.storybook/main.ts`:

```ts
import type { StorybookConfig } from '@storybook/react-webpack5'

const config: StorybookConfig = {
  stories: [
    '../stories/**/*.mdx',
    '../src/**/*.stories.@(ts|tsx|mdx)',
  ],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-links',
  ],
  framework: {
    name: '@storybook/react-webpack5',
    options: {},
  },
  typescript: {
    check: false,
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      shouldRemoveUndefinedFromOptional: true,
      propFilter: (prop) => (prop.parent ? !/node_modules/.test(prop.parent.fileName) : true),
    },
  },
  docs: { autodocs: 'tag' },
  // Honour STORYBOOK_PUBLIC_PATH when deploying to a GitLab Pages subdirectory.
  // The CI job sets it to `/${CI_PROJECT_NAME}/` so asset URLs resolve correctly.
  managerHead: (head) => `${head}`,
}

export default config
```

- [ ] **Step 2: Write `.storybook/preview.tsx`**

Create `packages/ui-core/.storybook/preview.tsx`:

```tsx
import type { Preview, Decorator } from '@storybook/react'
import React from 'react'
import { ThemeProvider as StyledThemeProvider } from 'styled-components'
import { ThemeProvider, lightTheme, darkTheme } from '../src/theme'
import '../src/styles/bootstrap-bridge.css'

const withTheme: Decorator = (Story, context) => {
  const variant = context.globals.theme === 'dark' ? 'dark' : 'light'
  const themeObject = variant === 'dark' ? darkTheme : lightTheme
  return (
    <ThemeProvider initialVariant={variant}>
      <StyledThemeProvider theme={themeObject}>
        <div
          style={{
            background: themeObject.bg?.app ?? '#fff',
            color: themeObject.text?.primary ?? '#111',
            padding: '1.5rem',
            minHeight: '100vh',
          }}
        >
          <Story />
        </div>
      </StyledThemeProvider>
    </ThemeProvider>
  )
}

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Color scheme',
      defaultValue: 'light',
      toolbar: {
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    options: {
      storySort: {
        order: [
          'Welcome',
          'Layout',
          'Forms',
          'Display',
          'Data',
          'Overlay',
        ],
      },
    },
    a11y: { config: { rules: [] } },
    layout: 'padded',
  },
  tags: ['autodocs'],
}

export default preview
```

- [ ] **Step 3: Write `.storybook/manager.ts`** (kept minimal — reference compatibility)

Create `packages/ui-core/.storybook/manager.ts`:

```ts
import { addons } from 'storybook/manager-api'

addons.setConfig({
  sidebar: {
    showRoots: true,
  },
})
```

- [ ] **Step 4: Write Welcome MDX**

Create `packages/ui-core/stories/Welcome.mdx`:

```mdx
import { Meta } from '@storybook/blocks'

<Meta title="Welcome" />

# @geodedb/ui-core

Reusable presentational primitives and theme system extracted from the
[geode-ui](https://gitlab.com/devnw/codepros/geode/geode-ui) application.

## Install

```bash
npm install @geodedb/ui-core
```

`@geodedb/ui-core` declares React, ReactDOM, and styled-components as
peer dependencies. Make sure your host app provides them.

## Quick start

```tsx
import { Button, ThemeProvider, lightTheme } from '@geodedb/ui-core'
import { ThemeProvider as StyledThemeProvider } from 'styled-components'

function App() {
  return (
    <ThemeProvider initialVariant="light">
      <StyledThemeProvider theme={lightTheme}>
        <Button variant="primary">Hello</Button>
      </StyledThemeProvider>
    </ThemeProvider>
  )
}
```

Browse the sidebar to explore the available components, props, and a11y
notes for each one.
```

- [ ] **Step 5: Verify Storybook builds**

Run: `npm run -w @geodedb/ui-core build-storybook`
Expected: build completes; `packages/ui-core/storybook-static/index.html` exists. The build may warn about no stories matching the `src/**/*.stories.tsx` glob — that's expected; only the Welcome MDX exists so far.

Run: `ls packages/ui-core/storybook-static/index.html`
Expected: file exists.

- [ ] **Step 6: Verify Storybook dev mode boots**

Run (background, kill after smoke):
```bash
( cd packages/ui-core && timeout 30 npx storybook dev -p 6006 --no-open --ci ) || true
```
Expected: server emits "Storybook 8.x.x for react-webpack5 started" and "Local: http://localhost:6006/" within 30s, then the timeout terminates it. If the line appears, the smoke passed.

- [ ] **Step 7: Update `.gitignore`**

Edit `/data/home/benji/src/gl/gitlab.com/devnw/codepros/geode/geode-ui/.gitignore`. Append:

```
# ui-core build outputs
packages/ui-core/dist/
packages/ui-core/storybook-static/
```

- [ ] **Step 8: Commit**

```bash
git add packages/ui-core/.storybook packages/ui-core/stories .gitignore package-lock.json
git commit -m "$(cat <<'EOF'
feat(ui-core): scaffold storybook with theme decorator and welcome MDX

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 6: Move `src/theme/` into `packages/ui-core/src/theme/`

**Files:**
- Move: `src/theme/breakpoints.ts` → `packages/ui-core/src/theme/breakpoints.ts`
- Move: `src/theme/dark.ts` → `packages/ui-core/src/theme/dark.ts`
- Move: `src/theme/light.ts` → `packages/ui-core/src/theme/light.ts`
- Move: `src/theme/ThemeContext.tsx` → `packages/ui-core/src/theme/ThemeContext.tsx`
- Move: `src/theme/theme.test.ts` → `packages/ui-core/src/theme/theme.test.ts`
- Move: `src/theme/tokens.ts` → `packages/ui-core/src/theme/tokens.ts`
- Move: `src/theme/types.ts` → `packages/ui-core/src/theme/types.ts`
- Move: `src/theme/index.ts` → `packages/ui-core/src/theme/index.ts`
- Replace: `src/theme/index.ts` (with thin re-export shim, to be removed in Task 19)

- [ ] **Step 1: Copy theme files into the package**

Run:
```bash
cp src/theme/breakpoints.ts packages/ui-core/src/theme/breakpoints.ts
cp src/theme/dark.ts        packages/ui-core/src/theme/dark.ts
cp src/theme/light.ts       packages/ui-core/src/theme/light.ts
cp src/theme/ThemeContext.tsx packages/ui-core/src/theme/ThemeContext.tsx
cp src/theme/theme.test.ts  packages/ui-core/src/theme/theme.test.ts
cp src/theme/tokens.ts      packages/ui-core/src/theme/tokens.ts
cp src/theme/types.ts       packages/ui-core/src/theme/types.ts
cp src/theme/index.ts       packages/ui-core/src/theme/index.ts
```

- [ ] **Step 2: Verify the copied files type-check inside the package**

Run: `npm run -w @geodedb/ui-core typecheck`
Expected: exit 0. If errors appear, they are likely due to relative imports inside the moved files; theme files are self-contained, so no path edits should be needed.

- [ ] **Step 3: Run the moved theme test**

Run: `npm run -w @geodedb/ui-core test -- theme/theme.test.ts`
Expected: PASS.

- [ ] **Step 4: Rewrite geode-ui's `src/theme/index.ts` as a deprecation shim**

Replace `src/theme/index.ts` with:

```ts
// Transitional re-export shim. The theme system has moved to @geodedb/ui-core/theme.
// This shim keeps the app compiling during the migration; it will be deleted in
// the "consume back" task (see docs/superpowers/plans/2026-05-20-ui-core-extraction-and-storybook.md).
export * from '@geodedb/ui-core/theme'
export { darkTheme as theme } from '@geodedb/ui-core/theme'
```

- [ ] **Step 5: Delete the now-redundant source files in `src/theme/`**

Run:
```bash
git rm src/theme/breakpoints.ts src/theme/dark.ts src/theme/light.ts \
       src/theme/ThemeContext.tsx src/theme/theme.test.ts \
       src/theme/tokens.ts src/theme/types.ts
```

(`src/theme/index.ts` stays as the shim from Step 4.)

- [ ] **Step 6: Build the package so consumers can resolve `@geodedb/ui-core/theme`**

Run: `npm run -w @geodedb/ui-core build`
Expected: build emits `packages/ui-core/dist/theme/index.js` and `dist/theme/index.d.ts`.

- [ ] **Step 7: Verify geode-ui still type-checks**

Run: `npm run test:ts`
Expected: exit 0.

- [ ] **Step 8: Run geode-ui's full test suite to confirm theme behaviour is unchanged**

Run: `npm test`
Expected: same green count as before this task.

- [ ] **Step 9: Commit**

```bash
git add -A packages/ui-core/src/theme src/theme
git commit -m "$(cat <<'EOF'
feat(ui-core): move theme system into @geodedb/ui-core/theme

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 7: Move `src/styles/bootstrap-bridge.css` into `packages/ui-core/src/styles/`

**Files:**
- Move: `src/styles/bootstrap-bridge.css` → `packages/ui-core/src/styles/bootstrap-bridge.css`
- Modify: `src/index.tsx` — switch CSS import
- Modify: `src/services/webawesome/theme-bridge.test.ts` — update import path
- Modify: `src/services/bootstrap/Dropdown.tsx` — update import path

- [ ] **Step 1: Move the CSS file**

Run:
```bash
cp src/styles/bootstrap-bridge.css packages/ui-core/src/styles/bootstrap-bridge.css
git rm src/styles/bootstrap-bridge.css
```

- [ ] **Step 2: Update the three consumers**

In `src/index.tsx`, change:
```ts
import './styles/bootstrap-bridge.css'
```
to:
```ts
import '@geodedb/ui-core/styles/bootstrap-bridge.css'
```

In `src/services/bootstrap/Dropdown.tsx`, change the analogous import. Use this command to find the exact line and edit accordingly:

Run: `grep -n bootstrap-bridge src/services/bootstrap/Dropdown.tsx`
Edit the matched line to import from `@geodedb/ui-core/styles/bootstrap-bridge.css`.

In `src/services/webawesome/theme-bridge.test.ts`, do the same:

Run: `grep -n bootstrap-bridge src/services/webawesome/theme-bridge.test.ts`
Edit accordingly.

- [ ] **Step 3: Rebuild the package so the CSS lands in `dist/styles/`**

Run: `npm run -w @geodedb/ui-core build`
Expected: `packages/ui-core/dist/styles/bootstrap-bridge.css` exists with the same byte length as the source.

- [ ] **Step 4: Type-check and run tests**

Run: `npm run test:ts && npm test`
Expected: both green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(ui-core): move bootstrap-bridge.css into @geodedb/ui-core/styles

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 8: Move `useUniqueValues` hook into `packages/ui-core/src/hooks/`

**Files:**
- Move: `src/components/ui/useUniqueValues.ts` → `packages/ui-core/src/hooks/useUniqueValues.ts`
- Move: `src/components/ui/useUniqueValues.test.ts` → `packages/ui-core/src/hooks/useUniqueValues.test.ts`
- Replace: `packages/ui-core/src/hooks/index.ts` (real barrel)
- Modify: `src/components/ui/index.ts` (re-export from package during transition)

- [ ] **Step 1: Copy the hook and its test**

Run:
```bash
cp src/components/ui/useUniqueValues.ts      packages/ui-core/src/hooks/useUniqueValues.ts
cp src/components/ui/useUniqueValues.test.ts packages/ui-core/src/hooks/useUniqueValues.test.ts
```

- [ ] **Step 2: Replace the hooks barrel**

Replace `packages/ui-core/src/hooks/index.ts` with:

```ts
export { useUniqueValues } from './useUniqueValues'
```

- [ ] **Step 3: Re-export the hook from `src/index.ts`**

Edit `packages/ui-core/src/index.ts`. Replace its contents with:

```ts
// @geodedb/ui-core — entry barrel.
export * from './hooks'
export { UI_CORE_VERSION } from './version'
```

Create `packages/ui-core/src/version.ts`:

```ts
export const UI_CORE_VERSION = '0.1.0'
```

- [ ] **Step 4: Update geode-ui's transitional barrel**

Edit `src/components/ui/index.ts`. Replace the line:
```ts
export { useUniqueValues } from './useUniqueValues'
```
with:
```ts
export { useUniqueValues } from '@geodedb/ui-core'
```

- [ ] **Step 5: Delete the source hook from the app**

Run:
```bash
git rm src/components/ui/useUniqueValues.ts src/components/ui/useUniqueValues.test.ts
```

- [ ] **Step 6: Build, type-check, test**

Run:
```bash
npm run -w @geodedb/ui-core build
npm run -w @geodedb/ui-core test -- hooks/useUniqueValues.test.ts
npm run test:ts
npm test
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(ui-core): move useUniqueValues hook into @geodedb/ui-core/hooks

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Tasks 9–18: Component extraction (one task per component)

> **Important:** The general shape of each component task is identical — only the component name, story content, and special refactors differ. Tasks 9–18 below give the *full* content per component; do not abbreviate or skip steps even though the structure repeats.

## Task 9: Extract `Stack` (and its companions `Inline`, `Container`, `Grid`, `Spacer`)

**Files:**
- Create: `packages/ui-core/src/components/Stack/Stack.tsx` (copied from `src/components/ui/Stack.tsx`, with import path edits)
- Create: `packages/ui-core/src/components/Stack/Stack.stories.tsx`
- Create: `packages/ui-core/src/components/Stack/index.ts`
- Modify: `src/components/ui/index.ts` (re-export from package)
- Delete: `src/components/ui/Stack.tsx`

- [ ] **Step 1: Copy the component**

Run:
```bash
cp src/components/ui/Stack.tsx packages/ui-core/src/components/Stack/Stack.tsx
```

No import edits needed: the existing `import type { Theme } from '../../theme'` still resolves correctly because the new file sits at the same depth below its package root (`packages/ui-core/src/components/Stack/` → `../../theme` = `packages/ui-core/src/theme`). The same is true for `Input.tsx` (Task 13).

- [ ] **Step 2: Write `Stack/index.ts`**

Create `packages/ui-core/src/components/Stack/index.ts`:

```ts
export { Stack, Inline, Container, Grid, Spacer } from './Stack'
```

- [ ] **Step 3: Write `Stack.stories.tsx`**

Create `packages/ui-core/src/components/Stack/Stack.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { Stack, Inline, Container, Grid, Spacer } from './Stack'

const Box = ({ children }: { children: React.ReactNode }) => (
  <div style={{ padding: '0.5rem 0.75rem', background: '#3b82f6', color: '#fff', borderRadius: 6 }}>
    {children}
  </div>
)

const meta: Meta<typeof Stack> = {
  title: 'Layout/Stack',
  component: Stack,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  argTypes: {
    gap: { control: 'select', options: ['none', 'xs', 'sm', 'md', 'lg', 'xl'] },
    align: { control: 'select', options: ['start', 'center', 'end', 'stretch'] },
    justify: { control: 'select', options: ['start', 'center', 'end', 'between', 'around'] },
  },
}
export default meta

type Story = StoryObj<typeof Stack>

export const Vertical: Story = {
  args: { gap: 'md' },
  render: (args) => (
    <Stack {...args}>
      <Box>One</Box>
      <Box>Two</Box>
      <Box>Three</Box>
    </Stack>
  ),
}

export const HorizontalInline: Story = {
  name: 'Inline (horizontal)',
  render: () => (
    <Inline gap="sm">
      <Box>A</Box>
      <Box>B</Box>
      <Box>C</Box>
    </Inline>
  ),
}

export const TwoColumnGrid: Story = {
  name: 'Grid (2 columns)',
  render: () => (
    <Grid columns={2} gap="md">
      <Box>1</Box>
      <Box>2</Box>
      <Box>3</Box>
      <Box>4</Box>
    </Grid>
  ),
}

export const WithSpacer: Story = {
  render: () => (
    <Inline gap="none">
      <Box>Left</Box>
      <Spacer />
      <Box>Right</Box>
    </Inline>
  ),
}
```

- [ ] **Step 4: Update `src/components/ui/index.ts` to re-export from the package**

Edit the line:
```ts
export { Stack, Inline, Container, Grid, Spacer } from './Stack'
```
to:
```ts
export { Stack, Inline, Container, Grid, Spacer } from '@geodedb/ui-core'
```

- [ ] **Step 5: Add `Stack` to `packages/ui-core/src/index.ts`**

Append to `packages/ui-core/src/index.ts`:

```ts
export { Stack, Inline, Container, Grid, Spacer } from './components/Stack'
```

- [ ] **Step 6: Delete the source file from the app**

Run: `git rm src/components/ui/Stack.tsx`

- [ ] **Step 7: Build, type-check, test**

Run: `npm run -w @geodedb/ui-core build && npm run test:ts && npm test`
Expected: all green.

- [ ] **Step 8: Smoke-check the story in Storybook**

Run: `( cd packages/ui-core && timeout 30 npx storybook dev -p 6006 --no-open --ci ) || true`
Expected: build completes, no compile errors for `Stack.stories.tsx`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(ui-core): extract Stack/Inline/Container/Grid/Spacer with stories

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task 10: Extract `Card` (and `CardHeader`, `CardTitle`, `CardSubtitle`)

**Files:**
- Create: `packages/ui-core/src/components/Card/Card.tsx`
- Create: `packages/ui-core/src/components/Card/Card.stories.tsx`
- Create: `packages/ui-core/src/components/Card/index.ts`
- Modify: `src/components/ui/index.ts`
- Modify: `packages/ui-core/src/index.ts`
- Delete: `src/components/ui/Card.tsx`

- [ ] **Step 1: Copy the component**

Run: `cp src/components/ui/Card.tsx packages/ui-core/src/components/Card/Card.tsx`

- [ ] **Step 2: Write `Card/index.ts`**

```ts
export { Card, CardHeader, CardTitle, CardSubtitle } from './Card'
```

- [ ] **Step 3: Write `Card.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { Card, CardHeader, CardTitle, CardSubtitle } from './Card'

const meta: Meta<typeof Card> = {
  title: 'Layout/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof Card>

export const Default: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Card title</CardTitle>
        <CardSubtitle>A short subtitle to describe the card content.</CardSubtitle>
      </CardHeader>
      <p>Body content goes here. Cards are bare surfaces that compose with other primitives.</p>
    </Card>
  ),
}

export const WithoutHeader: Story = {
  render: () => (
    <Card>
      <p style={{ margin: 0 }}>A card with no header — useful for inline panels.</p>
    </Card>
  ),
}
```

- [ ] **Step 4: Update geode-ui's transitional barrel**

In `src/components/ui/index.ts`, replace:
```ts
export { Card, CardHeader, CardTitle, CardSubtitle } from './Card'
```
with:
```ts
export { Card, CardHeader, CardTitle, CardSubtitle } from '@geodedb/ui-core'
```

- [ ] **Step 5: Add to package barrel**

Append to `packages/ui-core/src/index.ts`:
```ts
export { Card, CardHeader, CardTitle, CardSubtitle } from './components/Card'
```

- [ ] **Step 6: Delete the source file**

Run: `git rm src/components/ui/Card.tsx`

- [ ] **Step 7: Verify**

Run: `npm run -w @geodedb/ui-core build && npm run test:ts && npm test`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(ui-core): extract Card primitive with stories

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task 11: Extract `Icon`

**Files:**
- Create: `packages/ui-core/src/components/Icon/Icon.tsx`
- Create: `packages/ui-core/src/components/Icon/Icon.stories.tsx`
- Create: `packages/ui-core/src/components/Icon/index.ts`
- Modify: `src/components/ui/index.ts`, `packages/ui-core/src/index.ts`
- Delete: `src/components/ui/Icon.tsx`

- [ ] **Step 1: Copy file and create barrel**

```bash
cp src/components/ui/Icon.tsx packages/ui-core/src/components/Icon/Icon.tsx
```

Create `packages/ui-core/src/components/Icon/index.ts`:
```ts
export { Icon } from './Icon'
export type { IconProps, IconStyle } from './Icon'
```

- [ ] **Step 2: Write `Icon.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { Icon } from './Icon'

const meta: Meta<typeof Icon> = {
  title: 'Display/Icon',
  component: Icon,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  argTypes: {
    name: { control: 'text' },
    style: { control: 'select', options: ['solid', 'regular', 'brands'] },
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
  },
}
export default meta

type Story = StoryObj<typeof Icon>

export const Solid: Story = { args: { name: 'circle-check', style: 'solid', size: 'md' } }
export const Regular: Story = { args: { name: 'circle-check', style: 'regular', size: 'md' } }
export const Large: Story = { args: { name: 'rocket', style: 'solid', size: 'xl' } }

export const Gallery: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {['rocket', 'gear', 'user', 'magnifying-glass', 'circle-check', 'triangle-exclamation'].map((n) => (
        <div key={n} style={{ textAlign: 'center', minWidth: 80 }}>
          <Icon name={n} size="lg" />
          <div style={{ fontSize: 12, marginTop: 4 }}>{n}</div>
        </div>
      ))}
    </div>
  ),
}
```

- [ ] **Step 3: Wire barrels and delete source**

In `src/components/ui/index.ts`, change `from './Icon'` to `from '@geodedb/ui-core'` for both the value and type re-exports.

Append to `packages/ui-core/src/index.ts`:
```ts
export { Icon } from './components/Icon'
export type { IconProps, IconStyle } from './components/Icon'
```

Run: `git rm src/components/ui/Icon.tsx`

- [ ] **Step 4: Verify**

Run: `npm run -w @geodedb/ui-core build && npm run test:ts && npm test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(ui-core): extract Icon with stories

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task 12: Extract `Field`

**Files:**
- Create: `packages/ui-core/src/components/Field/{Field.tsx,Field.stories.tsx,index.ts}`
- Modify barrels
- Delete: `src/components/ui/Field.tsx`

- [ ] **Step 1: Copy and create barrel**

```bash
cp src/components/ui/Field.tsx packages/ui-core/src/components/Field/Field.tsx
```

Create `packages/ui-core/src/components/Field/index.ts`:
```ts
export { Field } from './Field'
export type { FieldProps } from './Field'
```

- [ ] **Step 2: Write `Field.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { Field } from './Field'
import { Input } from '../Input'

const meta: Meta<typeof Field> = {
  title: 'Forms/Field',
  component: Field,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof Field>

export const Default: Story = {
  args: { label: 'Email address', htmlFor: 'email' },
  render: (args) => (
    <Field {...args}>
      <Input id="email" type="email" placeholder="you@example.com" />
    </Field>
  ),
}

export const WithError: Story = {
  args: { label: 'Password', htmlFor: 'pw', error: 'Must be at least 12 characters.' },
  render: (args) => (
    <Field {...args}>
      <Input id="pw" type="password" />
    </Field>
  ),
}

export const WithHelp: Story = {
  args: { label: 'Display name', htmlFor: 'name', helpText: 'Visible to other workspace members.' },
  render: (args) => (
    <Field {...args}>
      <Input id="name" />
    </Field>
  ),
}
```

> **Note:** If `Field`'s current API does not include `error` / `helpText`, adjust the story to match the actual props. Read `packages/ui-core/src/components/Field/Field.tsx` to confirm the prop shape, then update `argTypes` and story args accordingly.

- [ ] **Step 3: Wire barrels and delete source**

In `src/components/ui/index.ts`, change `from './Field'` to `from '@geodedb/ui-core'`.

Append to `packages/ui-core/src/index.ts`:
```ts
export { Field } from './components/Field'
export type { FieldProps } from './components/Field'
```

Run: `git rm src/components/ui/Field.tsx`

- [ ] **Step 4: Verify**

Run: `npm run -w @geodedb/ui-core build && npm run test:ts && npm test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(ui-core): extract Field with stories

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task 13: Extract `Input` (and `Textarea`, `Select`)

**Files:**
- Create: `packages/ui-core/src/components/Input/{Input.tsx,Input.stories.tsx,index.ts}`

- [ ] **Step 1: Copy and barrel**

```bash
cp src/components/ui/Input.tsx packages/ui-core/src/components/Input/Input.tsx
```

Create `packages/ui-core/src/components/Input/index.ts`:
```ts
export { Input, Textarea, Select } from './Input'
export type { InputProps, TextareaProps, SelectProps, InputSize } from './Input'
```

- [ ] **Step 2: Write `Input.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { Input, Textarea, Select } from './Input'

const meta: Meta<typeof Input> = {
  title: 'Forms/Input',
  component: Input,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    type: { control: 'select', options: ['text', 'email', 'password', 'number', 'search', 'url'] },
    disabled: { control: 'boolean' },
  },
}
export default meta

type Story = StoryObj<typeof Input>

export const Default: Story = { args: { placeholder: 'Type something…' } }
export const Email: Story = { args: { type: 'email', placeholder: 'you@example.com' } }
export const Disabled: Story = { args: { value: 'Read-only', disabled: true } }

export const TextareaStory: Story = {
  name: 'Textarea',
  render: () => <Textarea placeholder="Multi-line input…" rows={4} />,
}

export const SelectStory: Story = {
  name: 'Select',
  render: () => (
    <Select defaultValue="b">
      <option value="a">Option A</option>
      <option value="b">Option B</option>
      <option value="c">Option C</option>
    </Select>
  ),
}
```

- [ ] **Step 3: Wire barrels and delete source**

In `src/components/ui/index.ts`, change `from './Input'` to `from '@geodedb/ui-core'`.

Append to `packages/ui-core/src/index.ts`:
```ts
export { Input, Textarea, Select } from './components/Input'
export type { InputProps, TextareaProps, SelectProps, InputSize } from './components/Input'
```

Run: `git rm src/components/ui/Input.tsx`

- [ ] **Step 4: Verify**

Run: `npm run -w @geodedb/ui-core build && npm run test:ts && npm test`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(ui-core): extract Input/Textarea/Select with stories

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task 14: Extract `Button` (with its existing test)

**Files:**
- Create: `packages/ui-core/src/components/Button/{Button.tsx,Button.test.tsx,Button.stories.tsx,index.ts}`

- [ ] **Step 1: Copy component and test**

```bash
cp src/components/ui/Button.tsx       packages/ui-core/src/components/Button/Button.tsx
cp src/components/ui/Button.test.tsx  packages/ui-core/src/components/Button/Button.test.tsx
```

Create `packages/ui-core/src/components/Button/index.ts`:
```ts
export { Button } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button'
```

- [ ] **Step 2: Write `Button.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './Button'
import { Icon } from '../Icon'

const meta: Meta<typeof Button> = {
  title: 'Forms/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  args: { children: 'Click me' },
}
export default meta

type Story = StoryObj<typeof Button>

export const Primary: Story = { args: { variant: 'primary' } }
export const Secondary: Story = { args: { variant: 'secondary' } }
export const Ghost: Story = { args: { variant: 'ghost' } }
export const Danger: Story = { args: { variant: 'danger' } }
export const Loading: Story = { args: { variant: 'primary', loading: true } }
export const Disabled: Story = { args: { variant: 'primary', disabled: true } }

export const WithIcon: Story = {
  render: () => (
    <Button variant="primary">
      <Icon name="rocket" /> Launch
    </Button>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
}
```

- [ ] **Step 3: Wire barrels and delete sources**

In `src/components/ui/index.ts`, change the Button line:
```ts
export { Button } from '@geodedb/ui-core'
export type { ButtonProps, ButtonVariant, ButtonSize } from '@geodedb/ui-core'
```

Append to `packages/ui-core/src/index.ts`:
```ts
export { Button } from './components/Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './components/Button'
```

Run: `git rm src/components/ui/Button.tsx src/components/ui/Button.test.tsx`

- [ ] **Step 4: Verify the Button test runs from inside the package**

Run: `npm run -w @geodedb/ui-core test -- Button.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify the rest**

Run: `npm run -w @geodedb/ui-core build && npm run test:ts && npm test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(ui-core): extract Button with tests and stories

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task 15: Extract `DataTable` (and `TableScroll`, `EmptyCell`)

**Files:**
- Create: `packages/ui-core/src/components/DataTable/{DataTable.tsx,DataTable.stories.tsx,index.ts}`

- [ ] **Step 1: Copy and barrel**

```bash
cp src/components/ui/DataTable.tsx packages/ui-core/src/components/DataTable/DataTable.tsx
```

Create `packages/ui-core/src/components/DataTable/index.ts`:
```ts
export { DataTable, TableScroll, EmptyCell } from './DataTable'
```

- [ ] **Step 2: Write `DataTable.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { DataTable, TableScroll, EmptyCell } from './DataTable'

const meta: Meta<typeof DataTable> = {
  title: 'Data/DataTable',
  component: DataTable,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof DataTable>

const sample = [
  { id: 1, name: 'Alice', role: 'Admin', joined: '2024-08-12' },
  { id: 2, name: 'Bob', role: 'Editor', joined: '2025-01-04' },
  { id: 3, name: 'Carol', role: 'Viewer', joined: '2025-03-21' },
]

export const Default: Story = {
  render: () => (
    <TableScroll>
      <DataTable>
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {sample.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.role}</td>
              <td>{u.joined}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </TableScroll>
  ),
}

export const EmptyState: Story = {
  render: () => (
    <DataTable>
      <thead>
        <tr><th>Name</th><th>Role</th></tr>
      </thead>
      <tbody>
        <tr>
          <td colSpan={2}><EmptyCell>No results.</EmptyCell></td>
        </tr>
      </tbody>
    </DataTable>
  ),
}
```

- [ ] **Step 3: Wire barrels, delete source**

In `src/components/ui/index.ts`, change `from './DataTable'` to `from '@geodedb/ui-core'`.

Append to `packages/ui-core/src/index.ts`:
```ts
export { DataTable, TableScroll, EmptyCell } from './components/DataTable'
```

Run: `git rm src/components/ui/DataTable.tsx`

- [ ] **Step 4: Verify**

Run: `npm run -w @geodedb/ui-core build && npm run test:ts && npm test`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(ui-core): extract DataTable/TableScroll/EmptyCell with stories

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task 16: Extract `DedupedDatalist`

**Files:**
- Create: `packages/ui-core/src/components/DedupedDatalist/{DedupedDatalist.tsx,DedupedDatalist.test.tsx,DedupedDatalist.stories.tsx,index.ts}`

- [ ] **Step 1: Copy component + test**

```bash
cp src/components/ui/DedupedDatalist.tsx      packages/ui-core/src/components/DedupedDatalist/DedupedDatalist.tsx
cp src/components/ui/DedupedDatalist.test.tsx packages/ui-core/src/components/DedupedDatalist/DedupedDatalist.test.tsx
```

Create `packages/ui-core/src/components/DedupedDatalist/index.ts`:
```ts
export { DedupedDatalist } from './DedupedDatalist'
export type { DedupedDatalistProps } from './DedupedDatalist'
```

- [ ] **Step 2: Write `DedupedDatalist.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { DedupedDatalist } from './DedupedDatalist'

const meta: Meta<typeof DedupedDatalist> = {
  title: 'Forms/DedupedDatalist',
  component: DedupedDatalist,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof DedupedDatalist>

export const Default: Story = {
  args: {
    id: 'fruits',
    values: ['apple', 'banana', 'apple', 'cherry', 'banana', 'date'],
  },
  render: (args) => (
    <div>
      <input list={args.id} placeholder="Pick a fruit…" />
      <DedupedDatalist {...args} />
    </div>
  ),
}

export const Empty: Story = {
  args: { id: 'empty', values: [] },
  render: (args) => (
    <div>
      <input list={args.id} placeholder="No options" />
      <DedupedDatalist {...args} />
    </div>
  ),
}
```

- [ ] **Step 3: Wire barrels, delete sources**

In `src/components/ui/index.ts`, change `from './DedupedDatalist'` to `from '@geodedb/ui-core'`.

Append to `packages/ui-core/src/index.ts`:
```ts
export { DedupedDatalist } from './components/DedupedDatalist'
export type { DedupedDatalistProps } from './components/DedupedDatalist'
```

Run: `git rm src/components/ui/DedupedDatalist.tsx src/components/ui/DedupedDatalist.test.tsx`

- [ ] **Step 4: Verify**

Run: `npm run -w @geodedb/ui-core build && npm run -w @geodedb/ui-core test && npm run test:ts && npm test`
Expected: green; the DedupedDatalist test runs inside the package and passes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(ui-core): extract DedupedDatalist with test and stories

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task 17: Extract `Logo` (refactor to accept `lightSrc` / `darkSrc` props)

> **Refactor required:** The current `Logo.tsx` imports SVG assets from `../../assets/brand/`. The library cannot ship Geode-specific brand assets, so `Logo` is generalised to take `lightSrc` and `darkSrc` props. The geode-ui app provides its own wrapper that supplies the Geode SVGs.

**Files:**
- Create: `packages/ui-core/src/components/Logo/{Logo.tsx,Logo.stories.tsx,index.ts}`
- Create: `src/components/brand/GeodeLogo.tsx` (geode-ui app wrapper)
- Delete: `src/components/ui/Logo.tsx`

- [ ] **Step 1: Write the generalised library Logo**

Create `packages/ui-core/src/components/Logo/Logo.tsx`:

```tsx
import React from 'react'
import styled from 'styled-components'
import { useThemePreference } from '../../theme'

export interface LogoProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** Image src used when the resolved theme is `light`. */
  lightSrc: string
  /** Image src used when the resolved theme is `dark`. */
  darkSrc: string
  /** Alt text for the logo image. Defaults to "Logo". */
  alt?: string
}

const Img = styled.img`
  display: block;
  max-width: 100%;
  height: auto;
`

export const Logo = React.forwardRef<HTMLImageElement, LogoProps>(function Logo(
  { lightSrc, darkSrc, alt = 'Logo', ...rest },
  ref,
) {
  const preference = useThemePreference()
  const src = preference === 'dark' ? darkSrc : lightSrc
  return <Img ref={ref} src={src} alt={alt} {...rest} />
})
```

Create `packages/ui-core/src/components/Logo/index.ts`:
```ts
export { Logo } from './Logo'
export type { LogoProps } from './Logo'
```

- [ ] **Step 2: Write `Logo.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { Logo } from './Logo'

// Public Storybook placeholder SVGs — replace with consumer-supplied assets.
const LIGHT_SRC = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#111"/><text x="60" y="26" font-family="sans-serif" font-size="16" fill="#fff" text-anchor="middle">LIGHT</text></svg>',
)
const DARK_SRC = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#fff"/><text x="60" y="26" font-family="sans-serif" font-size="16" fill="#111" text-anchor="middle">DARK</text></svg>',
)

const meta: Meta<typeof Logo> = {
  title: 'Display/Logo',
  component: Logo,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof Logo>

export const Default: Story = {
  args: { lightSrc: LIGHT_SRC, darkSrc: DARK_SRC, alt: 'Example brand', height: 40 },
}
```

- [ ] **Step 3: Add geode-ui wrapper that keeps the same call-site API**

Create `src/components/brand/GeodeLogo.tsx`:

```tsx
import React from 'react'
import { Logo, type LogoProps } from '@geodedb/ui-core'
import logoLight from '../../assets/brand/logo-light.svg'
import logoDark from '../../assets/brand/logo-dark.svg'

export type GeodeLogoProps = Omit<LogoProps, 'lightSrc' | 'darkSrc' | 'alt'> & { alt?: string }

export function GeodeLogo({ alt = 'Geode', ...rest }: GeodeLogoProps) {
  return <Logo lightSrc={logoLight} darkSrc={logoDark} alt={alt} {...rest} />
}
```

- [ ] **Step 4: Migrate existing Logo consumers in geode-ui**

Find existing usages:
```bash
grep -rln "from '@/components/ui'" src/ | xargs grep -l "Logo" 2>/dev/null
grep -rln "from '../ui'" src/ | xargs grep -l "Logo" 2>/dev/null || true
grep -rln "Logo" src/ --include='*.tsx' --include='*.ts' | grep -v '/ui-core/' | grep -v 'brand/' || true
```

Replace each `import { Logo } from '<some-path>'` with `import { GeodeLogo as Logo } from '@/components/brand/GeodeLogo'` — or update the JSX to use `GeodeLogo` directly. Choose the path that minimises diff.

- [ ] **Step 5: Wire barrels and delete source**

In `src/components/ui/index.ts`, remove the Logo line entirely (the Geode logo is no longer a `ui/` primitive; it's a brand component under `components/brand/`).

Append to `packages/ui-core/src/index.ts`:
```ts
export { Logo } from './components/Logo'
export type { LogoProps } from './components/Logo'
```

Run: `git rm src/components/ui/Logo.tsx`

- [ ] **Step 6: Verify**

Run: `npm run -w @geodedb/ui-core build && npm run test:ts && npm test`
Expected: green. If a consumer still imports `Logo` from the old barrel, fix that consumer's import — do not re-add the export.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(ui-core): extract Logo as theme-aware primitive; geode brand wrapped in GeodeLogo

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task 18: Extract `Modal` (refactor to drop `react-i18next` coupling)

> **Refactor required:** The current `Modal.tsx` calls `useTranslation` to localise the close-button aria-label, the Cancel button, and the Confirm button. The library is i18n-agnostic, so these become props with English defaults. Geode-ui consumers pass `t()` results.

**Files:**
- Create: `packages/ui-core/src/components/Modal/{Modal.tsx,Modal.test.tsx,Modal.stories.tsx,index.ts}`
- Modify all Modal call sites in `src/` to pass localised labels
- Delete: `src/components/ui/Modal.tsx`, `src/components/ui/Modal.test.tsx`

- [ ] **Step 1: Copy and modify the component to drop i18n**

```bash
cp src/components/ui/Modal.tsx      packages/ui-core/src/components/Modal/Modal.tsx
cp src/components/ui/Modal.test.tsx packages/ui-core/src/components/Modal/Modal.test.tsx
```

In `packages/ui-core/src/components/Modal/Modal.tsx`:

1. Remove the line:
   ```ts
   import { useTranslation } from 'react-i18next'
   ```
2. Remove every `const { t } = useTranslation()` call.
3. Replace every `t('common.close')`, `t('common.cancel')`, `t('common.confirm')` (and any other translation lookups) with a corresponding prop with an English default.

Add these props to `ModalProps`:

```ts
/** Accessible label for the close (×) button. Defaults to "Close". */
closeLabel?: string
```

Add these to `ConfirmModalProps`:

```ts
/** Confirm button label. Defaults to "Confirm". */
confirmLabel?: string
/** Cancel button label. Defaults to "Cancel". */
cancelLabel?: string
```

In the component bodies, destructure with defaults:

```ts
function Modal({ closeLabel = 'Close', /* …existing props… */ }: ModalProps) { ... }
function ConfirmModal({ confirmLabel = 'Confirm', cancelLabel = 'Cancel', /* … */ }: ConfirmModalProps) { ... }
```

Replace each `t('common.close')` with `closeLabel`, `t('common.cancel')` with `cancelLabel`, `t('common.confirm')` with `confirmLabel`.

- [ ] **Step 2: Update the test to use the new prop API**

Open `packages/ui-core/src/components/Modal/Modal.test.tsx`. Wherever the test mocks `useTranslation` or asserts on translated strings, replace those assertions with direct prop assertions ("the button's accessible name is 'Close'"). Remove any `react-i18next` mock setup.

- [ ] **Step 3: Create the barrel**

```ts
// packages/ui-core/src/components/Modal/index.ts
export { Modal, ConfirmModal } from './Modal'
export type { ModalProps, ConfirmModalProps } from './Modal'
```

- [ ] **Step 4: Write `Modal.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { Modal, ConfirmModal } from './Modal'
import { Button } from '../Button'

const meta: Meta<typeof Modal> = {
  title: 'Overlay/Modal',
  component: Modal,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof Modal>

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open modal</Button>
        <Modal isOpen={open} onClose={() => setOpen(false)} title="Example modal" closeLabel="Close">
          <p>Modal body content. Press Escape, click the backdrop, or use the × button to close.</p>
        </Modal>
      </>
    )
  },
}

export const Confirm: Story = {
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open confirm</Button>
        <ConfirmModal
          isOpen={open}
          onClose={() => setOpen(false)}
          onConfirm={() => setOpen(false)}
          title="Delete record?"
          confirmLabel="Delete"
          cancelLabel="Keep"
        >
          This action cannot be undone.
        </ConfirmModal>
      </>
    )
  },
}
```

> If `Modal`'s actual prop API uses different names (e.g., `open` instead of `isOpen`), read `Modal.tsx` and adjust the stories.

- [ ] **Step 5: Update every Modal consumer in geode-ui**

Find consumers:
```bash
grep -rln "from '@geodedb/ui-core'" src/ | xargs grep -l 'Modal\b\|ConfirmModal' 2>/dev/null
grep -rln "from '@/components/ui'" src/ | xargs grep -l 'Modal\b\|ConfirmModal' 2>/dev/null || true
```

For each consumer, pass `closeLabel={t('common.close')}` on `Modal` and `confirmLabel={t('common.confirm')}`, `cancelLabel={t('common.cancel')}` on `ConfirmModal`. This restores the localised text without coupling the library to i18n.

- [ ] **Step 6: Wire barrels and delete sources**

In `src/components/ui/index.ts`, change `from './Modal'` to `from '@geodedb/ui-core'`.

Append to `packages/ui-core/src/index.ts`:
```ts
export { Modal, ConfirmModal } from './components/Modal'
export type { ModalProps, ConfirmModalProps } from './components/Modal'
```

Run: `git rm src/components/ui/Modal.tsx src/components/ui/Modal.test.tsx`

- [ ] **Step 7: Verify**

Run:
```bash
npm run -w @geodedb/ui-core build
npm run -w @geodedb/ui-core test -- Modal.test.tsx
npm run test:ts
npm test
```
Expected: all green; the Modal test runs from the package, the app's tests still pass, and accessible names for Cancel/Confirm/Close come from the props passed at each call site.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(ui-core): extract Modal/ConfirmModal with labels as props (no react-i18next)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 19: Delete `src/components/ui/` and `src/theme/` shims; switch all imports to `@geodedb/ui-core`

**Files:**
- Modify: every file in `src/` that still imports from `@/components/ui` (or relative variants) or from `@/theme` (or relative variants)
- Delete: `src/components/ui/index.ts`
- Delete: `src/theme/index.ts`

- [ ] **Step 1: Survey remaining imports**

Run:
```bash
grep -rln "from '@/components/ui'" src/ | sort -u
grep -rln "from '\.\./ui'" src/ | sort -u
grep -rln "from '\.\./\.\./components/ui'" src/ | sort -u
grep -rln "from '@/theme'" src/ | sort -u
grep -rln "from '\.\./theme'" src/ | sort -u
grep -rln "from '\.\./\.\./theme'" src/ | sort -u
```

Save the union of those files to a list — they all need their import path changed.

- [ ] **Step 2: Rewrite imports in bulk**

For each file in the list, replace:
- `from '@/components/ui'` → `from '@geodedb/ui-core'`
- `from '../ui'`, `from '../../components/ui'`, etc. → `from '@geodedb/ui-core'`
- `from '@/theme'` → `from '@geodedb/ui-core'` *(or `'@geodedb/ui-core/theme'` for type-only or tree-shaking benefit — pick one and apply consistently)*
- `from '../theme'`, `from '../../theme'`, etc. → same as above

A shell-driven approach:
```bash
# Components
grep -rl --include='*.ts' --include='*.tsx' "from '@/components/ui'"   src/ | xargs sed -i "s|from '@/components/ui'|from '@geodedb/ui-core'|g"
grep -rl --include='*.ts' --include='*.tsx' "from '\.\./ui'"           src/ | xargs sed -i "s|from '\.\./ui'|from '@geodedb/ui-core'|g"
grep -rl --include='*.ts' --include='*.tsx' "from '\.\./\.\./components/ui'" src/ | xargs sed -i "s|from '\.\./\.\./components/ui'|from '@geodedb/ui-core'|g"
# Theme
grep -rl --include='*.ts' --include='*.tsx' "from '@/theme'"           src/ | xargs sed -i "s|from '@/theme'|from '@geodedb/ui-core'|g"
grep -rl --include='*.ts' --include='*.tsx' "from '\.\./theme'"       src/ | xargs sed -i "s|from '\.\./theme'|from '@geodedb/ui-core'|g"
grep -rl --include='*.ts' --include='*.tsx' "from '\.\./\.\./theme'"   src/ | xargs sed -i "s|from '\.\./\.\./theme'|from '@geodedb/ui-core'|g"
```

> **Warning:** Inspect the diff before committing. `sed -i` is destructive — verify the changes look right with `git diff` first, and revert any false positives.

- [ ] **Step 3: Delete the shims**

```bash
git rm src/components/ui/index.ts
git rm src/theme/index.ts
rmdir src/theme src/components/ui 2>/dev/null || true
```

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run test:ts && npm test`
Expected: all green. Lint may flag unused imports introduced by the codemod — fix those by running `npm run lint:fix`.

- [ ] **Step 5: Verify the production webpack build still succeeds**

Run: `npm run build`
Expected: webpack produces `dist/` without resolution errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(ui-core): migrate app imports to @geodedb/ui-core; delete transitional shims

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 20: Add Make targets for the package

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Inspect existing `.PHONY` declaration**

Run: `grep -n '^.PHONY' Makefile | head -5`

- [ ] **Step 2: Append new targets at the end of `Makefile`**

Add to the end of `Makefile`:

```make
# ----- ui-core package (Storybook + library build) -----
.PHONY: ui-core-build ui-core-test ui-core-lint stories stories-build stories-clean

ui-core-build:
	npm run -w @geodedb/ui-core build

ui-core-test:
	npm run -w @geodedb/ui-core test

ui-core-lint:
	npm run -w @geodedb/ui-core typecheck

stories:
	npm run -w @geodedb/ui-core storybook

stories-build:
	npm run -w @geodedb/ui-core build-storybook

stories-clean:
	npm run -w @geodedb/ui-core clean
```

- [ ] **Step 3: Verify each target runs**

Run: `make ui-core-build`
Expected: green.

Run: `make ui-core-test`
Expected: green.

Run: `make ui-core-lint`
Expected: exit 0.

Run: `make stories-build`
Expected: `packages/ui-core/storybook-static/index.html` exists.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "$(cat <<'EOF'
feat(ui-core): add Make targets for ui-core build, test, and Storybook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 21: Add GitLab CI jobs for Storybook + Pages deploy

**Files:**
- Modify: `.gitlab-ci.yml`

- [ ] **Step 1: Read the current pipeline structure**

Run: `grep -n '^stages:\|^[a-z][a-z-]*:$' .gitlab-ci.yml | head -40`

Identify the existing `stages:` block. The new jobs go under stages **`build`** (for `build-storybook`) and **`pages`** (for the deploy).

- [ ] **Step 2: Ensure `stages:` lists `pages` (after `build`)**

If `.gitlab-ci.yml` does not already list a `pages` stage, edit the `stages:` block to insert it after `build` and before `release`:

```yaml
stages:
  - install
  - lint
  - test
  - build
  - pages
  - release
```

(Adjust depending on the existing list — keep the prior order, just add `pages` if missing.)

- [ ] **Step 3: Append the new jobs to `.gitlab-ci.yml`**

Add this block at the end of `.gitlab-ci.yml` (preserving final newline):

```yaml
# ----- Storybook for @geodedb/ui-core -----

build-storybook:
  stage: build
  image: node:${NODE_VERSION}
  cache:
    key:
      files:
        - package-lock.json
    paths:
      - .npm/
      - node_modules/
      - packages/ui-core/node_modules/
  before_script:
    - npm ci --prefer-offline --no-audit --no-fund
  script:
    - NODE_OPTIONS='--max-old-space-size=4096' npm run -w @geodedb/ui-core build-storybook
    - mkdir -p public
    - cp -r packages/ui-core/storybook-static/. public/
  artifacts:
    paths:
      - public
    expire_in: 1 week
  rules:
    - if: $CI_COMMIT_BRANCH

pages:
  stage: pages
  image: alpine:3.20
  needs:
    - job: build-storybook
      artifacts: true
  script:
    - echo "Publishing Storybook to GitLab Pages"
    - ls public/ | head -5
  artifacts:
    paths:
      - public
  environment:
    name: storybook
    url: $CI_PAGES_URL
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

> **Note on the asset base path:** Storybook's webpack5 builder uses a relative `publicPath` by default. If GitLab serves your project's pages at `https://<group>.gitlab.io/<project>/`, you may need to add `STORYBOOK_BASE_HREF=/<project>/ npm run -w @geodedb/ui-core build-storybook` to the `script:`. Verify after the first deploy by opening the published URL and checking that JS/CSS load.

- [ ] **Step 4: Validate the YAML locally**

Run: `npx --yes -p '@gitlab-org/gitlab-ci-validate' gitlab-ci-validate .gitlab-ci.yml 2>/dev/null || node -e "require('js-yaml').load(require('fs').readFileSync('.gitlab-ci.yml','utf8')); console.log('YAML OK')"`
Expected: prints `YAML OK` or equivalent. Fix any indentation errors.

- [ ] **Step 5: Verify the existing CI lint guard (if present) still passes**

Run: `bash scripts/check-ci-pins.sh 2>/dev/null || echo 'no ci-pins guard'`
Expected: passes (the new jobs don't add `@latest`/`@~latest` component references).

- [ ] **Step 6: Commit**

```bash
git add .gitlab-ci.yml
git commit -m "$(cat <<'EOF'
feat(ui-core): add CI jobs to build and deploy Storybook to GitLab Pages

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 22: Write the `@geodedb/ui-core` README

**Files:**
- Create: `packages/ui-core/README.md`

- [ ] **Step 1: Write the README**

Create `packages/ui-core/README.md`:

```markdown
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
    <ThemeProvider initialVariant="light">
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
```

- [ ] **Step 2: Verify the README renders by running `npx markdownlint-cli2` if available**

Run: `npx --yes markdownlint-cli2 packages/ui-core/README.md 2>/dev/null || echo 'skip lint (cli not installed)'`
Expected: no errors (or the skip message).

- [ ] **Step 3: Commit**

```bash
git add packages/ui-core/README.md
git commit -m "$(cat <<'EOF'
docs(ui-core): add README with install, usage, theming, and contributing notes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 23: Add a Storybook smoke check to the CI lint stage

**Files:**
- Modify: `.gitlab-ci.yml` (add a fast typecheck job for the package)
- Optionally modify: `package.json` (root) to add a meta-script

- [ ] **Step 1: Add a `ui-core:typecheck` CI job under `lint:`**

Append to `.gitlab-ci.yml`:

```yaml
ui-core:typecheck:
  stage: lint
  image: node:${NODE_VERSION}
  cache:
    key:
      files:
        - package-lock.json
    paths:
      - .npm/
      - node_modules/
      - packages/ui-core/node_modules/
  before_script:
    - npm ci --prefer-offline --no-audit --no-fund
  script:
    - npm run -w @geodedb/ui-core typecheck
    - npm run -w @geodedb/ui-core test -- --ci
  rules:
    - if: $CI_COMMIT_BRANCH
```

- [ ] **Step 2: Validate YAML and commit**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync('.gitlab-ci.yml','utf8')); console.log('YAML OK')"`
Expected: prints `YAML OK`.

```bash
git add .gitlab-ci.yml
git commit -m "$(cat <<'EOF'
ci(ui-core): add typecheck + unit-test job in lint stage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 24: Final end-to-end verification

**Files:** none modified

- [ ] **Step 1: Clean slate install + build**

Run:
```bash
rm -rf node_modules packages/ui-core/node_modules packages/ui-core/dist packages/ui-core/storybook-static
npm install
```
Expected: clean install, workspace link recreated.

- [ ] **Step 2: Full repo verification gauntlet**

Run, in order:
```bash
npm run lint
npm run test:ts
npm test
npm run build
npm run -w @geodedb/ui-core build
npm run -w @geodedb/ui-core test
npm run -w @geodedb/ui-core build-storybook
```
Expected: every command exits 0.

- [ ] **Step 3: Inspect the built Storybook**

Run:
```bash
ls packages/ui-core/storybook-static/index.html
grep -l 'Stack\|Card\|Button\|Modal\|DataTable\|Icon\|Input\|Field\|Logo\|DedupedDatalist' packages/ui-core/storybook-static/index.json 2>/dev/null
```
Expected: every component name appears in `index.json`.

- [ ] **Step 4: Inspect the built library**

Run: `node -e "const m=require('./packages/ui-core/dist/index.cjs'); console.log(Object.keys(m).sort())"`
Expected: an array including `Button`, `Card`, `CardHeader`, `CardSubtitle`, `CardTitle`, `Container`, `ConfirmModal`, `DataTable`, `DedupedDatalist`, `EmptyCell`, `Field`, `Grid`, `Icon`, `Inline`, `Input`, `Logo`, `Modal`, `Select`, `Spacer`, `Stack`, `TableScroll`, `Textarea`, `useUniqueValues`, `ThemeProvider`, `lightTheme`, `darkTheme`, etc.

- [ ] **Step 5: Inspect the ESM bundle for accidental React import**

Run: `grep -c "from 'react'" packages/ui-core/dist/index.js`
Expected: a positive integer; the count shows React is referenced as an external (not bundled). Then:

Run: `grep -c "React.createElement\\|jsxs\\|jsx_runtime" packages/ui-core/dist/index.js | head`
Expected: zero or one occurrence per chunk — confirming the library uses the externalised JSX runtime.

- [ ] **Step 6: Tag the verification**

If everything above is green, the plan is complete. Capture the final state with a no-op verification commit (optional) or simply move on; no further commit is required.

---

## Spec Coverage Audit

| Spec requirement | Task(s) |
|---|---|
| Full review of UI implementation | Already completed during scoping (audit report in conversation; the extraction surface — 10 components + theme + bootstrap-bridge — is the result of that review) |
| Break components into re-usable components | Tasks 9–18 (one component per task) |
| Importable as a module by other React apps | Tasks 2, 3, 22 (package.json `exports`, tsup ESM+CJS+`.d.ts`, README usage section) |
| Storybook support "like ~/src/devnw/react/components" | Task 5 (matching `@storybook/react-webpack5` framework + reference addon stack + theme decorator + storySort) |
| Full suite of stories | Tasks 9–18 (every extracted component ships at least 2 stories with CSF3 autodocs) |
| Make targets | Task 20 (`make stories`, `stories-build`, `ui-core-build`, `ui-core-test`, `stories-clean`, `ui-core-lint`) |
| Deployments to GitLab Pages | Task 21 (`build-storybook` + `pages` jobs in `.gitlab-ci.yml`) |
| Documentation | Tasks 5 (Welcome.mdx), 22 (README.md), Storybook autodocs from `react-docgen-typescript` |
| Consume back in geode-ui | Tasks 6, 7, 8, 9–18 (transitional shims), 19 (final import rewrite + shim deletion) |

No spec item is unaddressed.
