import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import zlib from 'node:zlib'
import { compressBuffer, shouldPrecompress } from './precompress-dist.mjs'

test('compressBuffer round-trips through brotli at quality 11', () => {
  const src = Buffer.from('x'.repeat(2048))
  const out = compressBuffer(src)
  // Compressed should be substantially smaller than the input for a
  // highly-repetitive payload.
  assert.ok(out.length < src.length / 4, `out=${out.length} src=${src.length}`)
  // Round-trip decompress matches the source.
  const back = zlib.brotliDecompressSync(out)
  assert.deepEqual(back.toString('utf8'), src.toString('utf8'))
})

test('shouldPrecompress accepts .js / .css / .html above the floor', () => {
  assert.equal(shouldPrecompress('/foo/main.js', 2048, 1024), true)
  assert.equal(shouldPrecompress('/foo/styles.css', 2048, 1024), true)
  assert.equal(shouldPrecompress('/foo/index.html', 2048, 1024), true)
  assert.equal(shouldPrecompress('/foo/data.json', 2048, 1024), true)
})

test('shouldPrecompress rejects images / fonts / wasm', () => {
  assert.equal(shouldPrecompress('/foo/logo.png', 10000, 1024), false)
  assert.equal(shouldPrecompress('/foo/font.woff2', 50000, 1024), false)
  assert.equal(shouldPrecompress('/foo/code.wasm', 50000, 1024), false)
})

test('shouldPrecompress rejects already-compressed .br files', () => {
  assert.equal(shouldPrecompress('/foo/main.js.br', 50000, 1024), false)
})

test('shouldPrecompress respects the size floor', () => {
  assert.equal(shouldPrecompress('/foo/main.js', 512, 1024), false)
  assert.equal(shouldPrecompress('/foo/main.js', 1024, 1024), true)
})
