// eslint-disable-next-line import/no-unresolved
import { createClient } from '@api'
import { auth } from './auth'

function resolveBaseUrl(): string {
  if (
    typeof window !== 'undefined' &&
    window.location &&
    window.location.origin
  ) {
    return window.location.origin
  }
  return 'http://localhost'
}

export const client = createClient({
  baseUrl: resolveBaseUrl(),
  bearerToken: () => auth.getToken() ?? '',
})
