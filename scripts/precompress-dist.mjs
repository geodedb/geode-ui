#!/usr/bin/env node
// PERF (#259) brotli pre-compression of the production SPA bundle.
//
// Walks `internal/ui/dist/` after the webpack build and emits a `.br`
// sibling next to every compressible asset whose uncompressed size is
// at least `MIN_BYTES`. Uses Node's stdlib `zlib.brotliCompressSync`
// with quality 11 (the highest setting) since this runs once per
// build and the resulting files ship inside the Go binary forever.
//
// We deliberately avoid `compression-webpack-plugin` here so this
// plugin can ship without adding a new devDependency. Node has had
// stable brotli support since 11.7; the API surface we need
// (`zlib.constants.BROTLI_PARAM_QUALITY`, `brotliCompressSync`) is
// stdlib-only.
//
// Run from the repo root:
//
//   node scripts/precompress-dist.mjs           # default: dist/ + 1KiB floor
//   node scripts/precompress-dist.mjs --dir foo # custom dist directory
//   node scripts/precompress-dist.mjs --min 2048
//
// Idempotent: an existing `.br` sibling is overwritten only when the
// source file's mtime is newer than the `.br` mtime. Cold runs
// recompute every sibling so a stale checkout cannot ship a `.br`
// keyed on an out-of-date source.

import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DEFAULT = path.resolve(HERE, '..')
const DIST_DEFAULT = path.join('internal', 'ui', 'dist')

// File extensions that benefit from brotli precompression. Already-
// compressed binary types (images, fonts that ship as woff2 which is
// brotli-internal) are excluded because re-brotli'ing them yields
// negligible savings AND ships an extra inode per asset.
const COMPRESSIBLE_EXTS = new Set([
  '.js',
  '.css',
  '.map',
  '.svg',
  '.html',
  '.json',
  '.webmanifest',
  '.txt',
])

// Minimum uncompressed byte size below which precompression is skipped.
// Brotli framing overhead is ~5-10 bytes; below ~1KiB the savings are
// noise vs the extra file the runtime has to load.
const MIN_BYTES_DEFAULT = 1024

function parseArg(argv, name, fallback) {
  const i = argv.indexOf(name)
  if (i !== -1 && argv[i + 1] !== undefined) return argv[i + 1]
  return fallback
}

function fmtBytes(n) {
  const KiB = 1024
  const MiB = 1024 * 1024
  if (n >= MiB) return `${(n / MiB).toFixed(2)} MiB`
  if (n >= KiB) return `${(n / KiB).toFixed(2)} KiB`
  return `${n} B`
}

function listAll(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listAll(full))
      continue
    }
    if (entry.isFile()) out.push(full)
  }
  return out
}

function shouldRecompress(srcPath, brPath) {
  let brStat
  try {
    brStat = statSync(brPath)
  } catch {
    return true
  }
  const srcStat = statSync(srcPath)
  return srcStat.mtimeMs > brStat.mtimeMs
}

// Pure / testable: precompress one buffer at quality 11. Exposed so the
// companion test can exercise the compressor without spinning up a
// filesystem fixture.
export function compressBuffer(buf) {
  return zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    },
  })
}

// Pure / testable: classify a path against the compressible-extension
// set + size floor.
export function shouldPrecompress(filePath, sizeBytes, minBytes) {
  const ext = path.extname(filePath).toLowerCase()
  if (!COMPRESSIBLE_EXTS.has(ext)) return false
  if (filePath.endsWith('.br')) return false
  if (sizeBytes < minBytes) return false
  return true
}

function main() {
  const argv = process.argv.slice(2)
  const root = path.resolve(parseArg(argv, '--root', ROOT_DEFAULT))
  const dist = path.resolve(root, parseArg(argv, '--dir', DIST_DEFAULT))
  const minBytes = Number(parseArg(argv, '--min', MIN_BYTES_DEFAULT))
  if (!Number.isFinite(minBytes) || minBytes < 0) {
    console.error(`precompress-dist: invalid --min ${minBytes}`)
    process.exitCode = 2
    return
  }
  let files
  try {
    files = listAll(dist)
  } catch (e) {
    console.error(`precompress-dist: cannot walk ${dist}: ${e.message}`)
    process.exitCode = 1
    return
  }
  if (files.length === 0) {
    console.warn(
      `precompress-dist: ${dist} is empty — did you run \`npm run build\` first?`
    )
    return
  }
  let written = 0
  let skipped = 0
  let bytesIn = 0
  let bytesOut = 0
  for (const f of files) {
    const stat = statSync(f)
    if (!shouldPrecompress(f, stat.size, minBytes)) {
      skipped += 1
      continue
    }
    const brPath = `${f}.br`
    if (!shouldRecompress(f, brPath)) {
      skipped += 1
      continue
    }
    const src = readFileSync(f)
    const dst = compressBuffer(src)
    writeFileSync(brPath, dst)
    written += 1
    bytesIn += src.length
    bytesOut += dst.length
  }
  const ratio = bytesIn === 0 ? 1 : bytesOut / bytesIn
  console.log(
    `precompress-dist: wrote=${written} skipped=${skipped} ` +
      `in=${fmtBytes(bytesIn)} out=${fmtBytes(bytesOut)} ratio=${ratio.toFixed(3)}`
  )
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
