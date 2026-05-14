import './services/webawesome' // side-effect: registers <wa-button> etc.
import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { createGlobalStyle } from 'styled-components'
import { AuthProvider } from './auth/AuthProvider'
import { ConnectionsProvider } from './api/connections'
import type { ConnectionState } from './api/connections'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { Shell } from './components/layout/Shell'
import { LoginPage } from './pages/LoginPage'
import { QueryPage } from './pages/QueryPage'
import { DashboardPage } from './pages/DashboardPage'
import { WorkspacePage } from './pages/WorkspacePage'
import { SchemaPage } from './pages/SchemaPage'
import { AdminPage } from './pages/AdminPage'
import { UsersPage } from './components/admin/UsersPage'
import { RolesPage } from './components/admin/RolesPage'
import { PoliciesPage } from './components/admin/PoliciesPage'
import { GrantsPanel } from './components/admin/GrantsPanel'
import { OpsPage } from './pages/OpsPage'
import { ProfilesPage } from './pages/ProfilesPage'
import { BackupPage } from './components/ops/BackupPage'
import { RestorePage } from './components/ops/RestorePage'
import { MigrationsPage } from './components/ops/MigrationsPage'
import { AuditLogPage } from './components/ops/AuditLogPage'
import { LocalizationProvider } from './services/i18n'
import { ThemeProvider } from './theme'
import { ThemeStyleSheet } from './services/webawesome/ThemeStyleSheet'

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
      <ConnectionsProvider
        initialConnections={initialConnections}
        lazyHydrate={lazyHydrate}
      >
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<ProtectedShell />}>
                <Route index element={<QueryPage />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="workspace" element={<WorkspacePage />} />
                <Route path="schema" element={<SchemaPage />} />
                <Route path="admin" element={<AdminPage />}>
                  <Route index element={<Navigate to="users" replace />} />
                  <Route path="users" element={<UsersPage />} />
                  <Route path="roles" element={<RolesPage />} />
                  <Route path="policies" element={<PoliciesPage />} />
                  <Route path="grants" element={<GrantsPanel />} />
                </Route>
                <Route path="ops" element={<OpsPage />}>
                  <Route index element={<Navigate to="backups" replace />} />
                  <Route path="backups" element={<BackupPage />} />
                  <Route path="restore" element={<RestorePage />} />
                  <Route path="migrations" element={<MigrationsPage />} />
                  <Route path="audit" element={<AuditLogPage />} />
                </Route>
                <Route path="profiles" element={<ProfilesPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ConnectionsProvider>
    </ThemeProvider>
  </LocalizationProvider>
)

export default App
export { App }
