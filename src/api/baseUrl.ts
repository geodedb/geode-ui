// Resolves the HTTP(S) origin every fetch in this package targets.
//
// Lives in its own leaf module so callers in both directions of the
// existing client/csrf import graph can use it: `client.ts` already
// imports from `csrf.ts`, which means `csrf.ts` cannot pull from
// `client.ts` without a cycle. Both — plus `auth.ts`, `metrics.ts`, and
// any future bare-fetch caller — import from here.
//
// Behaviour:
//
//   1. Under Electron the renderer is hosted on the privileged
//      `geode://` scheme. A relative path resolves against that origin
//      and hits the SPA-fallback branch of the custom protocol handler
//      in `electron/main.ts`, which returns `index.html` with a 200 —
//      callers expecting JSON read `<!doctype html>` and throw the
//      classic "Unexpected token '<'" parse error. The preload exposes
//      the operator-configured HTTP(S) origin on `window.geode.serverUrl`;
//      use it whenever it's present.
//
//   2. In the browser fall through to `window.location.origin` so the
//      same SPA bundle works for the dev server + the Go server's
//      embedded UI.
//
//   3. If neither is usable (no `window.geode`, and `window.location.origin`
//      is something exotic like `geode://app` because the preload failed
//      to set serverUrl), fall back to `http://localhost`. This matches
//      the generated client's requirement that base URLs use http(s)
//      and avoids tripping its URL whitelist.
import { locationOrigin } from './locationOrigin'

export function resolveBaseUrl(): string {
  if (
    typeof window !== 'undefined' &&
    window.geode &&
    typeof window.geode.serverUrl === 'string' &&
    window.geode.serverUrl.length > 0
  ) {
    return window.geode.serverUrl
  }
  const origin = locationOrigin()
  if (origin && (origin.startsWith('http:') || origin.startsWith('https:'))) {
    return origin
  }
  return 'http://localhost'
}

// apiUrl is a thin convenience wrapper for callers that just want to
// prepend the configured origin to a path. Equivalent to template-
// interpolating `resolveBaseUrl()` but reads cleaner at call sites and
// keeps the prefix logic in one place.
export function apiUrl(path: string): string {
  return `${resolveBaseUrl()}${path}`
}
