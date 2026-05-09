import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { useActiveConnection } from '../api/connections'

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { isAuthed } = useAuth()
  const active = useActiveConnection()
  const loc = useLocation()
  if (!isAuthed || !active) {
    return <Navigate to="/login" replace state={{ from: loc }} />
  }
  return <>{children}</>
}
