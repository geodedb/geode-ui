/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RoleGate } from './RoleGate'
import { useAuth } from './AuthProvider'

jest.mock('./AuthProvider', () => ({
  useAuth: jest.fn(),
}))

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>

function setUseAuth(roles: string[]): void {
  mockedUseAuth.mockReturnValue({
    isAuthed: true,
    roles,
    hasRole: (r: string) => roles.includes(r),
    isAdmin: roles.includes('admin'),
    setAuthed: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(),
    connectMore: jest.fn(),
    disconnect: jest.fn(),
    switchActive: jest.fn(),
  } as unknown as ReturnType<typeof useAuth>)
}

// Extracted route elements keep the inline Route prop single-line.
// react/jsx-wrap-multilines vs prettier disagree on parens around a
// multi-line JSX expression inside an attribute; pulling the elements
// out into named components sidesteps the conflict (same trick the
// production App.tsx uses for AdminPageGated).
const AdminPageStub: React.FC = () => (
  <div data-testid="admin-content">admin page</div>
)
const AdminGate: React.FC = () => (
  <RoleGate requiredRole="admin">
    <AdminPageStub />
  </RoleGate>
)
const AdminGateDashboardFallback: React.FC = () => (
  <RoleGate requiredRole="admin" fallback="/dashboard">
    <AdminPageStub />
  </RoleGate>
)

describe('RoleGate (SEC issue 264, audit cohort 2026-05-17)', () => {
  beforeEach(() => {
    mockedUseAuth.mockReset()
  })

  test('renders children when the caller holds the required role', () => {
    setUseAuth(['admin'])
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route path="/admin/users" element={<AdminGate />} />
          <Route path="/" element={<div data-testid="home">home</div>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('admin-content')).toBeInTheDocument()
    expect(screen.queryByTestId('home')).not.toBeInTheDocument()
  })

  test('redirects to fallback when the caller lacks the required role', () => {
    setUseAuth(['user'])
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route path="/admin/users" element={<AdminGate />} />
          <Route path="/" element={<div data-testid="home">home</div>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument()
    expect(screen.getByTestId('home')).toBeInTheDocument()
  })

  test('redirects to a custom fallback path', () => {
    setUseAuth([])
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route path="/admin/users" element={<AdminGateDashboardFallback />} />
          <Route
            path="/dashboard"
            element={<div data-testid="dashboard">dashboard</div>}
          />
          <Route path="/" element={<div data-testid="home">home</div>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument()
    expect(screen.getByTestId('dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('home')).not.toBeInTheDocument()
  })

  test('does not render any "403" body — the redirect IS the response', () => {
    setUseAuth(['user'])
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route path="/admin/users" element={<AdminGate />} />
          <Route path="/" element={<div data-testid="home">home</div>} />
        </Routes>
      </MemoryRouter>
    )
    // Confirm no visible 403/Forbidden/Unauthorized text surface — the
    // redirect to fallback is the only response. A future regression
    // that adds an inline 403 surface would leak the route's existence.
    expect(screen.queryByText(/403/)).not.toBeInTheDocument()
    expect(screen.queryByText(/forbidden/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/unauthorized/i)).not.toBeInTheDocument()
  })
})
