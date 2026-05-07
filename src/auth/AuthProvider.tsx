import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { auth as authStore } from '../api/auth'

type AuthState = {
  token: string | null
  setToken: (t: string | null) => void
}

const AuthCtx = createContext<AuthState | null>(null)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [token, setTokenState] = useState<string | null>(authStore.getToken())
  const setToken = useCallback((t: string | null) => {
    if (t) authStore.setToken(t)
    else authStore.clearToken()
    setTokenState(t)
  }, [])
  const value = useMemo<AuthState>(
    () => ({ token, setToken }),
    [token, setToken]
  )
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => {
  const v = useContext(AuthCtx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
