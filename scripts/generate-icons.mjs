#!/usr/bin/env node
// Rasterize build/icon.svg into the PNGs that BrowserWindow and
// electron-builder consume. electron-builder auto-derives `.icns`
// (macOS) and `.ico` (Windows) from `icon.png` when the source is at
// least 512×512 — see electron.build/icons. Linux `.deb` / AppImage
// pick up `icon.png` directly.
//
// Idempotent: re-runs are safe; emits files only when the SVG is newer
// than the existing PNGs, so `npm run electron:build` stays cheap.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')
// Source SVG is tracked under electron/assets/icon.svg (build/ is
// gitignored). The derived PNGs stay under build/ since they're
// reproducible from the SVG.
const SRC = path.join(ROOT, 'electron', 'assets', 'icon.svg')
const OUT_DIR = path.join(ROOT, 'build')

const SIZES = [256, 512, 1024]

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function stale(out, src) {
  if (!(await exists(out))) return true
  const [a, b] = await Promise.all([fs.stat(out), fs.stat(src)])
  return b.mtimeMs > a.mtimeMs
}

async function main() {
  if (!(await exists(SRC))) {
    console.error(`generate-icons: missing ${SRC}`)
    process.exit(1)
  }

  let sharp
  try {
    sharp = (await import('sharp')).default
  } catch (err) {
    console.error('generate-icons: sharp is not installed. Run `npm i -D sharp`.')
    console.error(err?.message ?? err)
    process.exit(1)
  }

  const svg = await fs.readFile(SRC)
  await fs.mkdir(OUT_DIR, { recursive: true })

  const targets = [
    { name: 'icon.png', size: 1024 },
    ...SIZES.map((s) => ({ name: `icon-${s}.png`, size: s })),
  ]

  for (const t of targets) {
    const out = path.join(OUT_DIR, t.name)
    if (!(await stale(out, SRC))) continue
    await sharp(svg, { density: 384 })
      .resize(t.size, t.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(out)
    console.log(`generate-icons: wrote ${path.relative(ROOT, out)} (${t.size}px)`)
  }
}

main().catch((err) => {
  console.error('generate-icons failed:', err)
  process.exit(1)
})
