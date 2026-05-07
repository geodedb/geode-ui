const TOKEN_KEY = 'geode-ui.access_token'
const PROFILE_KEY = 'geode-ui.profile'

export type LoginResult = {
  access_token: string
  token_type: string
  expires_in: number
}

export async function login(
  username: string,
  password: string,
  profile: string
): Promise<LoginResult> {
  const body = new URLSearchParams({ username, password, profile })
  const res = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error_description || `login failed (${res.status})`)
  }
  return res.json()
}

export const auth = {
  setToken(t: string) {
    localStorage.setItem(TOKEN_KEY, t)
  },
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY)
  },
  clearToken() {
    localStorage.removeItem(TOKEN_KEY)
  },
  setProfile(p: string) {
    localStorage.setItem(PROFILE_KEY, p)
  },
  getProfile(): string {
    return localStorage.getItem(PROFILE_KEY) || 'default'
  },
}
