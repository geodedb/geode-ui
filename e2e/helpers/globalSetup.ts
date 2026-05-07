import { request } from '@playwright/test'

const UI_URL = process.env.UI_URL ?? 'http://localhost:8080'
const TIMEOUT_MS = 60_000

// Polling readiness probe: sequential awaits + 1s backoff are intentional.
/* eslint-disable no-await-in-loop, no-promise-executor-return */
async function waitForHealth(): Promise<void> {
  const ctx = await request.newContext({ baseURL: UI_URL })
  const start = Date.now()
  let lastErr: unknown
  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const res = await ctx.get('/healthz')
      if (res.ok()) {
        const body = (await res.json()) as { status?: string }
        if (body.status === 'ok') {
          await ctx.dispose()
          return
        }
      }
      lastErr = `status ${res.status()}`
    } catch (e: unknown) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  await ctx.dispose()
  throw new Error(
    `UI did not become healthy at ${UI_URL} within ${TIMEOUT_MS}ms: ${String(lastErr)}`
  )
}
/* eslint-enable no-await-in-loop, no-promise-executor-return */

export default async function globalSetup(): Promise<void> {
  await waitForHealth()
}
