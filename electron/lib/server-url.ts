// Pure helper for resolving the geode-ui HTTP(S) server origin the
// Electron renderer talks to. Extracted out of main.ts so it can be
// unit-tested under the SPA's jest harness without pulling `electron`
// into the import graph (same pattern as ./safety.ts).
//
// The Electron renderer is hosted on the privileged `geode://` scheme,
// which the SPA's generated API client refuses ("base URL must use
// http or https"). Operators point at their server origin via the
// GEODE_SERVER_URL env var; everything else falls back to the docker-
// compose default a developer runs alongside the desktop build.

const DEFAULT_SERVER_URL = 'http://localhost:8080'

export function resolveServerUrl(env: NodeJS.ProcessEnv): string {
  const raw = env['GEODE_SERVER_URL']?.trim()
  if (!raw) return DEFAULT_SERVER_URL
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
    return DEFAULT_SERVER_URL
  }
  // Strip a trailing slash so URL joins downstream don't double it.
  return raw.replace(/\/+$/, '') || DEFAULT_SERVER_URL
}
