// Stage the existing SPA build for app:// on every desktop build host.
import { cpSync, statSync } from 'node:fs'

const source = 'internal/ui/dist'
const index = statSync(`${source}/index.html`)
if (!index.isFile() || !index.size) {
  throw new Error('Build the SPA before assembling Electron assets')
}
cpSync(source, 'internal/ui/electron-dist/dist', { recursive: true })
