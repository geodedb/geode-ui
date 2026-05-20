import { _electron as electron, ElectronApplication } from '@playwright/test'
import path from 'node:path'

// Resolve the compiled main process entrypoint relative to the repo
// root, regardless of where Playwright cwd happens to land (the
// config-driven runs cd into ./e2e/, while make / npm-script runs
// stay at repo root).
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const MAIN_ENTRY = path.join(
  REPO_ROOT,
  'internal',
  'ui',
  'electron-dist',
  'main.js'
)

// Launch the Electron app the same way `npm run electron:dev` does —
// by pointing electron at the compiled main.js. This deliberately uses
// the unpackaged build (not release/linux/linux-unpacked/Geode) so
// tests run against the same artifact developers debug with.
//
// The packaged AppImage / .deb is verified separately by the
// electron-builder run in CI; here we exercise the runtime surface.
export async function launchElectron(): Promise<ElectronApplication> {
  // The xvfb-driven CI display is wired via env (`DISPLAY=:99`) by the
  // make target. Locally the user's own DISPLAY flows through. We do
  // not force --no-sandbox unless the CI image is detected because
  // dropping the sandbox in dev would mask a real regression.
  // Playwright's launch() options.env requires Record<string,string>,
  // but process.env types each value as string|undefined. Strip the
  // undefineds before forwarding so the type narrows cleanly without
  // a non-null assertion or a `as` cast for every read.
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
  // CI runs as root inside a container; Electron refuses to start
  // with the chromium sandbox under root unless we relax it. This
  // matches the chromium-flags the e2e CI passes for the browser
  // suite. Locally `CI` is unset so the sandbox stays on.
  const args = [MAIN_ENTRY]
  if (process.env.CI) args.unshift('--no-sandbox')
  return electron.launch({ args, env, timeout: 30_000 })
}
