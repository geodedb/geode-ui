import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { useActiveConnection, useConnections } from '../api/connections'

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { isAuthed } = useAuth()
  const active = useActiveConnection()
  const { loading } = useConnections()
  const loc = useLocation()
  // PSR-F16 (#113): when ConnectionsProvider is in lazy-hydrate mode
  // the byId map is empty during the secure-store decrypt round-trip.
  // Treat `loading=true` as "wait, do not redirect" so a hydrated
  // session doesn't briefly bounce to /login before the active
  // connection is populated. Render nothing during the loading window
  // — the Shell's loading state takes over once hydration finishes.
  if (loading) return null
  if (!isAuthed || !active) {
    return <Navigate to="/login" replace state={{ from: loc }} />
  }
  return <>{children}</>
}
