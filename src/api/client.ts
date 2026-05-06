// eslint-disable-next-line import/no-unresolved
import { createClient } from '@api'
import { auth } from './auth'

export const client = createClient({
  baseUrl: '',
  bearerToken: () => auth.getToken() ?? '',
})
