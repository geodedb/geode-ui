# ui

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22.14.0+-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18.2.0-blue.svg)](https://reactjs.org/)

A React application built with SPYDER components

## Features

- **React 18 + TypeScript**: Modern React with full type safety
- **SPYDER Components**: Built with `@devnw/components` cybersecurity component library
- **Theming**: styled-components v6 with `ExtendedTheme`
- **Webpack 5**: Optimized build with HMR, code splitting, and CSS extraction
- **Testing**: Jest + React Testing Library
- **CI/CD**: GitLab CI with lint, test, build, and deploy

## Prerequisites

- Node.js 22.14.0+
- npm 10+
- GitLab Personal Access Token (for `@devnw/components` private registry)

## Setup

### 1. Configure Private Registry

The `@devnw/components` package is hosted on GitLab's private package registry.
See [docs/PRIVATE_REGISTRY.md](docs/PRIVATE_REGISTRY.md) for detailed setup instructions.

**Quick setup:**

```bash
# Create a GitLab Personal Access Token with read_api scope, then:
echo "//gitlab.com/api/v4/packages/npm/:_authToken=YOUR_TOKEN" >> ~/.npmrc
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Developing

```bash
# Start dev server on http://localhost:3000
make dev

# Or use npm directly
npm start
```

## Development

```bash
# Start development server with hot reload
make dev

# Run tests
make test

# Run tests in watch mode
make test-watch

# Lint code
make lint

# Format code
make fmt

# Full CI pipeline locally
make ci
```

## Using the Component Library

Import components from `@devnw/components`:

```tsx
import {
  DataTable,
  AlertBadge,
  MetricsCard,
  AppShell,
  Modal,
  Toast,
} from '@devnw/components'
```

For tree-shaking, use subpath imports:

```tsx
import { Line } from '@devnw/components/components/Chart/Line'
import { DataTable } from '@devnw/components/components/DataTable'
```

### Theming

Wrap your app with `ThemeProvider` and use `ThemeBuilder` to create themes:

```tsx
import { ThemeBuilder, ThemeProvider } from '@devnw/components'

const theme = ThemeBuilder.build({
  colors: {
    primary: '#1a56db',
    secondary: '#7c3aed',
  }
})

const App = () => (
  <ThemeProvider theme={theme}>
    {/* Your app */}
  </ThemeProvider>
)
```

### Authorization (RBAC)

Use the deny-by-default authorization system:

```tsx
import { AuthzProvider, AuthzGate, useCan } from '@devnw/components'

// Wrap app with provider
<AuthzProvider permissions={['dashboard:read', 'settings:admin']}>
  <AuthzGate require="settings:admin" fallback={<AccessDenied />}>
    <AdminPanel />
  </AuthzGate>
</AuthzProvider>
```

### Icons

Use the adapter-based icon system:

```tsx
import { IconProvider, Icon } from '@devnw/components'
import { fontAwesomeAdapter } from '@devnw/components/icons/adapters/fontAwesomeAdapter'

<IconProvider adapter={fontAwesomeAdapter}>
  <Icon name="shield" size="lg" />
</IconProvider>
```

## Building

```bash
# Production build
make build

# Output in dist/
ls dist/
```

## Documentation

- [Private Registry Setup](docs/PRIVATE_REGISTRY.md)
- [SPYDER Component Docs](https://devnw.gitlab.io/react/components/) (Storybook)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for security policy and vulnerability reporting.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
