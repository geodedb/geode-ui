import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'

// RoleGate — client-side role authorisation wrapper for SPA routes
// (SEC-NEW-13, see SECURITY_GAP_ANALYSIS issue 264).
//
// /admin/* SPA routes were previously mounted under ProtectedShell,
// which only enforces "is the user authenticated?". The server-side
// admin handlers DO enforce `hasRole("admin")` and return 403, so a
// non-admin user navigating to /admin/users would see the route render
// and then the data-fetching handlers fail with 403 — an information-
// disclosure / UX gap rather than a privilege escalation (no admin
// action would actually succeed). RoleGate closes the disclosure side
// of the gap by short-circuiting the route render itself for users
// who lack the required role.
//
// Non-authorised callers are redirected to the route in `fallback`
// (default `/`) carrying the original location in router state so a
// future grant + back-button returns the user where they were heading.
// The component DOES NOT render any "403" UI surface — the redirect is
// the discloure-suppressing behaviour; an inline 403 surface would
// leak the route's existence.
//
// APP-06 (2026-05-24 appsec) — TRUST BOUNDARY: this client-side gate
// is information-disclosure-only. The `roles` array it consults comes
// from `AuthProvider`, which seeds it from the JWT claim AND from a
// best-effort `sessionStorage['geode-ui.session-roles']` cache that a
// DOM-XSS / devtools paste / malicious npm transitive could forge.
// The bootstrap `fetchWhoAmI` effect in AuthProvider overwrites the
// cache with the server's authoritative roles list whenever the
// browser is authenticated, so a forged cache survives at most one
// render before the network round-trip replaces it.
//
// EVERY API HANDLER on the server independently checks
// `hasRole('admin')` (or the equivalent) and returns 403. DO NOT
// remove the server-side check on the assumption that this gate
// covers it — the gate is a UX + disclosure suppression layer, not
// an authority. Cross-link: App.tsx mounts this around AdminPage and
// its siblings.

export const RoleGate: React.FC<{
  requiredRole: string
  fallback?: string
  children: React.ReactNode
}> = ({ requiredRole, fallback = '/', children }) => {
  const { hasRole } = useAuth()
  const loc = useLocation()
  if (!hasRole(requiredRole)) {
    return <Navigate to={fallback} replace state={{ from: loc }} />
  }
  return <>{children}</>
}
