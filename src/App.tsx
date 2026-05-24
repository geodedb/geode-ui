import './services/webawesome' // side-effect: registers <wa-button> etc.
import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { createGlobalStyle } from 'styled-components'
import { ThemeProvider } from '@geodedb/ui-core/theme'
import { AuthProvider } from './auth/AuthProvider'
import { ConnectionsProvider } from './api/connections'
import type { ConnectionState } from './api/connections'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { RoleGate } from './auth/RoleGate'
import { Shell } from './components/layout/Shell'
import { ErrorBoundary } from './components/layout/ErrorBoundary'
import { LoginPage } from './pages/LoginPage'
import { QueryPage } from './pages/QueryPage'
// DashboardPage is lazy-loaded so the recharts dep (~140 KiB) lives
// in its own async chunk rather than the main entrypoint. As of the
// 2026-05-21 bug-fix bundle (Bug 1) the dashboard IS the post-login
// landing page — the index route below mounts SuspenseDashboardRoute
// so the operator sees activity at a glance instead of a blank
// query editor. The Suspense boundary lets the chunk fetch happen
// without blocking the initial paint of the protected shell.
import { SchemaPage } from './pages/SchemaPage'
import { AdminPage } from './pages/AdminPage'
import { UsersPage } from './components/admin/UsersPage'
import { RolesPage } from './components/admin/RolesPage'
import { PoliciesPage } from './components/admin/PoliciesPage'
import { RlsDenyPoliciesPage } from './components/admin/RlsDenyPoliciesPage'
import { RlsAttributePoliciesPage } from './components/admin/RlsAttributePoliciesPage'
import { GrantsPanel } from './components/admin/GrantsPanel'
import { ProfilesPage } from './pages/ProfilesPage'
import { DocsPage } from './pages/DocsPage'
import { BackupPage } from './components/ops/BackupPage'
import { RestorePage } from './components/ops/RestorePage'
import { MigrationsPage } from './components/ops/MigrationsPage'
import { AuditLogPage } from './components/ops/AuditLogPage'
import { LocalizationProvider } from './services/i18n'
import { ThemeStyleSheet } from './services/webawesome/ThemeStyleSheet'

// Renderer benchmark host for the cytoscape→reagraph A/B harness.
// Lazy-loaded so the chunk only ships when the route is hit; the route
// is intentionally NOT gated on NODE_ENV because the e2e container
// builds in production mode and the Playwright harness in
// e2e/specs/19 needs to drive it from there. The path is hidden
// (/dev/graph-bench) and unauthenticated; the bench page itself is
// inert when no query params are supplied.
const GraphBenchPage = React.lazy(() =>
  import('./pages/dev/GraphBenchPage').then((m) => ({
    default: m.GraphBenchPage,
  }))
)

// DashboardPage carries the recharts dependency for the metrics +
// audit donut cards. Code-splitting it keeps the main entrypoint
// under the 1.5 MiB performance budget.
const DashboardPage = React.lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
)

// SuspenseDashboardRoute extracts the Suspense wrapper so the inline
// Route element stays single-line (same dance as DevGraphBenchRoute
// above — prettier and react/jsx-wrap-multilines disagree about
// wrapping parens around multi-line element props).
const SuspenseDashboardRoute: React.FC = () => (
  <React.Suspense fallback={<div />}>
    <DashboardPage />
  </React.Suspense>
)

// Suspense-wrapped element extracted into a named component so the
// inline Route element prop stays single-line (Prettier wants no
// wrapping parens around multi-line JSX, ESLint's
// react/jsx-wrap-multilines insists on them — extracting sidesteps
// the conflict).
const DevGraphBenchRoute: React.FC = () => (
  <React.Suspense fallback={<div />}>
    <GraphBenchPage />
  </React.Suspense>
)

const GlobalStyle = createGlobalStyle`
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html, body {
    font-family: ${({ theme }) => theme.font.family.body};
    font-size: ${({ theme }) => theme.font.sizes.md};
    line-height: ${({ theme }) => theme.font.lineHeights.normal};
    background-color: ${({ theme }) => theme.bg.canvas};
    color: ${({ theme }) => theme.text.primary};
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    color-scheme: ${({ theme }) => theme.variant};
  }

  body {
    transition: background-color ${({ theme }) => theme.transitions.normal}
        ${({ theme }) => theme.transitions.easing},
      color ${({ theme }) => theme.transitions.normal}
        ${({ theme }) => theme.transitions.easing};
  }

  /* Brand-aligned focus ring. Mirrors geodedb.com _design-system.scss:377. */
  *:focus-visible {
    outline: 2px solid ${({ theme }) => theme.border.focus};
    outline-offset: 2px;
    border-radius: ${({ theme }) => theme.radii.sm};
  }

  /* Honor user motion preferences — disables long transitions and
     animations for visitors who set prefers-reduced-motion. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }

  h1, h2, h3, h4, h5, h6 {
    font-family: ${({ theme }) => theme.font.family.display};
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    line-height: ${({ theme }) => theme.font.lineHeights.tight};
  }

  code, pre, kbd, samp {
    font-family: ${({ theme }) => theme.font.family.mono};
  }
`

const ProtectedShell: React.FC = () => (
  <ProtectedRoute>
    <Shell />
  </ProtectedRoute>
)

// SEC issue 264: AdminPage rendered behind the role gate.  Extracted
// into a named component so the inline Route element prop stays
// single-line (Prettier wants no wrapping parens around multi-line
// JSX, ESLint's react/jsx-wrap-multilines insists on them).
const AdminPageGated: React.FC = () => (
  <RoleGate requiredRole="admin">
    <AdminPage />
  </RoleGate>
)

interface AppProps {
  initialConnections?: ConnectionState[]
  // PSR-F16 (#113): when true, ConnectionsProvider mounts with an
  // empty map + loading=true and dispatches the hydrated state once
  // getStoredConnections resolves. The production bootstrap (src/
  // index.tsx) sets this; tests mount with eager initialConnections
  // and leave lazyHydrate undefined.
  lazyHydrate?: boolean
}

const App: React.FC<AppProps> = ({ initialConnections, lazyHydrate }) => (
  <LocalizationProvider>
    <ThemeProvider>
      <GlobalStyle />
      <ThemeStyleSheet />
      {/*
        ErrorBoundary wraps everything below the theme so a render-time
        throw (a hook that violated rules-of-hooks, a malformed API
        payload that surfaces through a render, etc.) lands on a
        recoverable error UI instead of unmounting #root entirely.
        See ErrorBoundary.tsx for the carveout: chunk-eval throws
        (webpack module factories) land on window.onerror, not on a
        React render frame, and CAN'T be caught here. Those must be
        prevented at the source — see GraphView.tsx for the
        reagraph/React-18 example.
      */}
      <ErrorBoundary>
        <ConnectionsProvider
          initialConnections={initialConnections}
          lazyHydrate={lazyHydrate}
        >
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route
                  path="/dev/graph-bench"
                  element={<DevGraphBenchRoute />}
                />
                <Route element={<ProtectedShell />}>
                  {/*
                    Bug 1 (2026-05-21 bug-fix bundle): /dashboard is
                    now the post-login landing page. The protected
                    index redirects to /dashboard so the canonical URL
                    stays /dashboard (deep links unchanged) while a
                    fresh login lands the operator on the activity
                    overview instead of a blank query editor. /query
                    moved to its own path so the left-nav "Query" link
                    keeps a stable target.
                  */}
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="query" element={<QueryPage />} />
                  <Route
                    path="dashboard"
                    element={<SuspenseDashboardRoute />}
                  />
                  <Route path="schema" element={<SchemaPage />} />
                  {/*
                    SEC issue 264: /admin/* is wrapped in a client-side
                    RoleGate so the route itself short-circuits for
                    non-admins (information-disclosure suppression).
                    Server-side handlers still enforce hasRole admin
                    independently; the gate is defense-in-depth, not
                    the authority.
                  */}
                  <Route path="admin" element={<AdminPageGated />}>
                    <Route index element={<Navigate to="users" replace />} />
                    <Route path="users" element={<UsersPage />} />
                    <Route path="roles" element={<RolesPage />} />
                    <Route path="policies" element={<PoliciesPage />} />
                    <Route path="grants" element={<GrantsPanel />} />
                    <Route path="rls-deny" element={<RlsDenyPoliciesPage />} />
                    <Route
                      path="rls-attribute"
                      element={<RlsAttributePoliciesPage />}
                    />
                    <Route path="backups" element={<BackupPage />} />
                    <Route path="restore" element={<RestorePage />} />
                    <Route path="migrations" element={<MigrationsPage />} />
                    <Route path="audit" element={<AuditLogPage />} />
                  </Route>
                  <Route path="profiles" element={<ProfilesPage />} />
                  {/* GAP-061: in-app docs viewer. /docs lands on the
                      first page in the bundled list; /docs/:slug deep-
                      links into a specific page. Markdown is bundled
                      at build time so the Electron build ships docs
                      offline. */}
                  <Route path="docs" element={<DocsPage />} />
                  <Route path="docs/:slug" element={<DocsPage />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </ConnectionsProvider>
      </ErrorBoundary>
    </ThemeProvider>
  </LocalizationProvider>
)

export default App
export { App }
