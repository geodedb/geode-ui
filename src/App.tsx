import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider, createGlobalStyle } from 'styled-components'
import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { Shell } from './components/layout/Shell'
import { LoginPage } from './pages/LoginPage'
import { QueryPage } from './pages/QueryPage'
import { SchemaPage } from './pages/SchemaPage'
import { AdminPage } from './pages/AdminPage'
import { UsersPage } from './components/admin/UsersPage'

const theme = {
  colors: {
    primary: '#1a56db',
    background: '#0f172a',
    surface: '#1e293b',
    text: '#e2e8f0',
    textSecondary: '#94a3b8',
    border: '#334155',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
  },
}

const GlobalStyle = createGlobalStyle`
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
      'Helvetica Neue', Arial, sans-serif;
    background-color: ${({ theme }) => theme.colors.background};
    color: ${({ theme }) => theme.colors.text};
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
`

const ProtectedShell: React.FC = () => (
  <ProtectedRoute>
    <Shell />
  </ProtectedRoute>
)

const App: React.FC = () => (
  <ThemeProvider theme={theme}>
    <GlobalStyle />
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedShell />}>
            <Route index element={<QueryPage />} />
            <Route path="schema" element={<SchemaPage />} />
            <Route path="admin" element={<AdminPage />}>
              <Route index element={<Navigate to="users" replace />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="roles" element={<div>roles (TODO D3)</div>} />
              <Route path="policies" element={<div>policies (TODO D3)</div>} />
              <Route path="grants" element={<div>grants (TODO D3)</div>} />
            </Route>
            <Route path="ops" element={<div>ops (TODO D4-D5)</div>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </ThemeProvider>
)

export default App
